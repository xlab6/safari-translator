/*
 * Safari Translator — provider adapters.
 *
 * Everything here runs inside the background page. Keeping the network calls
 * out of content scripts means provider responses are not subject to the host
 * page's CORS policy, and API keys never touch the page's JS context.
 */
(function (global) {
  'use strict';

  var PT = global.PT;
  if (!PT) throw new Error('common.js must be loaded before providers.js');

  var ProviderError = PT.ProviderError;
  var DEFAULT_TIMEOUT = 20000;
  var CACHE_LIMIT = 600;

  var cache = new Map();
  var inflight = new Map();

  /* ------------------------------------------------------------------ *
   * Crypto / encoding helpers
   * ------------------------------------------------------------------ */

  var encoder = new TextEncoder();

  function bytes(value) {
    return value instanceof Uint8Array ? value : encoder.encode(String(value));
  }

  function hex(buffer) {
    var view = new Uint8Array(buffer);
    var out = '';
    for (var i = 0; i < view.length; i++) {
      out += view[i].toString(16).padStart(2, '0');
    }
    return out;
  }

  function base64(buffer) {
    var view = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
    return btoa(binary);
  }

  async function digest(algorithm, value) {
    return crypto.subtle.digest(algorithm, bytes(value));
  }

  async function hmac(algorithm, key, message) {
    var cryptoKey = await crypto.subtle.importKey(
      'raw',
      bytes(key),
      { name: 'HMAC', hash: { name: algorithm } },
      false,
      ['sign']
    );
    return crypto.subtle.sign('HMAC', cryptoKey, bytes(message));
  }

  async function sha256Hex(value) {
    return hex(await digest('SHA-256', value));
  }

  function randomNonce() {
    try {
      if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    } catch (e) { /* ignore */ }
    var out = '';
    var alphabet = '0123456789abcdef';
    for (var i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * 16)];
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Network helpers
   * ------------------------------------------------------------------ */

  async function request(url, init, provider, timeout) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout || DEFAULT_TIMEOUT);
    var options = Object.assign({}, init || {}, { signal: controller.signal });

    try {
      return await fetch(url, options);
    } catch (error) {
      var aborted = error && (error.name === 'AbortError' || /aborted/i.test(error.message || ''));
      throw new ProviderError(
        aborted ? 'timeout' : 'network',
        aborted ? '翻译服务响应超时' : '无法连接翻译服务',
        {
          provider: provider,
          detail: (error && error.message) || String(error),
          hint: PT.errorHints[aborted ? 'timeout' : 'network']
        }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function readBody(response) {
    var raw = '';
    try {
      raw = await response.text();
    } catch (e) { /* ignore */ }
    var data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = null;
      }
    }
    return { raw: raw, data: data, ok: response.ok, status: response.status };
  }

  function detailOf(payload) {
    if (!payload) return '';
    var data = payload.data;
    if (!data || typeof data !== 'object') return String(payload.raw || '').slice(0, 240);
    return (
      (data.error && (data.error.message || data.error.code)) ||
      data.message ||
      data.Message ||
      data.error_msg ||
      (data.Response && data.Response.Error && data.Response.Error.Message) ||
      (data.base_resp && data.base_resp.status_msg) ||
      ''
    );
  }

  function httpError(provider, payload) {
    var status = payload.status;
    var code = 'request';
    if (status === 401 || status === 403) code = 'auth';
    else if (status === 429) code = 'quota';
    else if (status === 400 || status === 404 || status === 422) code = 'request';
    else if (status >= 500) code = 'server';

    var detail = detailOf(payload);
    return new ProviderError(code, PT.providerName(provider) + ' 请求失败（HTTP ' + status + '）', {
      provider: provider,
      status: status,
      detail: detail,
      hint: PT.errorHints[code]
    });
  }

  function emptyResult(provider) {
    return new ProviderError('empty', '翻译服务没有返回内容', {
      provider: provider,
      hint: '请重试，或更换目标语言。'
    });
  }

  /* ------------------------------------------------------------------ *
   * Small text helpers
   * ------------------------------------------------------------------ */

  function joinChunks(parts, targetLang) {
    // Chinese/Japanese/Korean do not need spaces between sentences.
    var base = PT.baseLang(targetLang);
    var joiner = base === 'zh' || base === 'ja' || base === 'ko' ? '' : ' ';
    return parts.filter(Boolean).join(joiner);
  }

  async function translateChunked(text, limit, targetLang, runner) {
    if (text.length <= limit) return runner(text);

    var pieces = PT.splitText(text, limit);
    if (pieces.length <= 1) return runner(text);

    var translated = [];
    var detected = '';
    for (var i = 0; i < pieces.length; i++) {
      var result = await runner(pieces[i]);
      if (result.detected && !detected) detected = result.detected;
      translated.push(result.text);
    }
    return { text: joinChunks(translated, targetLang), detected: detected };
  }

  async function translateByBytes(text, maxBytes, targetLang, runner) {
    if (bytes(text).length <= maxBytes) return runner(text);

    var pieces = PT.splitByBytes(text, maxBytes);
    if (pieces.length <= 1) return runner(text);

    var translated = [];
    var detected = '';
    for (var i = 0; i < pieces.length; i++) {
      var result = await runner(pieces[i]);
      if (result.detected && !detected) detected = result.detected;
      translated.push(result.text);
    }
    return { text: joinChunks(translated, targetLang), detected: detected };
  }

  /* ------------------------------------------------------------------ *
   * MyMemory (no key)
   * ------------------------------------------------------------------ */

  async function translateMyMemory(cfg, text, from, to) {
    var provider = 'mymemory';
    var source = from === 'auto' ? PT.detectLanguage(text) : PT.mapLang(provider, from, false);
    var target = PT.mapLang(provider, to, true);

    if (!source || source === 'auto') source = 'en';
    if (PT.baseLang(source) === PT.baseLang(target)) {
      return { text: text, detected: source };
    }

    return translateByBytes(text, 450, to, async function (piece) {
      var url =
        'https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(piece) +
        '&langpair=' +
        encodeURIComponent(source + '|' + target);
      var response = await request(url, { method: 'GET' }, provider);
      var payload = await readBody(response);

      if (payload.data && payload.data.quotaFinished) {
        throw new ProviderError('quota', 'MyMemory 今日免费额度已用完', {
          provider: provider,
          hint: '明天再试，或改用微软、阿里云、腾讯云等翻译服务。'
        });
      }
      if (!payload.ok) throw httpError(provider, payload);
      if (!payload.data) {
        throw new ProviderError('server', 'MyMemory 返回了无法解析的响应', { provider: provider });
      }

      var status = Number(payload.data.responseStatus);
      if (status && status !== 200) {
        var message = (payload.data.responseDetails || '').toString();
        if (status === 429) {
          throw new ProviderError('quota', 'MyMemory 请求过于频繁或额度已用完', { provider: provider });
        }
        throw new ProviderError('request', 'MyMemory 请求失败：' + (message || status), {
          provider: provider,
          detail: message
        });
      }

      var translated = payload.data.responseData && payload.data.responseData.translatedText;
      translated = String(translated || '').trim();

      if (/^MYMEMORY WARNING/i.test(translated) || /QUERY LENGTH LIMIT EXCEEDED/i.test(translated)) {
        throw new ProviderError('quota', translated.slice(0, 120), { provider: provider });
      }
      if (!translated) throw emptyResult(provider);

      var detected = '';
      var matches = payload.data.matches || [];
      if (matches[0] && matches[0].source) detected = PT.normalizeDetected(provider, matches[0].source);
      if (!detected) detected = PT.normalizeDetected(provider, source);

      return { text: translated, detected: detected };
    });
  }

  /* ------------------------------------------------------------------ *
   * Google translate_a (no key)
   * ------------------------------------------------------------------ */

  async function translateGoogle(cfg, text, from, to) {
    var provider = 'google';
    var source = from === 'auto' ? 'auto' : PT.mapLang(provider, from, false);
    var target = PT.mapLang(provider, to, true);

    return translateChunked(text, 1600, to, async function (piece) {
      var params = new URLSearchParams();
      params.set('client', 'gtx');
      params.set('sl', source);
      params.set('tl', target);
      params.set('dt', 't');
      params.set('q', piece);

      var url = 'https://translate.googleapis.com/translate_a/single';
      var init;
      if (params.toString().length > 1800) {
        init = {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: params.toString()
        };
      } else {
        init = { method: 'GET' };
        url += '?' + params.toString();
      }

      var response = await request(url, init, provider);
      var payload = await readBody(response);
      if (!payload.ok) {
        if (payload.status === 429) {
          throw new ProviderError('quota', 'Google 翻译请求过于频繁', { provider: provider });
        }
        throw httpError(provider, payload);
      }
      if (!Array.isArray(payload.data) || !Array.isArray(payload.data[0])) {
        throw new ProviderError('server', 'Google 翻译返回了异常响应，可能被限流或无法访问', {
          provider: provider,
          detail: String(payload.raw || '').slice(0, 160)
        });
      }

      var translated = payload.data[0]
        .map(function (segment) { return (segment && segment[0]) || ''; })
        .join('')
        .trim();
      if (!translated) throw emptyResult(provider);

      return {
        text: translated,
        detected: PT.normalizeDetected(provider, payload.data[2] || '')
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * Microsoft Translator (Azure)
   * ------------------------------------------------------------------ */

  async function translateAzure(cfg, text, from, to) {
    var provider = 'azure';
    var endpoint = PT.normalizeEndpoint(cfg.azureEndpoint || 'https://api.cognitive.microsofttranslator.com');
    var target = PT.mapLang(provider, to, true);
    var source = from === 'auto' ? '' : PT.mapLang(provider, from, false);

    return translateChunked(text, 40000, to, async function (piece) {
      var url = endpoint + '/translate?api-version=3.0&to=' + encodeURIComponent(target);
      if (source) url += '&from=' + encodeURIComponent(source);

      var headers = {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': String(cfg.azureKey || '').trim()
      };
      var region = String(cfg.azureRegion || '').trim();
      if (region) headers['Ocp-Apim-Subscription-Region'] = region;

      var response = await request(
        url,
        {
          method: 'POST',
          headers: headers,
          body: JSON.stringify([{ Text: piece }])
        },
        provider
      );
      var payload = await readBody(response);
      if (!payload.ok) throw httpError(provider, payload);
      if (!Array.isArray(payload.data) || !payload.data[0] || !payload.data[0].translations) {
        throw new ProviderError('server', '微软翻译返回了异常响应', { provider: provider });
      }

      var first = payload.data[0];
      var translated = (first.translations[0] && first.translations[0].text) || '';
      if (!translated.trim()) throw emptyResult(provider);

      return {
        text: translated.trim(),
        detected: PT.normalizeDetected(provider, (first.detectedLanguage && first.detectedLanguage.language) || source)
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * Alibaba Cloud machine translation (RPC API, HMAC-SHA1)
   * ------------------------------------------------------------------ */

  // RFC 3986 percent-encoding as required by the Alibaba Cloud RPC signature.
  function aliEncode(value) {
    return encodeURIComponent(String(value))
      .replace(/[!'()*]/g, function (ch) {
        return '%' + ch.charCodeAt(0).toString(16).toUpperCase();
      });
  }

  function aliTimestamp(nowMs) {
    return new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  async function aliyunSignedUrl(cfg, text, from, to, nowMs) {
    var params = {
      AccessKeyId: String(cfg.aliyunKeyId || '').trim(),
      Action: 'TranslateGeneral',
      Format: 'JSON',
      FormatType: 'text',
      RegionId: String(cfg.aliyunRegion || 'cn-hangzhou').trim() || 'cn-hangzhou',
      Scene: 'general',
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: randomNonce(),
      SignatureVersion: '1.0',
      SourceLanguage: from === 'auto' ? 'auto' : PT.mapLang('aliyun', from, false),
      SourceText: text,
      TargetLanguage: PT.mapLang('aliyun', to, true),
      Timestamp: aliTimestamp(nowMs),
      Version: '2018-10-12'
    };

    var canonical = Object.keys(params)
      .sort()
      .map(function (key) { return aliEncode(key) + '=' + aliEncode(params[key]); })
      .join('&');

    var stringToSign = 'GET&%2F&' + aliEncode(canonical);
    var signature = base64(await hmac('SHA-1', String(cfg.aliyunKeySecret || '').trim() + '&', stringToSign));

    return (
      'https://mt.aliyuncs.com/?Signature=' +
      aliEncode(signature) +
      '&' +
      canonical
    );
  }

  async function translateAliyun(cfg, text, from, to) {
    var provider = 'aliyun';

    return translateChunked(text, 4500, to, async function (piece) {
      var url = await aliyunSignedUrl(cfg, piece, from, to, Date.now());
      var response = await request(url, { method: 'GET' }, provider);
      var payload = await readBody(response);

      if (!payload.data) throw httpError(provider, payload);

      var code = String(payload.data.Code || '');
      if (!payload.ok || (code && code !== '200')) {
        var message = payload.data.Message || payload.data.RequestId || '阿里云翻译请求失败';
        var mapped = 'request';
        if (/InvalidAccessKeyId|SignatureDoesNotMatch|Forbidden|Unauthorized|NoPermission/i.test(code)) mapped = 'auth';
        else if (/Throttling|Quota|LimitExceeded|AmountNotEnough/i.test(code)) mapped = 'quota';
        else if (/Language|NotSupport/i.test(code)) mapped = 'lang';
        else if (/InternalError|ServiceUnavailable|Timeout/i.test(code)) mapped = 'server';

        if (!payload.ok && code === '') {
          throw httpError(provider, payload);
        }
        throw new ProviderError(mapped, '阿里云翻译：' + message, {
          provider: provider,
          status: payload.status,
          detail: code,
          hint: PT.errorHints[mapped]
        });
      }

      var data = payload.data.Data || {};
      var translated = String(data.Translated || '').trim();
      if (!translated) throw emptyResult(provider);

      return {
        text: translated,
        detected: PT.normalizeDetected(provider, data.DetectedLanguage || (from === 'auto' ? '' : from))
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * Tencent Cloud machine translation (TC3-HMAC-SHA256)
   * ------------------------------------------------------------------ */

  function tencentCanonicalHeaders(headers) {
    return Object.keys(headers)
      .sort()
      .map(function (key) {
        return key.toLowerCase() + ':' + String(headers[key]).trim().toLowerCase() + '\n';
      })
      .join('');
  }

  async function tencentSignedRequest(cfg, text, from, to, nowMs) {
    var secretId = String(cfg.tencentSecretId || '').trim();
    var secretKey = String(cfg.tencentSecretKey || '').trim();
    var region = String(cfg.tencentRegion || 'ap-guangzhou').trim() || 'ap-guangzhou';
    var host = 'tmt.tencentcloudapi.com';
    var service = 'tmt';
    var action = 'TextTranslate';
    var version = '2018-03-21';

    var timestamp = Math.floor(nowMs / 1000);
    var date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    var body = JSON.stringify({
      SourceText: text,
      Source: from === 'auto' ? 'auto' : PT.mapLang('tencent', from, false),
      Target: PT.mapLang('tencent', to, true),
      ProjectId: 0
    });

    var headers = {
      'content-type': 'application/json; charset=utf-8',
      host: host,
      'x-tc-action': action.toLowerCase()
    };

    var canonicalHeaders = tencentCanonicalHeaders(headers);
    var signedHeaders = Object.keys(headers).sort().join(';');
    var payloadHash = await sha256Hex(body);

    var canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join('\n');

    var scope = date + '/' + service + '/tc3_request';
    var stringToSign = [
      'TC3-HMAC-SHA256',
      String(timestamp),
      scope,
      await sha256Hex(canonicalRequest)
    ].join('\n');

    var secretDate = await hmac('SHA-256', 'TC3' + secretKey, date);
    var secretService = await hmac('SHA-256', secretDate, service);
    var secretSigning = await hmac('SHA-256', secretService, 'tc3_request');
    var signature = hex(await hmac('SHA-256', secretSigning, stringToSign));

    var authorization =
      'TC3-HMAC-SHA256 Credential=' + secretId + '/' + scope +
      ', SignedHeaders=' + signedHeaders +
      ', Signature=' + signature;

    return {
      url: 'https://' + host,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-TC-Action': action,
          'X-TC-Version': version,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Region': region,
          Authorization: authorization
        },
        body: body
      }
    };
  }

  async function translateTencent(cfg, text, from, to) {
    var provider = 'tencent';

    return translateChunked(text, 1800, to, async function (piece) {
      var signed = await tencentSignedRequest(cfg, piece, from, to, Date.now());
      var response = await request(signed.url, signed.init, provider);
      var payload = await readBody(response);

      if (!payload.data) throw httpError(provider, payload);
      var data = payload.data.Response;
      if (!data) throw httpError(provider, payload);

      if (data.Error) {
        var code = String(data.Error.Code || '');
        var mapped = 'request';
        if (/AuthFailure|Unauthorized|InvalidCredential/i.test(code)) mapped = 'auth';
        else if (/LimitExceeded|FailedOperation|ResourceUnavailable|NoFreeAmount/i.test(code)) mapped = 'quota';
        else if (/UnsupportedLanguage|Language/i.test(code)) mapped = 'lang';
        else if (/InternalError|ServiceUnavailable|RequestLimitExceeded/i.test(code)) mapped = 'server';

        throw new ProviderError(mapped, '腾讯云翻译：' + (data.Error.Message || code), {
          provider: provider,
          detail: code + (data.RequestId ? ' (' + data.RequestId + ')' : ''),
          hint: PT.errorHints[mapped]
        });
      }

      if (!payload.ok) throw httpError(provider, payload);

      var translated = String(data.TargetText || '').trim();
      if (!translated) throw emptyResult(provider);

      return {
        text: translated,
        detected: PT.normalizeDetected(provider, data.Source || (from === 'auto' ? '' : from))
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * DeepL
   * ------------------------------------------------------------------ */

  async function translateDeepL(cfg, text, from, to) {
    var provider = 'deepl';
    var plan = cfg.deeplPlan === 'pro' ? 'pro' : 'free';
    var endpoint = plan === 'pro' ? 'https://api.deepl.com' : 'https://api-free.deepl.com';

    return translateChunked(text, 12000, to, async function (piece) {
      var body = new URLSearchParams();
      body.set('text', piece);
      body.set('target_lang', PT.mapLang(provider, to, true));
      if (from !== 'auto') body.set('source_lang', PT.mapLang(provider, from, false));

      var response = await request(
        endpoint + '/v2/translate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: 'DeepL-Auth-Key ' + String(cfg.deeplKey || '').trim()
          },
          body: body.toString()
        },
        provider
      );
      var payload = await readBody(response);
      if (!payload.ok) {
        if (payload.status === 456) {
          throw new ProviderError('quota', 'DeepL 本月字符额度已用完', { provider: provider });
        }
        throw httpError(provider, payload);
      }

      var translation = payload.data && payload.data.translations && payload.data.translations[0];
      var translated = translation && String(translation.text || '').trim();
      if (!translated) throw emptyResult(provider);

      return {
        text: translated,
        detected: PT.normalizeDetected(provider, translation.detected_source_language || from)
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * LibreTranslate
   * ------------------------------------------------------------------ */

  async function translateLibre(cfg, text, from, to) {
    var provider = 'libre';
    var endpoint = PT.normalizeEndpoint(cfg.libreUrl);
    var apiKey = String(cfg.libreKey || '').trim();

    return translateChunked(text, 4500, to, async function (piece) {
      var body = {
        q: piece,
        source: from === 'auto' ? 'auto' : PT.mapLang(provider, from, false),
        target: PT.mapLang(provider, to, true),
        format: 'text'
      };
      if (apiKey) body.api_key = apiKey;

      var response = await request(
        endpoint + '/translate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        },
        provider
      );
      var payload = await readBody(response);
      if (!payload.ok) throw httpError(provider, payload);
      if (!payload.data) {
        throw new ProviderError('server', 'LibreTranslate 返回了无法解析的响应', { provider: provider });
      }
      if (payload.data.error) {
        throw new ProviderError('request', 'LibreTranslate：' + payload.data.error, { provider: provider });
      }

      var translated = String(payload.data.translatedText || '').trim();
      if (!translated) throw emptyResult(provider);

      var detected = payload.data.detectedLanguage;
      if (detected && typeof detected === 'object') detected = detected.language;

      return {
        text: translated,
        detected: PT.normalizeDetected(provider, detected || from)
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * OpenAI-compatible chat completions
   * ------------------------------------------------------------------ */

  async function translateOpenAI(cfg, text, from, to) {
    var provider = 'openai';
    var base = PT.normalizeEndpoint(cfg.openaiBaseUrl);
    if (!/\/chat\/completions$/.test(base)) base += '/chat/completions';

    var targetName = PT.languageName(to);
    var system =
      'You are a professional translation engine. Translate the text the user provides into ' +
      targetName + ' (' + to + '). Preserve the original tone, meaning and formatting. ' +
      'Output only the translated text, without quotes, explanations or notes.';

    return translateChunked(text, 6000, to, async function (piece) {
      var headers = { 'Content-Type': 'application/json' };
      var apiKey = String(cfg.openaiKey || '').trim();
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

      var response = await request(
        base,
        {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            model: String(cfg.openaiModel || '').trim(),
            stream: false,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: piece }
            ]
          })
        },
        provider,
        45000
      );
      var payload = await readBody(response);
      if (!payload.ok) throw httpError(provider, payload);
      if (!payload.data) {
        throw new ProviderError('server', '接口返回了无法解析的响应', { provider: provider });
      }

      var choice = payload.data.choices && payload.data.choices[0];
      var content = choice && choice.message && choice.message.content;
      if (Array.isArray(content)) {
        content = content.map(function (part) { return part && part.text ? part.text : ''; }).join('');
      }
      var translated = String(content || '').trim();
      if (!translated) throw emptyResult(provider);

      return {
        text: translated,
        detected: PT.normalizeDetected(provider, from === 'auto' ? '' : from)
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * Public entry point
   * ------------------------------------------------------------------ */

  var RUNNERS = {
    mymemory: translateMyMemory,
    google: translateGoogle,
    azure: translateAzure,
    aliyun: translateAliyun,
    tencent: translateTencent,
    deepl: translateDeepL,
    libre: translateLibre,
    openai: translateOpenAI
  };

  // Settings that change the produced text. The cache is per-session, but a
  // different model or endpoint must never reuse another configuration's output.
  function configScope(provider, cfg) {
    switch (provider) {
      case 'azure':
        return [cfg.azureEndpoint, cfg.azureRegion].join('|');
      case 'aliyun':
        return cfg.aliyunRegion || '';
      case 'tencent':
        return cfg.tencentRegion || '';
      case 'deepl':
        return cfg.deeplPlan || '';
      case 'libre':
        return cfg.libreUrl || '';
      case 'openai':
        return [cfg.openaiBaseUrl, cfg.openaiModel].join('|');
      default:
        return '';
    }
  }

  function cacheGet(key) {
    if (!cache.has(key)) return null;
    var value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(key, value) {
    cache.set(key, value);
    while (cache.size > CACHE_LIMIT) {
      var oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  /**
   * Translate one string.
   *
   * @param {object} settings full settings object
   * @param {string} text
   * @param {object} [options] { from, to, provider, noCache }
   * @returns {Promise<{text: string, detected: string, provider: string}>}
   */
  PT.translate = async function (settings, text, options) {
    var opts = options || {};
    var cfg = Object.assign(PT.defaultSettings(), settings || {});
    var provider = opts.provider || cfg.provider;
    cfg.provider = provider;

    var from = opts.from || cfg.sourceLang || 'auto';
    var to = opts.to || cfg.targetLang;
    var value = String(text == null ? '' : text).trim();

    if (!value) {
      throw new ProviderError('empty', PT.errorHints.empty, { provider: provider });
    }
    if (!RUNNERS[provider]) {
      throw new ProviderError('config', '未知的翻译服务：' + provider, { provider: provider });
    }

    var configError = PT.validateProvider(cfg);
    if (configError) {
      throw new ProviderError('config', configError.message, {
        provider: provider,
        hint: configError.hint
      });
    }

    var key = [provider, configScope(provider, cfg), from, to, value].join('\u0000');

    if (!opts.noCache) {
      var hit = cacheGet(key);
      if (hit) return Object.assign({}, hit);
    }

    if (inflight.has(key)) return inflight.get(key);

    var promise = RUNNERS[provider](cfg, value, from, to)
      .then(function (result) {
        var translated = String((result && result.text) || '').trim();
        if (!translated) throw emptyResult(provider);

        var detected = PT.normalizeDetected(
          provider,
          (result && result.detected) || (from === 'auto' ? PT.detectLanguage(value) : from)
        );

        var normalized = { text: translated, detected: detected, provider: provider };
        if (!opts.noCache) cacheSet(key, normalized);
        return normalized;
      })
      .finally(function () {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  };

  PT.cacheStats = function () {
    return { size: cache.size, inflight: inflight.size };
  };

  PT.clearCache = function () {
    cache.clear();
  };

  // Exposed for diagnostics in the options page ("测试翻译" shows the provider).
  PT.providerSupportsAutoDetect = function (provider) {
    return provider !== 'openai';
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
