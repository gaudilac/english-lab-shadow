(function () {
  'use strict';

  var MESSAGE_READY = 'english-lab-shadow-ready';
  var MESSAGE_RESULT = 'english-lab-shadow-result';
  var MESSAGE_ACCEPTED = 'english-lab-shadow-accepted';
  var MESSAGE_SESSION = 'english-lab-shadow-session';
  var MESSAGE_NAVIGATE = 'english-lab-shadow-navigate';
  var MESSAGE_FINISH = 'english-lab-shadow-finish';
  var params = new URLSearchParams(location.hash.replace(/^#/, ''));
  var session = params.get('session') || '';
  var returnOrigin = validOrigin(params.get('returnOrigin'));
  var lesson = null;
  var currentIndex = 0;
  var recognition = null;
  var recognitionFinished = false;
  var results = {};
  var passed = {};
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
    return {
      id: String(raw.id || '').slice(0, 200),
      topic: String(raw.topic || 'Shadowing').slice(0, 300),
      videoId: videoId,
      startIndex: Math.max(0, Math.min(lines.length - 1, Number(raw.startIndex) || 0)),
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

  function renderWords(flags) {
    var line = currentLine();
    var flagIndex = 0;
    el.words.textContent = '';
    line.text.split(/\s+/).forEach(function (word, index, list) {
      var span = document.createElement('span');
      var isWord = words(word).length > 0;
      span.className = !isWord || flags[flagIndex++] ? 'ok' : 'miss';
      span.textContent = word + (index < list.length - 1 ? ' ' : '');
      el.words.appendChild(span);
    });
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
    renderWords(result.flags);
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
    if (result.score >= .8) {
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
