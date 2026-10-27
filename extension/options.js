(function () {
  'use strict';

  var PT = window.PT;
  if (!PT) return;

  var api = PT.getApi();

  var settings = null;
  var pending = {};
  var saveTimer = null;
  var flushChain = Promise.resolve();
  var stateTimer = null;
  var testing = false;

  var FIELDS = {
    azure: [
      {
        key: 'azureKey',
        label: '订阅密钥（Key）',
        type: 'password',
        placeholder: '粘贴 Azure 门户中的密钥',
        required: true,
        hint: 'Azure 门户 → 翻译器资源 → “密钥和终结点”。'
      },
      {
        key: 'azureRegion',
        label: '区域（Region）',
        type: 'text',
        placeholder: 'eastasia',
        hint: '多区域资源的密钥需要填写；单区域资源可留空。'
      },
      {
        key: 'azureEndpoint',
        label: '服务端点',
        type: 'url',
        placeholder: 'https://api.cognitive.microsofttranslator.com',
        hint: '通常无需修改，除非使用自定义域名。'
      }
    ],
    aliyun: [
      {
        key: 'aliyunKeyId',
        label: 'AccessKey ID',
        type: 'text',
        placeholder: 'LTAI…',
        required: true,
        hint: '建议使用仅授予“机器翻译”权限的 RAM 子账号。'
      },
      {
        key: 'aliyunKeySecret',
        label: 'AccessKey Secret',
        type: 'password',
        placeholder: '粘贴 AccessKey Secret',
        required: true,
        hint: 'RAM 子账号需具备 AliyunMTFullAccess 或等效权限。'
      },
      {
        key: 'aliyunRegion',
        label: '地域 ID',
        type: 'text',
        placeholder: 'cn-hangzhou',
        hint: '机器翻译服务通常使用 cn-hangzhou。'
      }
    ],
    tencent: [
      {
        key: 'tencentSecretId',
        label: 'SecretId',
        type: 'text',
        placeholder: 'AKID…',
        required: true,
        hint: '腾讯云控制台 → 访问管理 → API 密钥管理。'
      },
      {
        key: 'tencentSecretKey',
        label: 'SecretKey',
        type: 'password',
        placeholder: '粘贴 SecretKey',
        required: true,
        hint: '建议使用仅授权“机器翻译”的子账号密钥。'
      },
      {
        key: 'tencentRegion',
        label: '地域',
        type: 'text',
        placeholder: 'ap-guangzhou',
        hint: '机器翻译通常使用 ap-guangzhou。'
      }
    ],
    deepl: [
      {
        key: 'deeplKey',
        label: 'API 密钥',
        type: 'password',
        placeholder: '粘贴 DeepL API Key',
        required: true,
        hint: 'Free 与 Pro 的密钥不能混用，请同时选择正确的套餐。'
      },
      {
        key: 'deeplPlan',
        label: '套餐',
        type: 'select',
        options: [
          { value: 'free', label: 'Free（api-free.deepl.com）' },
          { value: 'pro', label: 'Pro（api.deepl.com）' }
        ],
        hint: 'Free 套餐每月有 50 万字符额度。'
      }
    ],
    libre: [
      {
        key: 'libreUrl',
        label: '服务地址',
        type: 'url',
        placeholder: 'https://libretranslate.com',
        required: true,
        hint: '公共实例可能需要 API Key；也可以填写自建实例，如 http://localhost:5000。'
      },
      {
        key: 'libreKey',
        label: 'API Key（可选）',
        type: 'password',
        placeholder: '公共实例或自建实例的密钥',
        hint: '留空表示不发送密钥。'
      }
    ],
    openai: [
      {
        key: 'openaiBaseUrl',
        label: '接口地址',
        type: 'url',
        placeholder: 'https://api.openai.com/v1',
        required: true,
        hint: '兼容 OpenAI Chat Completions 的服务地址，可填 DeepSeek、Ollama 等。'
      },
      {
        key: 'openaiKey',
        label: 'API Key',
        type: 'password',
        placeholder: 'sk-…',
        hint: '本地 Ollama 等无需密钥的服务可以留空。'
      },
      {
        key: 'openaiModel',
        label: '模型',
        type: 'text',
        placeholder: 'gpt-4o-mini',
        required: true,
        hint: '需支持 Chat Completions 接口，例如 gpt-4o-mini、deepseek-chat。'
      }
    ]
  };

  var KEYLESS_NOTES = {
    mymemory:
      'MyMemory 无需密钥即可使用。在 mymemory.translated.net 注册邮箱后可提升每日额度；大量翻译建议改用云服务。',
    google:
      'Google 翻译无需密钥，但中国大陆网络通常无法连接。若测试失败，请改用 MyMemory、微软或国内云服务。'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setSaveState(tone, text) {
    var pill = $('save-state');
    pill.setAttribute('data-tone', tone);
    pill.textContent = text;
    clearTimeout(stateTimer);
    if (tone === 'saved') {
      stateTimer = setTimeout(function () {
        pill.setAttribute('data-tone', 'muted');
        pill.textContent = '已保存';
      }, 2200);
    }
  }

  // Only changed keys are written. Sending the whole object made two pages
  // overwrite each other's edits with stale values.
  function mark(key, value) {
    settings[key] = value;
    pending[key] = value;
    scheduleSave();
  }

  function scheduleSave() {
    setSaveState('saving', '保存中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 450);
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;

    var patch = pending;
    pending = {};
    if (!Object.keys(patch).length) return flushChain;

    var run = async function () {
      try {
        var saved = await PT.updateSettings(patch);
        settings = Object.assign({}, saved, pending);
        if (!Object.keys(pending).length) setSaveState('saved', '已保存');
      } catch (error) {
        pending = Object.assign({}, patch, pending);
        setSaveState('error', '保存失败');
      }
    };

    flushChain = flushChain.then(run, run);
    return flushChain;
  }

  async function saveNow() {
    return flush();
  }

  /* ------------------------------------------------------------------ *
   * Providers
   * ------------------------------------------------------------------ */

  function renderProviders() {
    var wrap = $('providers');
    wrap.textContent = '';

    PT.PROVIDERS.forEach(function (meta) {
      var card = el('button', 'provider-card');
      card.type = 'button';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', settings.provider === meta.id ? 'true' : 'false');
      card.setAttribute('data-provider', meta.id);

      var top = el('div', 'provider-top');
      top.appendChild(el('span', 'provider-name', meta.name));
      var chip = el('span', 'chip', meta.badge);
      chip.setAttribute('data-tone', meta.badgeTone || 'key');
      top.appendChild(chip);

      card.appendChild(top);
      card.appendChild(el('span', 'provider-desc', meta.desc));

      card.addEventListener('click', function () {
        selectProvider(meta.id);
      });

      wrap.appendChild(card);
    });
  }

  async function selectProvider(id) {
    if (!settings || settings.provider === id) return;
    mark('provider', id);
    hideTestResult();
    renderProviders();
    renderConfigMeta();
    renderFields();
    await saveNow();
  }

  function renderConfigMeta() {
    var meta = PT.providerMeta(settings.provider);
    $('config-desc').textContent = meta.desc;

    var link = $('docs-link');
    if (meta.docs) {
      link.href = meta.docs;
      link.textContent = '查看 ' + meta.name + ' 文档 ↗';
      link.hidden = false;
    } else {
      link.hidden = true;
    }
  }

  /* ------------------------------------------------------------------ *
   * Credential fields
   * ------------------------------------------------------------------ */

  var EYE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.2"/>' +
    '<path d="M6.2 6.2A17.5 17.5 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 4.2-.9"/>' +
    '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  function renderFields() {
    var wrap = $('fields');
    wrap.textContent = '';

    var fields = FIELDS[settings.provider] || [];

    if (!fields.length) {
      var note = el('div', 'empty-config');
      note.appendChild(el('strong', '', PT.providerName(settings.provider)));
      note.appendChild(document.createTextNode(' 无需填写密钥。'));
      if (KEYLESS_NOTES[settings.provider]) {
        note.appendChild(document.createTextNode(' ' + KEYLESS_NOTES[settings.provider]));
      }
      wrap.appendChild(note);
      return;
    }

    fields.forEach(function (field) {
      var row = el('div', 'field');
      var labelRow = el('div', 'field-label');
      labelRow.appendChild(el('strong', '', field.label));
      if (field.required) labelRow.appendChild(el('span', 'required', '必填'));
      row.appendChild(labelRow);

      if (field.type === 'select') {
        var select = document.createElement('select');
        select.id = 'field-' + field.key;
        (field.options || []).forEach(function (option) {
          var node = document.createElement('option');
          node.value = option.value;
          node.textContent = option.label;
          select.appendChild(node);
        });
        select.value = settings[field.key] || (field.options && field.options[0] && field.options[0].value) || '';
        select.addEventListener('change', function () {
          mark(field.key, select.value);
          saveNow();
        });
        row.appendChild(select);
      } else {
        var inputWrap = el('div', 'input-wrap');
        var input = document.createElement('input');
        input.id = 'field-' + field.key;
        input.type = field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text';
        input.value = settings[field.key] || '';
        input.placeholder = field.placeholder || '';
        input.autocomplete = 'off';
        input.spellcheck = false;

        input.addEventListener('input', function () {
          if (field.type === 'password') {
            // Re-evaluate the “required” hint without rebuilding the field.
            inputWrap.setAttribute('data-filled', input.value ? 'true' : 'false');
          }
          mark(field.key, input.value);
        });

        inputWrap.appendChild(input);

        if (field.type === 'password') {
          var reveal = el('button', 'reveal');
          reveal.type = 'button';
          reveal.setAttribute('aria-label', '显示或隐藏密钥');
          reveal.innerHTML = EYE;
          reveal.addEventListener('click', function () {
            var shown = input.type === 'text';
            input.type = shown ? 'password' : 'text';
            reveal.innerHTML = shown ? EYE : EYE_OFF;
            input.focus();
          });
          inputWrap.appendChild(reveal);
        }

        row.appendChild(inputWrap);
      }

      if (field.hint) row.appendChild(el('div', 'field-hint', field.hint));
      wrap.appendChild(row);
    });
  }

  /* ------------------------------------------------------------------ *
   * Test
   * ------------------------------------------------------------------ */

  function hideTestResult() {
    var box = $('test-result');
    box.hidden = true;
    box.textContent = '';
  }

  function showTestResult(tone, title, text, hint) {
    var box = $('test-result');
    box.textContent = '';
    box.hidden = false;
    box.setAttribute('data-tone', tone);

    box.appendChild(el('div', 'test-title', title));
    if (text) box.appendChild(el('div', 'test-text', text));
    if (hint) box.appendChild(el('div', 'test-hint', hint));
  }

  async function testProvider() {
    if (testing || !settings) return;

    var problem = PT.validateProvider(settings);
    if (problem) {
      showTestResult('error', '无法测试', problem.message, problem.hint || '请先补全上方配置。');
      return;
    }

    testing = true;
    var button = $('test');
    button.disabled = true;
    button.textContent = '测试中…';
    hideTestResult();

    var timer = setTimeout(function () {
      if (testing) {
        testing = false;
        button.disabled = false;
        button.textContent = '测试翻译';
        showTestResult('error', '测试超时', '服务在 60 秒内没有响应。', '请检查网络、代理或服务地址。');
      }
    }, 60000);

    try {
      var response = await api.runtime.sendMessage({
        __pt: true,
        type: 'test-provider',
        settings: settings,
        text: 'Hello, world!'
      });

      if (!testing) return;

      if (!response || !response.ok) {
        var info = (response && response.error) || {};
        throw Object.assign(new Error(info.message || '测试失败'), info);
      }

      var provider = PT.providerName(response.provider || settings.provider);
      var hint = response.detected
        ? '检测到原文语言：' + PT.languageName(response.detected)
        : '目标语言：' + PT.languageName(settings.targetLang);
      showTestResult('ok', '测试成功 · ' + provider, response.text, hint);
    } catch (error) {
      if (!testing) return;
      showTestResult(
        'error',
        '测试失败',
        (error && error.message) || '未知错误',
        (error && error.hint) || ''
      );
    } finally {
      clearTimeout(timer);
      testing = false;
      button.disabled = false;
      button.textContent = '测试翻译';
    }
  }

  /* ------------------------------------------------------------------ *
   * Languages / modes / toggles
   * ------------------------------------------------------------------ */

  function renderLanguages() {
    var source = $('source-lang');
    source.textContent = '';
    var auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = '自动检测';
    source.appendChild(auto);
    PT.LANGUAGES.forEach(function (lang) {
      var option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.zh;
      source.appendChild(option);
    });
    source.value = settings.sourceLang;
    if (source.value !== 'auto' && !PT.isLangCode(source.value)) source.value = 'auto';

    var target = $('target-lang');
    target.textContent = '';
    PT.LANGUAGES.forEach(function (lang) {
      var option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.zh;
      target.appendChild(option);
    });
    target.value = settings.targetLang;
    if (!target.value) target.value = PT.defaultTarget();
  }

  function renderModes() {
    Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (button) {
      var active = button.getAttribute('data-mode') === settings.pageMode;
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function renderToggles() {
    $('selection-button').checked = settings.selectionButton !== false;
    $('theme').value = settings.theme || 'auto';
  }

  function renderVersion() {
    $('version').textContent = PT.VERSION + ' · macOS Safari';
  }

  function renderAll() {
    renderProviders();
    renderConfigMeta();
    renderFields();
    renderLanguages();
    renderModes();
    renderToggles();
    renderVersion();
  }

  /* ------------------------------------------------------------------ *
   * Reset
   * ------------------------------------------------------------------ */

  async function resetAll() {
    if (!window.confirm('确定恢复默认设置？已保存的服务密钥将被清除，此操作不可撤销。')) return;

    // Drop edits that have not been written yet so they cannot come back
    // after the defaults are saved.
    pending = {};
    clearTimeout(saveTimer);
    saveTimer = null;

    try {
      await PT.saveSettings(PT.defaultSettings());
      settings = await PT.loadSettings();
      renderAll();
      hideTestResult();
      setSaveState('saved', '已恢复默认');
    } catch (error) {
      setSaveState('error', '恢复失败');
    }
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  async function init() {
    try {
      settings = await PT.loadSettings();
    } catch (error) {
      settings = PT.defaultSettings();
      setSaveState('error', '读取设置失败');
    }

    renderAll();

    $('source-lang').addEventListener('change', function (event) {
      mark('sourceLang', event.target.value);
      saveNow();
    });

    $('target-lang').addEventListener('change', function (event) {
      var value = event.target.value;
      if (!PT.isLangCode(value) || value === 'auto') return;
      mark('targetLang', value);
      saveNow();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (button) {
      button.addEventListener('click', function () {
        mark('pageMode', button.getAttribute('data-mode'));
        renderModes();
        saveNow();
      });
    });

    $('selection-button').addEventListener('change', function (event) {
      mark('selectionButton', event.target.checked);
      saveNow();
    });

    $('theme').addEventListener('change', function (event) {
      mark('theme', event.target.value);
      saveNow();
    });

    $('test').addEventListener('click', testProvider);
    $('reset').addEventListener('click', resetAll);

    // Safari may reuse an existing options tab (or restore it from the
    // back/forward cache), so re-read storage whenever the page is shown
    // again instead of trusting the in-memory copy.
    window.addEventListener('pageshow', syncFromStorage);
    window.addEventListener('focus', syncFromStorage);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') syncFromStorage();
    });
    if (api.storage && api.storage.onChanged && api.storage.onChanged.addListener) {
      api.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName && areaName !== 'local') return;
        if (!changes || !changes.settings) return;
        if (document.hasFocus()) return;
        syncFromStorage();
      });
    }
  }

  async function syncFromStorage() {
    if (!settings || saveTimer || Object.keys(pending).length) return;
    try {
      var latest = await PT.loadSettings();
      var changed = Object.keys(latest).some(function (key) {
        return JSON.stringify(latest[key]) !== JSON.stringify(settings[key]);
      });
      if (!changed) return;
      settings = latest;
      renderAll();
      hideTestResult();
    } catch (error) {
      // Keep the values already on screen when storage cannot be read.
    }
  }

  init();
})();
