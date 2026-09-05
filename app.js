(function () {
  'use strict';

  var MESSAGE_RESULT = 'english-lab-shadow-result';
  var MESSAGE_READY = 'english-lab-shadow-ready';
  var MESSAGE_ACCEPTED = 'english-lab-shadow-accepted';
  var params = new URLSearchParams(location.hash.replace(/^#/, ''));
  var session = params.get('session') || '';
  var target = params.get('target') || '';
  var translation = params.get('translation') || '';
  var returnOrigin = validOrigin(params.get('returnOrigin'));
  var recognition = null;
  var currentResult = null;
  var finished = false;

  var el = {
    empty: document.getElementById('emptyState'),
    practice: document.getElementById('practiceState'),
    lesson: document.getElementById('lessonLabel'),
    progress: document.getElementById('progressLabel'),
    target: document.getElementById('targetText'),
    translation: document.getElementById('translationText'),
    sample: document.getElementById('sampleButton'),
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
    send: document.getElementById('sendButton'),
    sendStatus: document.getElementById('sendStatus')
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

  function renderWords(flags) {
    var flagIndex = 0;
    el.words.textContent = '';
    target.split(/\s+/).forEach(function (word, index, list) {
      var span = document.createElement('span');
      var isWord = words(word).length > 0;
      span.className = isWord && flags[flagIndex++] ? 'ok' : 'miss';
      span.textContent = word + (index < list.length - 1 ? ' ' : '');
      el.words.appendChild(span);
    });
  }

  function showResult(heard) {
    var result = compare(target, heard);
    var percent = Math.round(result.score * 100);
    currentResult = { heard: heard, score: result.score };
    finished = true;
    el.recorder.classList.remove('listening');
    el.recorder.hidden = true;
    el.result.hidden = false;
    el.dial.style.setProperty('--score', percent);
    el.score.textContent = percent;
    el.scoreTitle.textContent = percent >= 80 ? 'Câu nói đã rõ và đủ ý' : percent >= 50 ? 'Gần đạt — sửa các từ đỏ' : 'Nghe mẫu rồi thử lại';
    el.heard.textContent = '“' + heard + '”';
    el.sendStatus.textContent = '';
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

    finished = false;
    recognition = new SpeechRecognition();
    recognition.lang = params.get('lang') || 'en-US';
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
      finished = true;
      setStatus('Chưa ghi nhận được câu nói', errorMessage(event.error), false);
    };
    recognition.onend = function () {
      recognition = null;
      if (!finished) setStatus('Chưa nghe trọn câu', 'Bấm micro và đọc lại một lần nữa.', false);
    };
    try {
      recognition.start();
    } catch (e) {
      recognition = null;
      setStatus('Không mở được micro', 'Đóng các ứng dụng đang dùng micro rồi thử lại.', false);
    }
  }

  function retry() {
    currentResult = null;
    finished = false;
    el.result.hidden = true;
    el.recorder.hidden = false;
    setStatus('Sẵn sàng thử lại', 'Bấm micro và đọc tự nhiên, không cần nói quá chậm.', false);
  }

  function sendResult() {
    if (!currentResult) return;
    if (!window.opener || window.opener.closed || !returnOrigin || !session) {
      el.sendStatus.textContent = 'Không tìm thấy tab English Lab. Hãy quay lại tab cũ và mở phòng thu lại.';
      return;
    }
    el.send.disabled = true;
    el.sendStatus.textContent = 'Đang gửi kết quả…';
    window.opener.postMessage({
      type: MESSAGE_RESULT,
      version: 1,
      session: session,
      heard: currentResult.heard,
      clientScore: currentResult.score,
      createdAt: Date.now()
    }, returnOrigin);
    window.setTimeout(function () {
      if (!el.sendStatus.textContent.includes('đã nhận')) {
        el.send.disabled = false;
        el.sendStatus.textContent = 'Chưa thấy English Lab phản hồi. Giữ tab này và quay lại tab English Lab để kiểm tra.';
      }
    }, 3500);
  }

  function speakSample() {
    if (!target || !window.speechSynthesis) return;
    var utterance = new SpeechSynthesisUtterance(target);
    utterance.lang = 'en-US';
    utterance.rate = .88;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== returnOrigin) return;
    var data = event.data || {};
    if (data.type !== MESSAGE_ACCEPTED || data.session !== session) return;
    el.sendStatus.textContent = 'English Lab đã nhận kết quả. Đang quay lại…';
    window.setTimeout(function () { window.close(); }, 650);
  });

  el.record.addEventListener('click', startRecognition);
  el.retry.addEventListener('click', retry);
  el.send.addEventListener('click', sendResult);
  el.sample.addEventListener('click', speakSample);

  if (!target) {
    el.empty.hidden = false;
  } else {
    el.practice.hidden = false;
    el.target.textContent = target;
    el.lesson.textContent = params.get('lesson') || 'Shadowing';
    var index = params.get('index');
    var total = params.get('total');
    el.progress.textContent = index && total ? 'Câu ' + index + ' / ' + total : 'Câu luyện';
    if (translation) {
      el.translation.textContent = translation;
      el.translation.hidden = false;
    }
    if (window.opener && returnOrigin && session) {
      window.opener.postMessage({ type: MESSAGE_READY, version: 1, session: session }, returnOrigin);
    }
  }
}());
