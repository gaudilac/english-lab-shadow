(function () {
  'use strict';

  var MESSAGE_READY = 'english-lab-shadow-ready';
  var MESSAGE_RESULT = 'english-lab-shadow-result';
  var MESSAGE_ACCEPTED = 'english-lab-shadow-accepted';
  var MESSAGE_SESSION = 'english-lab-shadow-session';
  var MESSAGE_NAVIGATE = 'english-lab-shadow-navigate';
  var MESSAGE_FINISH = 'english-lab-shadow-finish';
  var MESSAGE_LOOKUP = 'english-lab-shadow-pronunciation-lookup';
  var MESSAGE_PRONUNCIATIONS = 'english-lab-shadow-pronunciations';
  var AUTO_ADVANCE_SCORE = .95;
  var AUTO_ADVANCE_STORAGE = 'english-lab-shadow-auto-advance';
  var params = new URLSearchParams(location.hash.replace(/^#/, ''));
  var session = params.get('session') || '';
  var returnOrigin = validOrigin(params.get('returnOrigin'));
  var lesson = null;
  var currentIndex = 0;
  var recognition = null;
  var recognitionFinished = false;
  var results = {};
  var passed = {};
  var pronunciations = {};
  var requestedWords = {};
  var pronunciationRequest = 0;
  var pronunciationBatches = {};
  var pronunciationAudio = null;
  var autoAdvance = true;
  var slow = false;
  var hiddenText = false;
  var player = null;
  var playerReady = false;
  var playerFailed = false;
  var audioPoll = null;
  var advanceTimer = null;
  var connectionTimer = null;

  var el = {
    empty: document.getElementById('emptyState'),
    emptyEyebrow: document.getElementById('emptyEyebrow'),
    emptyTitle: document.getElementById('emptyTitle'),
    emptyHint: document.getElementById('emptyHint'),
    practice: document.getElementById('practiceState'),
    summary: document.getElementById('summaryState'),
    lesson: document.getElementById('lessonLabel'),
    progress: document.getElementById('progressLabel'),
    progressFill: document.getElementById('progressFill'),
    videoStage: document.getElementById('videoStage'),
    target: document.getElementById('targetText'),
    translation: document.getElementById('translationText'),
    scriptCard: document.querySelector('.script-card'),
    sample: document.getElementById('sampleButton'),
    sampleLabel: document.getElementById('sampleLabel'),
    speed: document.getElementById('speedButton'),
    hide: document.getElementById('hideButton'),
    autoAdvance: document.getElementById('autoAdvanceToggle'),
    recorder: document.getElementById('recorder'),
    statusTitle: document.getElementById('statusTitle'),
    statusHint: document.getElementById('statusHint'),
    record: document.getElementById('recordButton'),
    recordLabel: document.getElementById('recordLabel'),
    result: document.getElementById('resultPanel'),
    dial: document.getElementById('scoreDial'),
    score: document.getElementById('scoreValue'),
    scoreTitle: document.getElementById('scoreTitle'),
    words: document.getElementById('wordResult'),
    mistakeHint: document.getElementById('mistakeHint'),
    heard: document.getElementById('heardText'),
    retry: document.getElementById('retryButton'),
    nextResult: document.getElementById('nextResultButton'),
    sendStatus: document.getElementById('sendStatus'),
    previous: document.getElementById('previousButton'),
    next: document.getElementById('nextButton'),
    summaryPassed: document.getElementById('summaryPassed'),
    summaryTotal: document.getElementById('summaryTotal'),
    summaryHint: document.getElementById('summaryHint'),
    retryMissed: document.getElementById('retryMissedButton'),
    close: document.getElementById('closeButton')
  };

  try { autoAdvance = localStorage.getItem(AUTO_ADVANCE_STORAGE) !== 'false'; } catch (e) {}
  el.autoAdvance.checked = autoAdvance;

  function validOrigin(value) {
    if (!value) return '';
    try {
      var url = new URL(value);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost') return '';
      return url.origin;
    } catch (e) { return ''; }
  }

  function words(value) {
    return String(value || '').toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ')
      .split(/\s+/).filter(Boolean);
  }

  function compare(expected, heard) {
    var targetWords = words(expected);
    var heardWords = words(heard);
    var flags = targetWords.map(function () { return false; });
    var cursor = 0;
    for (var i = 0; i < targetWords.length; i++) {
      for (var k = cursor; k < heardWords.length && k < cursor + 4; k++) {
        if (heardWords[k] === targetWords[i]) {
          flags[i] = true;
          cursor = k + 1;
          break;
        }
      }
    }
    var correct = flags.filter(Boolean).length;
    return { score: targetWords.length ? correct / targetWords.length : 0, flags: flags };
  }

  function safeLesson(raw) {
    if (!raw || !Array.isArray(raw.lines)) return null;
    var lines = raw.lines.slice(0, 500).map(function (line) {
      var text = String(line && line.text || '').trim().slice(0, 2000);
      return {
        text: text,
        vi: String(line && line.vi || '').trim().slice(0, 2000),
        t: line && line.t != null && isFinite(Number(line.t)) ? Math.max(0, Number(line.t)) : null,
        end: line && line.end != null && isFinite(Number(line.end)) ? Math.max(0, Number(line.end)) : null
      };
    }).filter(function (line) { return words(line.text).length >= 2; });
    if (!lines.length) return null;
    var videoId = /^[A-Za-z0-9_-]{11}$/.test(String(raw.videoId || '')) ? String(raw.videoId) : '';
    var pronunciationMap = {};
    Object.keys(raw.pronunciations || {}).slice(0, 300).forEach(function (key) {
      var normalized = String(key || '').toLowerCase().trim();
      var value = raw.pronunciations[key];
      if (!normalized || !value) return;
      pronunciationMap[normalized] = typeof value === 'string'
        ? { ipa: value, audio: '', source: 'vocab' }
        : {
            ipa: String(value.ipa || '').trim().slice(0, 200),
            audio: String(value.audio || '').trim().slice(0, 1000),
            source: String(value.source || 'vocab').slice(0, 30)
          };
    });
    return {
      id: String(raw.id || '').slice(0, 200),
      topic: String(raw.topic || 'Shadowing').slice(0, 300),
      videoId: videoId,
      startIndex: Math.max(0, Math.min(lines.length - 1, Number(raw.startIndex) || 0)),
      pronunciations: pronunciationMap,
      lines: lines
    };
  }

  function sendToGas(message) {
    if (!window.opener || window.opener.closed || !returnOrigin || !session) return false;
    window.opener.postMessage(Object.assign({ session: session, version: 2 }, message), returnOrigin);
    return true;
  }

  function currentLine() {
    return lesson && lesson.lines[currentIndex] ? lesson.lines[currentIndex] : null;
  }

  function buildWordSegments(flags) {
    var tokens = currentLine().text.split(/\s+/);
    var segments = [], activeMiss = null, flagIndex = 0;
    tokens.forEach(function (raw) {
      var normalized = words(raw);
      var tokenFlags = flags.slice(flagIndex, flagIndex + normalized.length);
      flagIndex += normalized.length;
      var correct = !normalized.length || tokenFlags.every(Boolean);
      if (correct) {
        activeMiss = null;
        segments.push({ correct: true, label: raw });
        return;
      }
      if (!activeMiss) {
        activeMiss = { correct: false, labels: [], words: [] };
        segments.push(activeMiss);
      }
      activeMiss.labels.push(raw);
      activeMiss.words = activeMiss.words.concat(normalized);
    });
    return segments.map(function (segment) {
      if (segment.correct) return segment;
      segment.label = segment.labels.join(' ');
      segment.key = segment.words.join(' ');
      return segment;
    });
  }

  function stripIpa(value) {
    return String(value || '').trim().replace(/^\/+|\/+$/g, '').trim();
  }

  function pronunciationFor(segment) {
    var direct = pronunciations[segment.key];
    if (direct && direct.ipa) return direct;
    var entries = segment.words.map(function (word) { return pronunciations[word]; });
    if (entries.length && entries.every(function (entry) { return entry && entry.ipa; })) {
      return {
        ipa: '/' + entries.map(function (entry) { return stripIpa(entry.ipa); }).join(' ') + '/',
        audio: entries.length === 1 ? entries[0].audio : '',
        source: entries.some(function (entry) { return entry.source === 'ai'; }) ? 'ai' : 'dictionary'
      };
    }
    return null;
  }

  function playMistake(segment) {
    stopAudio();
    var pronunciation = pronunciationFor(segment);
    var audioUrl = pronunciation && String(pronunciation.audio || '');
    if (audioUrl) {
      audioUrl = audioUrl.indexOf('//') === 0 ? 'https:' + audioUrl : audioUrl.replace(/^http:/, 'https:');
      try {
        pronunciationAudio = new Audio(audioUrl);
        pronunciationAudio.addEventListener('error', function () { speakPhrase(segment.label); }, { once: true });
        var started = pronunciationAudio.play();
        if (started && typeof started.catch === 'function') started.catch(function () { speakPhrase(segment.label); });
        return;
      } catch (e) {}
    }
    speakPhrase(segment.label);
  }

  function speakPhrase(text) {
    if (!window.speechSynthesis) return;
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US'; utterance.rate = .78;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function requestMissingPronunciations(segments) {
    var missing = [];
    segments.filter(function (segment) { return !segment.correct; }).forEach(function (segment) {
      segment.words.forEach(function (word) {
        var pronunciation = pronunciations[word];
        if ((!pronunciation || !pronunciation.ipa || !pronunciation.audio) &&
            !requestedWords[word] && missing.indexOf(word) === -1) missing.push(word);
      });
    });
    missing = missing.slice(0, 16);
    if (!missing.length) return;
    missing.forEach(function (word) { requestedWords[word] = 'pending'; });
    pronunciationRequest++;
    var requestId = String(pronunciationRequest);
    pronunciationBatches[requestId] = missing;
    if (!sendToGas({ type: MESSAGE_LOOKUP, requestId: requestId, words: missing })) {
      missing.forEach(function (word) { requestedWords[word] = 'done'; });
    }
  }

  function renderWords(result) {
    result.segments = result.segments || buildWordSegments(result.flags);
    requestMissingPronunciations(result.segments);
    var hasMistakes = false;
    el.words.textContent = '';
    result.segments.forEach(function (segment, index, list) {
      if (segment.correct) {
        var span = document.createElement('span');
        span.className = 'ok';
        span.textContent = segment.label + (index < list.length - 1 ? ' ' : '');
        el.words.appendChild(span);
        return;
      }
      hasMistakes = true;
      var pronunciation = pronunciationFor(segment);
      var button = document.createElement('button');
      var label = document.createElement('span');
      var ipa = document.createElement('small');
      var waiting = segment.words.some(function (word) { return requestedWords[word] === 'pending'; });
      button.type = 'button';
      button.className = 'mistake-token' + (waiting ? ' loading' : '');
      button.title = 'Nghe phát âm: ' + segment.label;
      button.setAttribute('aria-label', 'Nghe phát âm ' + segment.label + (pronunciation && pronunciation.ipa ? ', ' + pronunciation.ipa : ''));
      label.textContent = segment.label;
      ipa.textContent = pronunciation && pronunciation.ipa
        ? pronunciation.ipa + (pronunciation.source === 'ai' ? ' · AI' : '')
        : waiting ? 'Đang lấy IPA…' : 'Chưa có IPA';
      if (pronunciation && pronunciation.source === 'ai') {
        ipa.title = 'IPA tham khảo do AI bổ sung';
      }
      button.appendChild(label); button.appendChild(ipa);
      button.addEventListener('click', function () { playMistake(segment); });
      el.words.appendChild(button);
      if (index < list.length - 1) el.words.appendChild(document.createTextNode(' '));
    });
    el.mistakeHint.hidden = !hasMistakes;
  }

  function renderResult(result) {
    var percent = Math.round(result.score * 100);
    el.recorder.hidden = true;
    el.result.hidden = false;
    el.dial.style.setProperty('--score', percent);
    el.score.textContent = percent;
    el.scoreTitle.textContent = percent >= 80 ? 'Câu nói đã rõ và đủ ý' : percent >= 50 ? 'Gần đạt — sửa các từ đỏ' : 'Nghe mẫu rồi thử lại';
    el.heard.textContent = '“' + result.heard + '”';
    el.nextResult.textContent = currentIndex >= lesson.lines.length - 1 ? 'Xem kết quả phiên' : 'Câu tiếp theo';
    renderWords(result);
  }

  function setStatus(title, hint, isListening) {
    el.statusTitle.textContent = title;
    el.statusHint.textContent = hint;
    el.recorder.classList.toggle('listening', !!isListening);
    el.recordLabel.textContent = isListening ? 'Dừng và chấm' : 'Bắt đầu nói';
  }

  function errorMessage(code) {
    var messages = {
      'not-allowed': 'Micro đang bị chặn. Hãy cho phép quyền micro trong cài đặt trình duyệt rồi thử lại.',
      'service-not-allowed': 'Trình duyệt không cho phép dịch vụ nhận dạng giọng nói trên trang này.',
      'audio-capture': 'Không tìm thấy micro đang hoạt động.',
      'no-speech': 'Chưa nghe thấy giọng nói. Hãy đưa micro gần hơn và thử lại.',
      'network': 'Dịch vụ nhận dạng đang mất kết nối. Hãy kiểm tra mạng và thử lại.'
    };
    return messages[code] || 'Không thể nhận dạng giọng nói lúc này. Hãy thử lại.';
  }

  function stopRecognition() {
    if (!recognition) return;
    recognitionFinished = true;
    try { recognition.abort(); } catch (e) {}
    recognition = null;
    el.recorder.classList.remove('listening');
  }

  function startRecognition() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!window.isSecureContext) {
      setStatus('Trang chưa chạy qua HTTPS', 'Micro chỉ hoạt động trên kết nối an toàn.', false);
      return;
    }
    if (!SpeechRecognition) {
      setStatus('Trình duyệt chưa hỗ trợ', 'Hãy mở trang này bằng Chrome hoặc Edge phiên bản mới.', false);
      el.record.disabled = true;
      return;
    }
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
      return;
    }
    stopAudio();
    recognitionFinished = false;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = function () {
      setStatus('Đang nghe bạn nói…', 'Đọc hết câu, hệ thống sẽ tự chấm khi bạn dừng.', true);
    };
    recognition.onresult = function (event) {
      var heard = event.results && event.results[0] && event.results[0][0]
        ? String(event.results[0][0].transcript || '').trim() : '';
      if (heard) showResult(heard);
    };
    recognition.onerror = function (event) {
      recognitionFinished = true;
      setStatus('Chưa ghi nhận được câu nói', errorMessage(event.error), false);
    };
    recognition.onend = function () {
      recognition = null;
      if (!recognitionFinished) setStatus('Chưa nghe trọn câu', 'Bấm micro và đọc lại một lần nữa.', false);
    };
    try {
      recognition.start();
    } catch (e) {
      recognition = null;
      setStatus('Không mở được micro', 'Đóng các ứng dụng đang dùng micro rồi thử lại.', false);
    }
  }

  function showResult(heard) {
    var result = compare(currentLine().text, heard);
    result.heard = heard;
    recognitionFinished = true;
    results[currentIndex] = result;
    if (result.score >= .8) passed[currentIndex] = true;
    el.recorder.classList.remove('listening');
    el.sendStatus.textContent = sendToGas({ type: MESSAGE_RESULT, index: currentIndex, heard: heard, clientScore: result.score, createdAt: Date.now() })
      ? 'Đang đồng bộ tiến độ với English Lab…' : 'Kết quả đang được giữ trong phiên này.';
    renderResult(result);
    if (autoAdvance && result.score >= AUTO_ADVANCE_SCORE) {
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(nextLine, 1300);
    }
  }

  function retry() {
    clearTimeout(advanceTimer);
    el.result.hidden = true;
    el.recorder.hidden = false;
    el.sendStatus.textContent = '';
    setStatus('Sẵn sàng thử lại', 'Nghe lại audio gốc nếu cần, rồi đọc tự nhiên.', false);
  }

  function renderLine() {
    var line = currentLine();
    clearTimeout(advanceTimer);
    stopRecognition();
    stopAudio();
    el.lesson.textContent = lesson.topic;
    el.progress.textContent = 'Câu ' + (currentIndex + 1) + ' / ' + lesson.lines.length;
    el.progressFill.style.width = ((currentIndex + 1) / lesson.lines.length * 100) + '%';
    el.target.textContent = line.text;
    el.translation.textContent = line.vi;
    el.translation.hidden = !line.vi;
    el.previous.disabled = currentIndex === 0;
    el.next.textContent = currentIndex >= lesson.lines.length - 1 ? 'Kết thúc phiên →' : 'Câu sau →';
    el.scriptCard.classList.toggle('blind', hiddenText);
    el.result.hidden = true;
    el.mistakeHint.hidden = true;
    el.recorder.hidden = false;
    setStatus('Sẵn sàng khi bạn sẵn sàng', 'Nghe câu mẫu, sau đó bấm micro và đọc theo.', false);
    if (results[currentIndex]) renderResult(results[currentIndex]);
    sendToGas({ type: MESSAGE_NAVIGATE, index: currentIndex });
  }

  function goTo(index) {
    if (!lesson) return;
    if (index < 0) index = 0;
    if (index >= lesson.lines.length) { finishSession(); return; }
    currentIndex = index;
    renderLine();
  }

  function nextLine() { goTo(currentIndex + 1); }
  function previousLine() { goTo(currentIndex - 1); }

  function finishSession() {
    clearTimeout(advanceTimer);
    stopRecognition();
    stopAudio();
    var passedCount = Object.keys(passed).length;
    el.practice.hidden = true;
    el.summary.hidden = false;
    el.summaryPassed.textContent = passedCount;
    el.summaryTotal.textContent = lesson.lines.length;
    el.retryMissed.hidden = passedCount >= lesson.lines.length;
    el.summaryHint.textContent = sendToGas({ type: MESSAGE_FINISH, passed: passedCount, total: lesson.lines.length })
      ? 'Tiến độ đã được đồng bộ về English Lab.' : 'Không tìm thấy tab English Lab; kết quả chỉ được giữ trong phiên này.';
  }

  function retryMissed() {
    var missed = lesson.lines.findIndex(function (_, index) { return !passed[index]; });
    if (missed < 0) missed = 0;
    el.summary.hidden = true;
    el.practice.hidden = false;
    goTo(missed);
  }

  function closeRoom() {
    sendToGas({ type: MESSAGE_FINISH, passed: Object.keys(passed).length, total: lesson ? lesson.lines.length : 0 });
    window.close();
  }

  function stopAudio() {
    clearInterval(audioPoll);
    audioPoll = null;
    if (player && player.pauseVideo) try { player.pauseVideo(); } catch (e) {}
    if (pronunciationAudio) {
      try { pronunciationAudio.pause(); } catch (e) {}
      pronunciationAudio = null;
    }
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
  }

  function speakWithBrowser() {
    if (!window.speechSynthesis) return;
    var utterance = new SpeechSynthesisUtterance(currentLine().text);
    utterance.lang = 'en-US';
    utterance.rate = slow ? .68 : .92;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function playSample() {
    var line = currentLine();
    stopRecognition();
    stopAudio();
    if (!lesson.videoId || line.t == null || playerFailed) {
      speakWithBrowser();
      return;
    }
    if (!playerReady || !player) {
      setStatus('Audio gốc đang tải…', 'Đợi một chút rồi bấm nghe lại.', false);
      return;
    }
    try {
      player.seekTo(Math.max(0, line.t - .3), true);
      player.setPlaybackRate(slow ? .75 : 1);
      player.playVideo();
      if (line.end != null && line.end > line.t) {
        audioPoll = setInterval(function () {
          try { if (player.getCurrentTime() >= line.end) stopAudio(); }
          catch (e) { stopAudio(); }
        }, 160);
      }
    } catch (e) {
      playerFailed = true;
      el.videoStage.hidden = true;
      el.sampleLabel.textContent = 'Nghe giọng trình duyệt';
      speakWithBrowser();
    }
  }

  function loadYouTubePlayer() {
    if (!lesson.videoId) {
      el.videoStage.hidden = true;
      el.sampleLabel.textContent = 'Nghe giọng trình duyệt';
      return;
    }
    el.videoStage.hidden = false;
    window.onYouTubeIframeAPIReady = function () {
      player = new window.YT.Player('ytPlayer', {
        width: '580', height: '326', videoId: lesson.videoId,
        playerVars: { playsinline: 1, controls: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: {
          onReady: function () { playerReady = true; },
          onError: function () {
            playerFailed = true;
            el.videoStage.hidden = true;
            el.sampleLabel.textContent = 'Nghe giọng trình duyệt';
          },
          onAutoplayBlocked: function () {
            setStatus('Trình duyệt đang chặn audio', 'Bấm nút Play trên video một lần, sau đó dùng “Nghe audio gốc”.', false);
          }
        }
      });
    };
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.id = 'youtube-iframe-api';
    document.head.appendChild(tag);
  }

  function startLesson(rawLesson) {
    lesson = safeLesson(rawLesson);
    if (!lesson) {
      showConnectionError('Bài học không có câu hợp lệ để luyện.');
      return;
    }
    pronunciations = Object.assign({}, lesson.pronunciations || {});
    requestedWords = {};
    pronunciationBatches = {};
    clearTimeout(connectionTimer);
    currentIndex = lesson.startIndex;
    el.empty.hidden = true;
    el.summary.hidden = true;
    el.practice.hidden = false;
    loadYouTubePlayer();
    renderLine();
  }

  function showConnectionError(message) {
    el.empty.hidden = false;
    el.practice.hidden = true;
    el.summary.hidden = true;
    el.emptyEyebrow.textContent = 'Không nhận được bài học';
    el.emptyTitle.textContent = message;
    el.emptyHint.textContent = 'Quay lại English Lab, giữ tab đó mở và bấm “Mở phiên luyện nói” lần nữa.';
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== returnOrigin || (window.opener && event.source !== window.opener)) return;
    var data = event.data || {};
    if (data.session !== session) return;
    if (data.type === MESSAGE_SESSION) {
      startLesson(data.lesson);
      return;
    }
    if (data.type === MESSAGE_PRONUNCIATIONS) {
      var requestId = String(data.requestId || '');
      var batch = pronunciationBatches[requestId] || [];
      batch.forEach(function (word) { requestedWords[word] = 'done'; });
      delete pronunciationBatches[requestId];
      (Array.isArray(data.items) ? data.items : []).slice(0, 16).forEach(function (item) {
        var word = String(item && item.word || '').toLowerCase().trim();
        if (!/^[a-z][a-z'-]{0,39}$/.test(word)) return;
        pronunciations[word] = {
          ipa: String(item.ipa || '').trim().slice(0, 200),
          audio: String(item.audio || '').trim().slice(0, 1000),
          source: String(item.source || 'dictionary').slice(0, 30)
        };
      });
      if (results[currentIndex] && !el.result.hidden) renderResult(results[currentIndex]);
      return;
    }
    if (data.type === MESSAGE_ACCEPTED && results[data.index]) {
      results[data.index].score = Number(data.score) || 0;
      if (data.passed) passed[data.index] = true;
      if (Number(data.index) === currentIndex && !el.result.hidden) {
        renderResult(results[data.index]);
        el.sendStatus.textContent = 'Đã đồng bộ với English Lab.';
      }
    }
  });

  el.record.addEventListener('click', startRecognition);
  el.retry.addEventListener('click', retry);
  el.nextResult.addEventListener('click', nextLine);
  el.sample.addEventListener('click', playSample);
  el.previous.addEventListener('click', previousLine);
  el.next.addEventListener('click', nextLine);
  el.retryMissed.addEventListener('click', retryMissed);
  el.close.addEventListener('click', closeRoom);
  el.speed.addEventListener('click', function () {
    slow = !slow;
    el.speed.setAttribute('aria-pressed', String(slow));
  });
  el.hide.addEventListener('click', function () {
    hiddenText = !hiddenText;
    el.hide.setAttribute('aria-pressed', String(hiddenText));
    el.hide.textContent = hiddenText ? 'Hiện lời' : 'Ẩn lời';
    el.scriptCard.classList.toggle('blind', hiddenText);
  });
  el.autoAdvance.addEventListener('change', function () {
    autoAdvance = el.autoAdvance.checked;
    clearTimeout(advanceTimer);
    try { localStorage.setItem(AUTO_ADVANCE_STORAGE, String(autoAdvance)); } catch (e) {}
    var current = results[currentIndex];
    if (autoAdvance && current && !el.result.hidden && current.score >= AUTO_ADVANCE_SCORE) {
      advanceTimer = setTimeout(nextLine, 1300);
    }
  });

  el.empty.hidden = false;
  if (session && returnOrigin && window.opener) {
    sendToGas({ type: MESSAGE_READY });
    connectionTimer = setTimeout(function () {
      if (!lesson) showConnectionError('Kết nối với English Lab đã hết thời gian chờ.');
    }, 6000);
  } else if (params.get('target')) {
    startLesson({
      topic: params.get('lesson') || 'Bản thử',
      videoId: params.get('videoId') || '',
      startIndex: 0,
      lines: [{
        text: params.get('target'),
        vi: params.get('translation') || '',
        t: params.get('t') == null ? null : Number(params.get('t')),
        end: params.get('end') == null ? null : Number(params.get('end'))
      }]
    });
  } else {
    showConnectionError('Hãy mở phòng thu từ màn Shadowing.');
  }
}());
