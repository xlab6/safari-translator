/*
 * Safari Translator — shared runtime.
 *
 * Loaded in the background page, content scripts, popup and options page.
 * Everything lives on a single `PT` namespace so the files can be plain
 * classic scripts (MV2, no bundler, no remote code).
 */
(function (global) {
  'use strict';

  var PT = (global.PT = global.PT || {});

  PT.VERSION = '1.0.3';

  /* ------------------------------------------------------------------ *
   * Languages
   * ------------------------------------------------------------------ */

  // Codes are BCP-47-ish and are mapped per provider below. `auto` is only
  // ever offered as a source language.
  PT.LANGUAGES = [
    { code: 'zh-CN', zh: '简体中文', en: 'Chinese (Simplified)' },
    { code: 'zh-TW', zh: '繁体中文', en: 'Chinese (Traditional)' },
    { code: 'en', zh: '英语', en: 'English' },
    { code: 'ja', zh: '日语', en: 'Japanese' },
    { code: 'ko', zh: '韩语', en: 'Korean' },
    { code: 'fr', zh: '法语', en: 'French' },
    { code: 'de', zh: '德语', en: 'German' },
    { code: 'es', zh: '西班牙语', en: 'Spanish' },
    { code: 'it', zh: '意大利语', en: 'Italian' },
    { code: 'pt', zh: '葡萄牙语', en: 'Portuguese' },
    { code: 'ru', zh: '俄语', en: 'Russian' },
    { code: 'ar', zh: '阿拉伯语', en: 'Arabic' },
    { code: 'th', zh: '泰语', en: 'Thai' },
    { code: 'vi', zh: '越南语', en: 'Vietnamese' },
    { code: 'id', zh: '印尼语', en: 'Indonesian' },
    { code: 'ms', zh: '马来语', en: 'Malay' },
    { code: 'tr', zh: '土耳其语', en: 'Turkish' },
    { code: 'nl', zh: '荷兰语', en: 'Dutch' },
    { code: 'pl', zh: '波兰语', en: 'Polish' },
    { code: 'sv', zh: '瑞典语', en: 'Swedish' },
    { code: 'da', zh: '丹麦语', en: 'Danish' },
    { code: 'fi', zh: '芬兰语', en: 'Finnish' },
    { code: 'no', zh: '挪威语', en: 'Norwegian' },
    { code: 'cs', zh: '捷克语', en: 'Czech' },
    { code: 'el', zh: '希腊语', en: 'Greek' },
    { code: 'he', zh: '希伯来语', en: 'Hebrew' },
    { code: 'hi', zh: '印地语', en: 'Hindi' },
    { code: 'uk', zh: '乌克兰语', en: 'Ukrainian' },
    { code: 'fa', zh: '波斯语', en: 'Persian' },
    { code: 'tl', zh: '菲律宾语', en: 'Filipino' }
  ];

  PT.AUTO_LANGUAGE = { code: 'auto', zh: '自动检测', en: 'Auto-detect' };

  var LANGUAGE_BY_CODE = {};
  PT.LANGUAGES.forEach(function (lang) {
    LANGUAGE_BY_CODE[lang.code] = lang;
  });

  PT.isLangCode = function (code) {
    return code === 'auto' || Object.prototype.hasOwnProperty.call(LANGUAGE_BY_CODE, code);
  };

  PT.languageName = function (code) {
    if (!code) return '';
    if (code === 'auto') return PT.AUTO_LANGUAGE.zh;
    var lang = LANGUAGE_BY_CODE[code];
    return lang ? lang.zh : code;
  };

  PT.baseLang = function (code) {
    return String(code || '').toLowerCase().split(/[-_]/)[0];
  };

  PT.defaultTarget = function () {
    var ui = '';
    try {
      var api = global.browser || global.chrome;
      if (api && api.i18n && api.i18n.getUILanguage) ui = api.i18n.getUILanguage() || '';
      if (!ui && global.navigator) ui = global.navigator.language || '';
    } catch (e) { /* ignore */ }
    if (/^zh/i.test(ui)) {
      // Hong Kong / Macau / Taiwan users read Traditional Chinese.
      return /hant|tw|hk|mo/i.test(ui) ? 'zh-TW' : 'zh-CN';
    }
    return 'en';
  };

  /*
   * Provider language codes. BCP-47 is the default; only the providers whose
   * API uses something else need an entry here.
   *
   * Tencent Cloud TMT uses `zh` / `zh_TW` / `ja` / `ko` (see the TextTranslate
   * documentation). Alibaba Cloud uses `zh` / `zh-tw` / `ja` / `ko`.
   * Azure uses `zh-Hans` / `zh-Hant`.
   */
  var LANG_MAPS = {
    azure: {
      'zh-CN': 'zh-Hans',
      'zh-TW': 'zh-Hant',
      'no': 'nb',
      'tl': 'fil'
    },
    aliyun: {
      'zh-CN': 'zh',
      'zh-TW': 'zh-tw',
      'tl': 'fil'
    },
    tencent: {
      'zh-CN': 'zh',
      'zh-TW': 'zh_TW',
      'ja': 'ja',
      'ko': 'ko'
    },
    libre: {
      'zh-CN': 'zh',
      'zh-TW': 'zt'
    },
    deepl: {
      'zh-CN': 'ZH',
      'zh-TW': 'ZH',
      'en': 'EN',
      'ja': 'JA',
      'ko': 'KO',
      'pt': 'PT',
      'no': 'NB'
    },
    mymemory: {
      'zh-CN': 'zh-CN',
      'zh-TW': 'zh-TW'
    }
  };

  PT.mapLang = function (provider, code, isTarget) {
    if (!code || code === 'auto') return 'auto';
    var map = LANG_MAPS[provider] || {};
    var mapped = map[code] || code;

    if (provider === 'deepl') {
      if (code === 'zh-CN') return isTarget ? 'ZH-HANS' : 'ZH';
      if (code === 'zh-TW') return isTarget ? 'ZH-HANT' : 'ZH';
      if (code === 'pt') return isTarget ? 'PT-PT' : 'PT';
      return String(mapped).toUpperCase();
    }

    return mapped;
  };

  // Turn whatever a provider reports back into one of our UI codes.
  PT.normalizeDetected = function (provider, code) {
    if (!code) return '';
    var value = String(code).toLowerCase().replace(/_/g, '-');
    if (value === 'zh' || value === 'zh-cn' || value.indexOf('zh-hans') === 0) return 'zh-CN';
    if (value === 'zh-tw' || value === 'zh-hant' || value === 'zt') return 'zh-TW';
    if (value === 'jp') return 'ja';
    if (value === 'kr') return 'ko';
    if (value === 'iw') return 'he';
    if (value === 'in') return 'id';
    var base = value.split('-')[0];
    return LANGUAGE_BY_CODE[base] ? base : base;
  };

  /* ------------------------------------------------------------------ *
   * Providers
   * ------------------------------------------------------------------ */

  PT.PROVIDERS = [
    {
      id: 'mymemory',
      name: 'MyMemory',
      label: 'MyMemory 免费翻译',
      badge: '免费',
      badgeTone: 'free',
      desc: '无需密钥，注册邮箱可提升每日额度。',
      docs: 'https://mymemory.translated.net/doc/spec.php',
      keyless: true
    },
    {
      id: 'google',
      name: 'Google 翻译',
      label: 'Google 翻译',
      badge: '免费',
      badgeTone: 'free',
      desc: '无需密钥，中国大陆网络通常无法访问。',
      docs: 'https://translate.google.com/',
      keyless: true
    },
    {
      id: 'azure',
      name: 'Microsoft Translator',
      label: '微软翻译',
      badge: '需密钥',
      badgeTone: 'key',
      desc: 'Azure AI 翻译，质量稳定，每月有免费额度。',
      docs: 'https://learn.microsoft.com/azure/ai-services/translator/',
      keyless: false
    },
    {
      id: 'aliyun',
      name: 'Alibaba Cloud',
      label: '阿里云机器翻译',
      badge: '需密钥',
      badgeTone: 'key',
      desc: '国内访问稳定，按字符计费，支持自动检测。',
      docs: 'https://help.aliyun.com/product/27256.html',
      keyless: false
    },
    {
      id: 'tencent',
      name: 'Tencent Cloud',
      label: '腾讯云机器翻译',
      badge: '需密钥',
      badgeTone: 'key',
      desc: '国内访问稳定，每月有免费字符额度。',
      docs: 'https://cloud.tencent.com/product/tmt',
      keyless: false
    },
    {
      id: 'deepl',
      name: 'DeepL',
      label: 'DeepL',
      badge: '需密钥',
      badgeTone: 'key',
      desc: '欧洲语言质量出色，提供 Free 与 Pro 套餐。',
      docs: 'https://www.deepl.com/pro-api',
      keyless: false
    },
    {
      id: 'libre',
      name: 'LibreTranslate',
      label: 'LibreTranslate',
      badge: '自建',
      badgeTone: 'self',
      desc: '开源翻译服务，可填写公共实例或自建地址。',
      docs: 'https://libretranslate.com/',
      keyless: false
    },
    {
      id: 'openai',
      name: 'OpenAI Compatible',
      label: 'OpenAI 兼容接口',
      badge: '自定义',
      badgeTone: 'self',
      desc: '支持 OpenAI、DeepSeek、Ollama 等兼容服务。',
      docs: 'https://platform.openai.com/docs/api-reference/chat',
      keyless: false
    }
  ];

  PT.providerMeta = function (id) {
    for (var i = 0; i < PT.PROVIDERS.length; i++) {
      if (PT.PROVIDERS[i].id === id) return PT.PROVIDERS[i];
    }
    return PT.PROVIDERS[0];
  };

  PT.providerName = function (id) {
    return PT.providerMeta(id).name;
  };

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */

  PT.defaultSettings = function () {
    return {
      provider: 'mymemory',
      sourceLang: 'auto',
      targetLang: PT.defaultTarget(),
      pageMode: 'replace',
      selectionButton: true,
      theme: 'auto',

      // Microsoft Translator (Azure)
      azureKey: '',
      azureRegion: '',
      azureEndpoint: 'https://api.cognitive.microsofttranslator.com',

      // Alibaba Cloud
      aliyunKeyId: '',
      aliyunKeySecret: '',
      aliyunRegion: 'cn-hangzhou',

      // Tencent Cloud
      tencentSecretId: '',
      tencentSecretKey: '',
      tencentRegion: 'ap-guangzhou',

      // DeepL
      deeplKey: '',
      deeplPlan: 'free',

      // LibreTranslate
      libreUrl: 'https://libretranslate.com',
      libreKey: '',

      // OpenAI-compatible
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiKey: '',
      openaiModel: 'gpt-4o-mini'
    };
  };

  PT.normalizeSettings = function (input) {
    var out = PT.defaultSettings();
    if (input && typeof input === 'object') {
      Object.keys(input).forEach(function (key) {
        if (input[key] !== undefined && input[key] !== null) out[key] = input[key];
      });
    }

    var known = PT.PROVIDERS.some(function (p) { return p.id === out.provider; });
    if (!known) out.provider = 'mymemory';

    if (!PT.isLangCode(out.targetLang) || out.targetLang === 'auto') {
      out.targetLang = PT.defaultTarget();
    }
    if (!PT.isLangCode(out.sourceLang)) out.sourceLang = 'auto';

    if (out.pageMode !== 'bilingual' && out.pageMode !== 'replace') out.pageMode = 'replace';
    if (['auto', 'light', 'dark'].indexOf(out.theme) === -1) out.theme = 'auto';
    if (out.deeplPlan !== 'pro') out.deeplPlan = 'free';

    out.selectionButton = out.selectionButton !== false;
    out.sourceLang = out.sourceLang === 'auto' ? 'auto' : out.sourceLang;

    return out;
  };

  PT.validateProvider = function (settings) {
    var id = settings && settings.provider;
    function missing(message) {
      return {
        code: 'config',
        provider: id,
        message: message,
        hint: '打开扩展设置，填写翻译服务所需的密钥后即可使用。'
      };
    }
    function filled(value) {
      return typeof value === 'string' && value.trim().length > 0;
    }

    switch (id) {
      case 'mymemory':
      case 'google':
        return null;

      case 'azure':
        if (!filled(settings.azureKey)) return missing('请填写微软翻译的订阅密钥');
        return null;

      case 'aliyun':
        if (!filled(settings.aliyunKeyId) || !filled(settings.aliyunKeySecret)) {
          return missing('请填写阿里云 AccessKey ID 和 AccessKey Secret');
        }
        return null;

      case 'tencent':
        if (!filled(settings.tencentSecretId) || !filled(settings.tencentSecretKey)) {
          return missing('请填写腾讯云 SecretId 和 SecretKey');
        }
        return null;

      case 'deepl':
        if (!filled(settings.deeplKey)) return missing('请填写 DeepL API Key');
        return null;

      case 'libre':
        if (!filled(settings.libreUrl)) return missing('请填写 LibreTranslate 服务地址');
        try {
          var url = PT.normalizeEndpoint(settings.libreUrl);
          if (!/^https?:\/\//i.test(url)) throw new Error('bad protocol');
        } catch (e) {
          return missing('LibreTranslate 服务地址格式不正确');
        }
        return null;

      case 'openai':
        if (!filled(settings.openaiBaseUrl)) return missing('请填写 OpenAI 兼容接口地址');
        if (!filled(settings.openaiModel)) return missing('请填写模型名称');
        return null;

      default:
        return missing('请选择翻译服务');
    }
  };

  PT.normalizeEndpoint = function (url) {
    var value = String(url || '').trim();
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
    return value.replace(/\/+$/, '');
  };

  /* ------------------------------------------------------------------ *
   * Storage helpers (browser.* promises, chrome.* callbacks)
   * ------------------------------------------------------------------ */

  function getApi() {
    return global.browser || global.chrome || null;
  }

  PT.getApi = getApi;

  function callArea(area, method, arg) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(err, value) {
        if (settled) return;
        settled = true;
        if (err) reject(err); else resolve(value);
      }
      var result;
      try {
        result = area[method](arg, function (value) {
          var lastError = getApi() && getApi().runtime && getApi().runtime.lastError;
          finish(lastError ? new Error(lastError.message || String(lastError)) : null, value);
        });
      } catch (e) {
        finish(e);
        return;
      }
      if (result && typeof result.then === 'function') {
        result.then(function (value) { finish(null, value); }, function (err) { finish(err); });
      } else if (area[method].length < 2) {
        finish(null, result);
      }
    });
  }

  PT.storageGet = function (keys) {
    var api = getApi();
    if (!api || !api.storage || !api.storage.local) {
      return Promise.reject(new Error('storage is unavailable'));
    }
    return callArea(api.storage.local, 'get', keys);
  };

  PT.storageSet = function (items) {
    var api = getApi();
    if (!api || !api.storage || !api.storage.local) {
      return Promise.reject(new Error('storage is unavailable'));
    }
    return callArea(api.storage.local, 'set', items);
  };

  PT.loadSettings = function () {
    return PT.storageGet('settings').then(function (stored) {
      return PT.normalizeSettings(stored && stored.settings);
    });
  };

  PT.saveSettings = function (settings) {
    var normalized = PT.normalizeSettings(settings);
    return PT.storageSet({ settings: normalized }).then(function () {
      return normalized;
    });
  };

  PT.updateSettings = function (patch) {
    return PT.loadSettings().then(function (current) {
      return PT.saveSettings(Object.assign({}, current, patch || {}));
    });
  };

  PT.onSettingsChanged = function (callback) {
    var api = getApi();
    if (!api || !api.storage || !api.storage.onChanged || !api.storage.onChanged.addListener) {
      return function () {};
    }
    function listener(changes, areaName) {
      if (areaName && areaName !== 'local') return;
      if (!changes || !changes.settings) return;
      callback(PT.normalizeSettings(changes.settings.newValue));
    }
    api.storage.onChanged.addListener(listener);
    return function () {
      if (api.storage.onChanged.removeListener) {
        api.storage.onChanged.removeListener(listener);
      }
    };
  };

  /* ------------------------------------------------------------------ *
   * Text utilities
   * ------------------------------------------------------------------ */

  PT.normalizeText = function (text) {
    return String(text == null ? '' : text)
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * Split long text on sentence boundaries so that providers with per-request
   * limits (MyMemory: 500 bytes, Tencent: 2000 chars, ...) can still handle
   * paragraphs. Never drops content.
   */
  PT.splitText = function (text, maxLength) {
    var limit = Math.max(40, maxLength || 1500);
    var rest = String(text || '').trim();
    var parts = [];

    while (rest.length > limit) {
      var windowText = rest.slice(0, limit);
      var cut = -1;

      // Prefer a sentence boundary in the second half of the window.
      var match = windowText.match(/[\s\S]*[.!?。！？；;](?=\s|["'”’）)]|$)/);
      if (match && match[0].length >= limit * 0.4) {
        cut = match[0].length;
      } else {
        var space = windowText.lastIndexOf(' ');
        if (space >= limit * 0.4) cut = space + 1;
      }
      if (cut <= 0) cut = limit;

      var piece = rest.slice(0, cut).trim();
      if (piece) parts.push(piece);
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  };

  /** Split by UTF-8 byte budget (ASCII = 1 byte, everything else = 3). */
  PT.splitByBytes = function (text, maxBytes) {
    var limit = Math.max(20, maxBytes || 450);
    var value = String(text || '');
    var parts = [];
    var current = '';
    var bytes = 0;

    for (var i = 0; i < value.length; i++) {
      var ch = value[i];
      var size = ch.charCodeAt(0) < 128 ? 1 : 3;
      if (bytes + size > limit && current) {
        parts.push(current);
        current = '';
        bytes = 0;
      }
      current += ch;
      bytes += size;
    }
    if (current) parts.push(current);
    return parts;
  };

  /* ------------------------------------------------------------------ *
   * Language detection (cheap, local, good enough for candidate hints)
   * ------------------------------------------------------------------ */

  var TRADITIONAL_HINTS = /[們個這說國時會來對開裡麼樣進還學覺為與從點見讓體]/;

  PT.detectLanguage = function (text) {
    var value = String(text || '');
    if (!value.trim()) return '';

    if (/[\u3040-\u30ff]/.test(value)) return 'ja';
    if (/[\uac00-\ud7af]/.test(value)) return 'ko';
    if (/[\u4e00-\u9fff]/.test(value)) {
      return TRADITIONAL_HINTS.test(value) ? 'zh-TW' : 'zh-CN';
    }
    if (/[\u0400-\u04ff]/.test(value)) return 'ru';
    if (/[\u0600-\u06ff]/.test(value)) return 'ar';
    if (/[\u0e00-\u0e7f]/.test(value)) return 'th';
    if (/[\u0900-\u097f]/.test(value)) return 'hi';
    if (/[\u0590-\u05ff]/.test(value)) return 'he';
    if (/[\u0370-\u03ff]/.test(value)) return 'el';
    if (/[\u0e80-\u0eff]/.test(value)) return 'lo';
    return 'en';
  };

  PT.shouldTranslate = function (text, targetLang) {
    var value = PT.normalizeText(text);
    if (value.length < 2 || value.length > 6000) return false;
    if (!/\p{L}/u.test(value)) return false;
    if (/^(https?:\/\/|www\.)\S+$/i.test(value)) return false;
    if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(value)) return false;

    var detected = PT.detectLanguage(value);
    if (!detected) return false;
    if (PT.baseLang(detected) === PT.baseLang(targetLang)) return false;
    if (PT.baseLang(targetLang) === 'en' && !/[A-Za-z]/.test(value)) return false;

    return true;
  };

  /* ------------------------------------------------------------------ *
   * Errors
   * ------------------------------------------------------------------ */

  function ProviderError(code, message, extra) {
    this.name = 'ProviderError';
    this.code = code || 'unknown';
    this.message = message || '翻译失败';
    if (extra) {
      if (extra.hint) this.hint = extra.hint;
      if (extra.provider) this.provider = extra.provider;
      if (extra.detail) this.detail = extra.detail;
      if (extra.status) this.status = extra.status;
    }
    if (Error.captureStackTrace) Error.captureStackTrace(this, ProviderError);
  }
  ProviderError.prototype = Object.create(Error.prototype);
  ProviderError.prototype.constructor = ProviderError;
  PT.ProviderError = ProviderError;

  PT.errorHints = {
    auth: '请检查密钥是否正确，并确认已开通对应的翻译服务。',
    quota: '额度已用完或请求过于频繁，请稍后再试，或在设置中更换翻译服务。',
    lang: '该服务不支持当前语言组合，请更换目标语言或翻译服务。',
    network: '无法连接翻译服务。请检查网络；在中国大陆，Google 翻译通常不可用。',
    timeout: '翻译服务响应超时，请稍后重试。',
    server: '翻译服务暂时不可用，请稍后重试。',
    config: '请先在扩展设置中完成翻译服务配置。',
    'no-tab': '请确认 Safari 中有一个打开的网页，并让该网页处于最前面。',
    request: '请求被翻译服务拒绝，请检查设置或稍后重试。',
    empty: '没有可翻译的文本。',
    unknown: '翻译失败，请稍后重试。'
  };

  PT.serializeError = function (error) {
    return {
      code: (error && error.code) || 'unknown',
      message: (error && error.message) || '翻译失败',
      hint: (error && error.hint) || PT.errorHints[(error && error.code) || 'unknown'] || '',
      provider: (error && error.provider) || '',
      detail: (error && error.detail) || ''
    };
  };

  /* ------------------------------------------------------------------ *
   * Misc UI helpers
   * ------------------------------------------------------------------ */

  PT.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  };

  PT.copyText = function (text) {
    var value = String(text == null ? '' : text);
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(value).then(function () { return true; }, function () {
        return legacyCopy(value);
      });
    }
    return Promise.resolve(legacyCopy(value));
  };

  function legacyCopy(value) {
    try {
      var area = global.document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      global.document.body.appendChild(area);
      area.select();
      var ok = global.document.execCommand && global.document.execCommand('copy');
      area.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  PT.openOptionsPage = function () {
    var api = getApi();
    if (!api) return Promise.reject(new Error('extension API unavailable'));
    if (api.runtime.openOptionsPage) {
      try {
        var result = api.runtime.openOptionsPage();
        if (result && result.then) return result;
        return Promise.resolve();
      } catch (e) { /* fall through */ }
    }
    if (api.tabs && api.tabs.create) {
      return Promise.resolve(api.tabs.create({ url: api.runtime.getURL('options.html') }));
    }
    return Promise.reject(new Error('cannot open options'));
  };

  /* ------------------------------------------------------------------ *
   * Environment probe — used by the UI to explain restrictions
   * ------------------------------------------------------------------ */

  PT.isSafari = function () {
    var ua = (global.navigator && global.navigator.userAgent) || '';
    return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua);
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
