/*
 * Demo harness for Safari Translator.
 *
 * The real extension runs `content.js` on every page. Here we load the very
 * same file into a normal web page, but provide a small fake `browser` object
 * so no extension APIs and no network are needed. Translations come from the
 * local glossary below — this page is about interaction, not translation
 * quality.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Local "translation" data
   * ------------------------------------------------------------------ */

  var SENTENCES = {
    'Why We Sleep: The Science of Rest': '我们为什么要睡觉：休息的科学',
    'SCIENCE · 健康': '科学 · 健康',
    'By Ada Lin · 6 min read': '作者 Ada Lin · 阅读约 6 分钟',
    'Sleep is not a waste of time. While we rest, the brain consolidates memories, clears metabolic waste, and prepares for the day ahead.':
      '睡眠并不是浪费时间。当我们休息时，大脑会巩固记忆、清除代谢废物，并为新的一天做好准备。',
    'For most of human history, sleep was treated as a passive shutdown. Modern neuroscience tells a different story: the sleeping brain is busy, cycling through carefully staged patterns that keep the body and mind working.':
      '在人类历史的大部分时间里，睡眠被视为一种被动的“关机”。现代神经科学给出了不同的答案：睡着的大脑其实很忙碌，它以精心编排的模式循环，维持着身体与心智的运转。',
    'What happens during a night of sleep': '一夜睡眠中会发生什么',
    'A full night consists of four to six cycles. Each cycle moves through light sleep, deep sleep, and REM sleep.':
      '一整夜由四到六个周期组成。每个周期都会经历浅睡、深睡和快速眼动睡眠。',
    'Light sleep helps the body transition from wakefulness.':
      '浅睡帮助身体从清醒状态过渡。',
    'Deep sleep restores muscles and strengthens the immune system.':
      '深睡修复肌肉，并增强免疫系统。',
    'REM sleep supports learning and emotional processing.':
      '快速眼动睡眠支持学习与情绪处理。',
    'Sleep is the single most effective thing we can do to reset our brain and body health each day.':
      '睡眠是我们每天能做的、最有效的重置大脑与身体健康的一件事。',
    'Small changes that help': '有帮助的小改变',
    'Keep a consistent schedule, dim the lights an hour before bed, and keep the bedroom cool. Caffeine has a long half-life, so an afternoon coffee can still be active at midnight.':
      '保持规律的作息，睡前一小时调暗灯光，并让卧室保持凉爽。咖啡因的半衰期很长，所以下午的咖啡到午夜可能仍在起作用。',
    'Code and formulas are skipped on purpose:': '代码与公式会被有意跳过：',
    'If you struggle to fall asleep, get out of bed and read in dim light until you feel drowsy. Try not to turn bedtime into a battle.':
      '如果难以入睡，就起床在昏暗的灯光下读点书，直到感到困倦。尽量不要把睡觉变成一场战斗。',
    'A note for readers': '写给读者的话',
    'This page exists to demonstrate selection translation and bilingual page translation. Nothing is translated until you explicitly ask for it.':
      '这个页面用于演示划词翻译和双语整页翻译。在你明确要求之前，不会翻译任何内容。',
    '— End of the demo article —': '—— 演示文章结束 ——'
  };

  var WORDS = {
    sleep: '睡眠', sleeping: '睡眠中的', rest: '休息', brain: '大脑', body: '身体',
    memory: '记忆', memories: '记忆', health: '健康', healthy: '健康的',
    night: '夜晚', light: '光', deep: '深度', day: '一天', days: '日子',
    time: '时间', people: '人们', person: '人', learn: '学习', learning: '学习',
    study: '研究', mind: '心智', work: '工作', works: '运作', help: '帮助',
    small: '小', change: '改变', changes: '改变', science: '科学',
    immune: '免疫', system: '系统', muscle: '肌肉', muscles: '肌肉',
    dream: '梦', dreams: '梦', bed: '床', read: '阅读', book: '书',
    hour: '小时', hours: '小时', cool: '凉爽', warm: '温暖', quiet: '安静',
    dark: '黑暗', morning: '早晨', early: '早', late: '晚', caffeine: '咖啡因',
    exercise: '运动', stress: '压力', anxiety: '焦虑', focus: '专注',
    attention: '注意力', emotion: '情绪', emotional: '情绪的', waste: '废物',
    clear: '清除', clears: '清除', prepare: '准备', prepares: '准备',
    cycle: '周期', cycles: '周期', stage: '阶段', staged: '分阶段的',
    temperature: '温度', hormone: '激素', growth: '生长', repair: '修复',
    restore: '恢复', restores: '修复', strengthen: '增强', strengthens: '增强',
    transition: '过渡', wakefulness: '清醒', passive: '被动的', busy: '忙碌的',
    effective: '有效的', reset: '重置', schedule: '作息', consistent: '规律的',
    bedroom: '卧室', half: '一半', life: '寿命', afternoon: '下午',
    coffee: '咖啡', midnight: '午夜', bedtime: '就寝时间', battle: '战斗',
    drowsy: '困倦', readers: '读者', reader: '读者', note: '说明',
    demonstrate: '演示', selection: '划词', translation: '翻译',
    explicitly: '明确地', ask: '要求', page: '页面', content: '内容',
    nothing: '没有什么', until: '直到', feel: '感觉', turn: '变成',
    try: '尝试', get: '走', out: '出去', dim: '昏暗的', read: '阅读'
  };

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function translateText(text) {
    var key = normalize(text);
    if (!key) return '';
    if (SENTENCES[key]) return SENTENCES[key];

    var lower = key.toLowerCase();
    var known = Object.keys(SENTENCES).find(function (sentence) {
      return sentence.toLowerCase() === lower;
    });
    if (known) return SENTENCES[known];

    var replaced = key.replace(/[A-Za-z][A-Za-z'-]*/g, function (word) {
      var hit = WORDS[word.toLowerCase()];
      return hit || word;
    });

    if (replaced === key) return '（演示译文）' + key;
    return replaced;
  }

  function delay(ms, value) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(value); }, ms);
    });
  }

  /* ------------------------------------------------------------------ *
   * Fake `browser` API
   * ------------------------------------------------------------------ */

  var settings = {
    provider: 'mymemory',
    sourceLang: 'auto',
    targetLang: 'zh-CN',
    selectionButton: true,
    pageMode: 'replace',
    theme: 'auto'
  };

  var changeListeners = [];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function reply(message) {
    if (!message || !message.type) {
      return { ok: false, error: { code: 'request', message: '无效的请求' } };
    }

    if (message.type === 'translate') {
      return delay(360, {
        ok: true,
        text: translateText(message.text),
        detected: 'en',
        provider: 'mymemory'
      });
    }

    if (message.type === 'translateBatch') {
      var texts = Array.isArray(message.texts) ? message.texts : [];
      return delay(420, {
        ok: true,
        results: texts.map(function (text) {
          return { ok: true, text: translateText(text), detected: 'en', provider: 'mymemory' };
        })
      });
    }

    if (message.type === 'pt:ping') return { ok: true, version: '1.1.0', demo: true };

    return { ok: false, error: { code: 'request', message: '演示模式不支持：' + message.type } };
  }

  var browser = {
    runtime: {
      id: 'safari-translator-demo',
      lastError: null,
      getURL: function (file) { return '../extension/' + file; },
      sendMessage: function (message, callback) {
        var answer = reply(message);
        var promise = answer && typeof answer.then === 'function'
          ? answer
          : Promise.resolve(answer);
        if (callback) promise.then(callback);
        return promise;
      },
      onMessage: {
        addListener: function () {},
        removeListener: function () {}
      },
      openOptionsPage: function () {
        setStatus('演示模式没有设置页；安装扩展后从工具栏或右键菜单打开。');
      }
    },
    storage: {
      local: {
        get: function (keys, callback) {
          var value = keys === 'settings' || keys == null || keys.settings !== undefined
            ? { settings: clone(settings) }
            : {};
          setTimeout(function () { if (callback) callback(value); }, 0);
          return Promise.resolve(value);
        },
        set: function (items, callback) {
          if (items && items.settings) {
            var previous = clone(settings);
            settings = clone(items.settings);
            changeListeners.forEach(function (fn) {
              fn({ settings: { oldValue: previous, newValue: clone(settings) } }, 'local');
            });
          }
          setTimeout(function () { if (callback) callback(); }, 0);
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: function (fn) { changeListeners.push(fn); },
        removeListener: function (fn) {
          var index = changeListeners.indexOf(fn);
          if (index >= 0) changeListeners.splice(index, 1);
        }
      }
    },
    i18n: { getUILanguage: function () { return 'zh-CN'; } }
  };

  window.browser = browser;

  /* ------------------------------------------------------------------ *
   * Toolbar
   * ------------------------------------------------------------------ */

  var statusNode = document.getElementById('demo-status');

  function setStatus(message) {
    if (statusNode) statusNode.textContent = message;
  }

  function whenReady(callback) {
    if (window.__PT_CONTENT__) {
      callback(window.__PT_CONTENT__);
      return;
    }
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (window.__PT_CONTENT__ || tries > 100) {
        clearInterval(timer);
        if (window.__PT_CONTENT__) callback(window.__PT_CONTENT__);
        else setStatus('内容脚本没有加载成功，请查看控制台错误。');
      }
    }, 30);
  }

  function selectElement(element) {
    var range = document.createRange();
    range.selectNodeContents(element);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  }

  function rectOf(range) {
    var rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      return { left: window.innerWidth / 2 - 40, top: 220, right: window.innerWidth / 2 + 40, bottom: 260, width: 80, height: 40 };
    }
    return rect;
  }

  function findTarget() {
    return document.getElementById('quote') || document.getElementById('pick') || document.querySelector('article p');
  }

  function actions(action) {
    whenReady(function (api) {
      var target = findTarget();
      var range;
      var text;

      switch (action) {
        case 'select':
          range = selectElement(target);
          document.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            clientX: rectOf(range).left + 10,
            clientY: rectOf(range).top + 10
          }));
          setStatus('已选中一段文字。松开鼠标后出现的「翻译」按钮就是划词入口。');
          break;

        case 'selection':
          range = selectElement(target);
          text = normalize(target.textContent);
          api.translateSelection(text, rectOf(range));
          setStatus('正在翻译所选文字…');
          break;

        case 'bilingual':
          api.translatePage('bilingual');
          setStatus('整页双语对照翻译中；每段译文会插入在原文下方。');
          break;

        case 'replace':
          api.translatePage('replace');
          setStatus('整页替换翻译中；点击「还原原文」即可恢复。');
          break;

        case 'restore':
          api.restorePage();
          setStatus('已还原原文。');
          break;

        case 'close':
          window.getSelection().removeAllRanges();
          api.closePanel();
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          setStatus('已关闭译文卡片。自动整页翻译可在扩展弹窗或设置中关闭。');
          break;

        default:
          break;
      }
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-action]'), function (button) {
    button.addEventListener('click', function () {
      actions(button.getAttribute('data-action'));
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      window.getSelection().removeAllRanges();
    }
  });
})();
