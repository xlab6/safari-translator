import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSandbox,
  loadPT,
  fakeFetch,
  jsonResponse,
  header
} from './support.mjs';

function setup(handler, extra = {}) {
  const fetch = fakeFetch(handler);
  const context = createSandbox({ fetch, ...extra });
  const PT = loadPT(context);
  return { PT, fetch, context };
}

function config(PT, overrides) {
  return Object.assign(PT.defaultSettings(), {
    provider: 'mymemory',
    sourceLang: 'auto',
    targetLang: 'zh-CN'
  }, overrides || {});
}

test('MyMemory detects the source locally and parses the translation', async () => {
  const { PT, fetch } = setup(() =>
    jsonResponse(200, {
      responseStatus: 200,
      responseData: { translatedText: '你好，世界' },
      matches: [{ source: 'en-GB', target: 'zh-CN', translation: '你好，世界' }]
    })
  );

  const result = await PT.translate(config(PT), 'Hello, world', {});
  assert.equal(result.text, '你好，世界');
  assert.equal(result.detected, 'en');
  assert.equal(result.provider, 'mymemory');
  assert.equal(fetch.calls.length, 1);
  assert.match(fetch.calls[0].url, /api\.mymemory\.translated\.net\/get\?/);
  assert.match(fetch.calls[0].url, /langpair=en%7Czh-CN/);
  assert.match(fetch.calls[0].url, /q=Hello%2C%20world/);
});

test('MyMemory maps quota and HTTP failures', async () => {
  const quota = setup(() => jsonResponse(200, { responseStatus: 200, quotaFinished: true }));
  await assert.rejects(quota.PT.translate(config(quota.PT), 'Hello', {}), (error) => {
    assert.equal(error.code, 'quota');
    assert.match(error.message, /额度/);
    return true;
  });

  const warning = setup(() =>
    jsonResponse(200, {
      responseStatus: 200,
      responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' }
    })
  );
  await assert.rejects(warning.PT.translate(config(warning.PT), 'Hello', {}), (error) => error.code === 'quota');

  const limited = setup(() => jsonResponse(429, { message: 'too many requests' }));
  await assert.rejects(limited.PT.translate(config(limited.PT), 'Hello', {}), (error) => error.code === 'quota');
});

test('MyMemory splits text over the 450 byte budget', async () => {
  const { PT, fetch } = setup((call) => {
    const query = new URL(call.url).searchParams.get('q');
    return jsonResponse(200, {
      responseStatus: 200,
      responseData: { translatedText: '[' + query.length + ']' }
    });
  });

  const text = 'Sentence one is here. '.repeat(40);
  const result = await PT.translate(config(PT), text, {});
  assert.ok(fetch.calls.length > 1, 'request was chunked');
  assert.match(result.text, /^\[\d+\]/);
  fetch.calls.forEach((call) => {
    const query = new URL(call.url).searchParams.get('q');
    assert.ok(Buffer.byteLength(query) <= 450, 'chunk fits MyMemory limit');
  });
});

test('Google parses the translate_a segments and detected language', async () => {
  const { PT, fetch } = setup(() =>
    jsonResponse(200, [[['你好，', 'Hello, ', null], ['世界', 'world', null]], null, 'en'])
  );

  const result = await PT.translate(config(PT, { provider: 'google' }), 'Hello, world', {});
  assert.equal(result.text, '你好，世界');
  assert.equal(result.detected, 'en');
  assert.match(fetch.calls[0].url, /translate\.googleapis\.com\/translate_a\/single/);
  assert.match(fetch.calls[0].url, /sl=auto/);
  assert.match(fetch.calls[0].url, /tl=zh-CN/);
});

test('Google reports throttling and malformed responses', async () => {
  const throttled = setup(() => jsonResponse(429, {}));
  await assert.rejects(throttled.PT.translate(config(throttled.PT, { provider: 'google' }), 'Hello', {}), (error) => {
    assert.equal(error.code, 'quota');
    return true;
  });

  const malformed = setup(() => jsonResponse(200, { error: 'nope' }));
  await assert.rejects(malformed.PT.translate(config(malformed.PT, { provider: 'google' }), 'Hello', {}), (error) => {
    assert.equal(error.code, 'server');
    return true;
  });
});

function googleJoined(text) {
  return jsonResponse(200, [[[text, '', null]], null, 'en']);
}

function queryOf(call) {
  if (call.init && call.init.body) {
    return new URLSearchParams(String(call.init.body)).get('q');
  }
  return new URL(call.url).searchParams.get('q');
}

/** Promise/callback storage in the shape Safari exposes on browser.storage.local. */
function fakeStorage() {
  const data = {};
  const clone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  function listOf(keys) {
    return Array.isArray(keys) ? keys : [keys];
  }
  return {
    data,
    local: {
      get(keys, callback) {
        const out = {};
        listOf(keys).forEach((key) => {
          if (key in data) out[key] = clone(data[key]);
        });
        if (callback) setTimeout(() => callback(out), 0);
        return Promise.resolve(out);
      },
      set(items, callback) {
        Object.keys(items).forEach((key) => { data[key] = clone(items[key]); });
        if (callback) setTimeout(callback, 0);
        return Promise.resolve();
      },
      remove(keys, callback) {
        listOf(keys).forEach((key) => { delete data[key]; });
        if (callback) setTimeout(callback, 0);
        return Promise.resolve();
      }
    }
  };
}

function googleEchoSetup(storage) {
  const handler = (call) => {
    const query = queryOf(call);
    return googleJoined(query.split('\n\n').map((text) => '译:' + text).join('\n\n'));
  };
  if (!storage) return setup(handler);
  return setup(handler, { browser: { storage } });
}

test('Google joins short texts into one request and fills the per-text cache', async () => {
  const { PT, fetch } = setup((call) => {
    const query = queryOf(call);
    return googleJoined(query.split('\n\n').map((text) => '译:' + text).join('\n\n'));
  });
  const settings = config(PT, { provider: 'google' });

  const results = await PT.translateMany(settings, ['One', 'Two', 'Three'], {});
  assert.equal(fetch.calls.length, 1, 'three texts share one request');
  assert.equal(queryOf(fetch.calls[0]), 'One\n\nTwo\n\nThree');
  assert.deepEqual(
    Array.from(results, (result) => result.ok && result.text),
    ['译:One', '译:Two', '译:Three']
  );
  assert.equal(results[0].provider, 'google');
  assert.equal(results[1].detected, 'en');

  const again = await PT.translateMany(settings, ['One', 'Two', 'Three'], {});
  assert.equal(fetch.calls.length, 1, 'cached texts do not hit the network');
  assert.equal(again[2].text, '译:Three');

  const single = await PT.translate(settings, 'Two', {});
  assert.equal(single.text, '译:Two', 'joined results populate the single-text cache');
});

test('Google batches longer lists through the POST endpoint', async () => {
  const { PT, fetch } = setup((call) => {
    const query = queryOf(call);
    return googleJoined(query.split('\n\n').map((text) => '译:' + text).join('\n\n'));
  });
  const texts = Array.from(
    { length: 40 },
    (_, index) => 'Sentence number ' + index + ' is long enough to force a POST request body.'
  );

  const results = await PT.translateMany(config(PT, { provider: 'google' }), texts, {});
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].init.method, 'POST');
  assert.match(header(fetch.calls[0], 'content-type'), /x-www-form-urlencoded/);
  assert.equal(results.length, 40);
  assert.equal(results[39].text, '译:' + texts[39]);
});

test('Google falls back to one request per text when separators are lost', async () => {
  let first = true;
  const { PT, fetch } = setup((call) => {
    if (first) {
      first = false;
      return googleJoined('merged output without separators');
    }
    return googleJoined('译:' + queryOf(call));
  });

  const results = await PT.translateMany(config(PT, { provider: 'google' }), ['Alpha', 'Beta'], {});
  assert.equal(fetch.calls.length, 3, 'one joined attempt plus two single requests');
  assert.deepEqual(Array.from(results, (result) => result.text), ['译:Alpha', '译:Beta']);
});

test('Google batch failures are reported per text', async () => {
  const { PT } = setup(() => jsonResponse(429, {}));
  const results = await PT.translateMany(config(PT, { provider: 'google' }), ['A', 'B'], {});
  assert.equal(results.length, 2);
  results.forEach((result) => {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'quota');
  });
});

test('Azure sends the subscription key, region and language pair', async () => {
  const { PT, fetch } = setup(() =>
    jsonResponse(200, [{ detectedLanguage: { language: 'en', score: 1 }, translations: [{ text: '你好' }] }])
  );

  const result = await PT.translate(
    config(PT, {
      provider: 'azure',
      azureKey: 'secret-key',
      azureRegion: 'westeurope',
      targetLang: 'zh-CN'
    }),
    'Hello',
    {}
  );

  assert.equal(result.text, '你好');
  assert.equal(result.detected, 'en');
  const call = fetch.calls[0];
  assert.match(call.url, /\/translate\?api-version=3\.0&to=zh-Hans$/);
  assert.equal(header(call, 'Ocp-Apim-Subscription-Key'), 'secret-key');
  assert.equal(header(call, 'Ocp-Apim-Subscription-Region'), 'westeurope');
  assert.deepEqual(JSON.parse(call.init.body), [{ Text: 'Hello' }]);
});

test('Azure omits the region header when none is configured', async () => {
  const { PT, fetch } = setup(() => jsonResponse(200, [{ translations: [{ text: '你好' }] }]));
  await PT.translate(config(PT, { provider: 'azure', azureKey: 'k' }), 'Hello', {});
  assert.equal(header(fetch.calls[0], 'Ocp-Apim-Subscription-Region'), undefined);
});

test('Aliyun joins short texts into one signed request', async () => {
  const { PT, fetch } = setup((call) => {
    const source = new URL(call.url).searchParams.get('SourceText');
    return jsonResponse(200, {
      Code: '200',
      Data: {
        Translated: source.split('\n\n').map((text) => '译:' + text).join('\n\n'),
        DetectedLanguage: 'en'
      }
    });
  });
  const settings = config(PT, {
    provider: 'aliyun',
    aliyunKeyId: 'key-id',
    aliyunKeySecret: 'key-secret'
  });

  const results = await PT.translateMany(settings, ['One', 'Two', 'Three'], {});
  assert.equal(fetch.calls.length, 1, 'three texts share one request');
  assert.equal(new URL(fetch.calls[0].url).searchParams.get('SourceText'), 'One\n\nTwo\n\nThree');
  assert.deepEqual(Array.from(results, (result) => result.text), ['译:One', '译:Two', '译:Three']);
  assert.equal(results[2].detected, 'en');
});

test('translations persist across a restart without another request', async () => {
  const storage = fakeStorage();
  const first = googleEchoSetup(storage);
  const settings = config(first.PT, { provider: 'google' });

  const initial = await first.PT.translateMany(settings, ['One', 'Two'], {});
  assert.equal(first.fetch.calls.length, 1);
  assert.deepEqual(Array.from(initial, (result) => result.text), ['译:One', '译:Two']);
  assert.ok(storage.data.ptMemoryIndex.length >= 2, 'the memory index is persisted');

  // A new sandbox is a new background page: no in-memory cache survives.
  const restarted = googleEchoSetup(storage);
  const cached = await restarted.PT.translateMany(
    config(restarted.PT, { provider: 'google' }),
    ['One', 'Two'],
    {}
  );
  assert.equal(restarted.fetch.calls.length, 0, 'remembered texts cost no quota');
  assert.deepEqual(Array.from(cached, (result) => result.text), ['译:One', '译:Two']);
  assert.equal(cached[1].detected, 'en');

  const single = await restarted.PT.translate(
    config(restarted.PT, { provider: 'google' }),
    'Two',
    {}
  );
  assert.equal(single.text, '译:Two', 'single translations use the same memory');

  const newOnly = await restarted.PT.translateMany(
    config(restarted.PT, { provider: 'google' }),
    ['One', 'Three'],
    {}
  );
  assert.equal(restarted.fetch.calls.length, 1, 'only the new text is requested');
  assert.equal(queryOf(restarted.fetch.calls[0]), 'Three');
  assert.deepEqual(Array.from(newOnly, (result) => result.text), ['译:One', '译:Three']);
});

test('the persistent memory respects the language pair and noCache', async () => {
  const storage = fakeStorage();
  const first = googleEchoSetup(storage);
  await first.PT.translateMany(config(first.PT, { provider: 'google' }), ['One'], {});

  const language = googleEchoSetup(storage);
  const japanese = await language.PT.translateMany(
    config(language.PT, { provider: 'google', targetLang: 'ja' }),
    ['One'],
    {}
  );
  assert.equal(language.fetch.calls.length, 1, 'a different target language is a miss');
  assert.equal(japanese[0].text, '译:One');

  const fresh = googleEchoSetup(storage);
  await fresh.PT.translateMany(config(fresh.PT, { provider: 'google' }), ['One'], { noCache: true });
  assert.equal(fresh.fetch.calls.length, 1, 'noCache bypasses the persistent memory');

  const differentProvider = googleEchoSetup(storage);
  await differentProvider.PT.translateMany(
    config(differentProvider.PT, { provider: 'google' }),
    ['One'],
    { from: 'en' }
  );
  assert.equal(differentProvider.fetch.calls.length, 1, 'a different source language is a miss');
});

test('Aliyun signs the RPC request and maps API error codes', async () => {
  const ok = setup(() =>
    jsonResponse(200, {
      Code: '200',
      Data: { Translated: '你好', DetectedLanguage: 'en' }
    })
  );

  const result = await ok.PT.translate(
    config(ok.PT, { provider: 'aliyun', aliyunKeyId: 'key-id', aliyunKeySecret: 'key-secret' }),
    'Hello',
    {}
  );
  assert.equal(result.text, '你好');
  assert.equal(result.detected, 'en');

  const url = new URL(ok.fetch.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://mt.aliyuncs.com/');
  assert.equal(url.searchParams.get('Action'), 'TranslateGeneral');
  assert.equal(url.searchParams.get('Version'), '2018-10-12');
  assert.equal(url.searchParams.get('AccessKeyId'), 'key-id');
  assert.equal(url.searchParams.get('SourceText'), 'Hello');
  assert.equal(url.searchParams.get('TargetLanguage'), 'zh');
  assert.equal(url.searchParams.get('SourceLanguage'), 'auto');
  assert.ok(url.searchParams.get('Signature'), 'signature present');
  assert.equal(url.searchParams.get('SignatureMethod'), 'HMAC-SHA1');
  assert.match(url.searchParams.get('Timestamp'), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

  const auth = setup(() =>
    jsonResponse(400, { Code: 'InvalidAccessKeyId.NotFound', Message: 'Specified access key is not found.' })
  );
  await assert.rejects(
    auth.PT.translate(
      config(auth.PT, { provider: 'aliyun', aliyunKeyId: 'bad', aliyunKeySecret: 'bad' }),
      'Hello',
      {}
    ),
    (error) => {
      assert.equal(error.code, 'auth');
      assert.match(error.message, /阿里云翻译/);
      return true;
    }
  );

  const throttled = setup(() => jsonResponse(400, { Code: 'Throttling.User', Message: 'Too many requests' }));
  await assert.rejects(
    throttled.PT.translate(
      config(throttled.PT, { provider: 'aliyun', aliyunKeyId: 'id', aliyunKeySecret: 'secret' }),
      'Hello',
      {}
    ),
    (error) => error.code === 'quota'
  );
});

test('Tencent uses TC3-HMAC-SHA256 and the TMT action', async () => {
  const { PT, fetch } = setup(() =>
    jsonResponse(200, {
      Response: { TargetText: '你好', Source: 'en', RequestId: 'req-1' }
    })
  );

  const result = await PT.translate(
    config(PT, {
      provider: 'tencent',
      tencentSecretId: 'secret-id',
      tencentSecretKey: 'secret-key',
      tencentRegion: 'ap-shanghai'
    }),
    'Hello',
    {}
  );
  assert.equal(result.text, '你好');
  assert.equal(result.detected, 'en');

  const call = fetch.calls[0];
  assert.equal(call.url, 'https://tmt.tencentcloudapi.com');
  assert.equal(header(call, 'X-TC-Action'), 'TextTranslate');
  assert.equal(header(call, 'X-TC-Version'), '2018-03-21');
  assert.equal(header(call, 'X-TC-Region'), 'ap-shanghai');
  assert.match(header(call, 'Authorization'), /^TC3-HMAC-SHA256 Credential=secret-id\/\d{4}-\d\d-\d\d\/tmt\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/);

  const body = JSON.parse(call.init.body);
  assert.deepEqual(body, { SourceText: 'Hello', Source: 'auto', Target: 'zh', ProjectId: 0 });
});

test('Tencent maps API errors from the response envelope', async () => {
  const quota = setup(() =>
    jsonResponse(200, {
      Response: { Error: { Code: 'LimitExceeded', Message: 'free amount exhausted' }, RequestId: 'r' }
    })
  );
  await assert.rejects(
    quota.PT.translate(
      config(quota.PT, { provider: 'tencent', tencentSecretId: 'id', tencentSecretKey: 'key' }),
      'Hello',
      {}
    ),
    (error) => {
      assert.equal(error.code, 'quota');
      assert.match(error.message, /腾讯云翻译/);
      return true;
    }
  );

  const auth = setup(() =>
    jsonResponse(200, { Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: 'bad signature' } } })
  );
  await assert.rejects(
    auth.PT.translate(
      config(auth.PT, { provider: 'tencent', tencentSecretId: 'id', tencentSecretKey: 'key' }),
      'Hello',
      {}
    ),
    (error) => error.code === 'auth'
  );
});

test('DeepL selects the free or pro endpoint and sends the auth header', async () => {
  const free = setup(() =>
    jsonResponse(200, { translations: [{ detected_source_language: 'EN', text: '你好' }] })
  );
  const freeResult = await free.PT.translate(
    config(free.PT, { provider: 'deepl', deeplKey: 'key-free', targetLang: 'zh-CN' }),
    'Hello',
    {}
  );
  assert.equal(freeResult.text, '你好');
  assert.equal(freeResult.detected, 'en');
  assert.equal(free.fetch.calls[0].url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(header(free.fetch.calls[0], 'Authorization'), 'DeepL-Auth-Key key-free');
  const body = new URLSearchParams(free.fetch.calls[0].init.body);
  assert.equal(body.get('target_lang'), 'ZH-HANS');
  assert.equal(body.get('text'), 'Hello');
  assert.equal(body.get('source_lang'), null, 'auto source is omitted');

  const pro = setup(() => jsonResponse(200, { translations: [{ text: 'Bonjour' }] }));
  await pro.PT.translate(config(pro.PT, { provider: 'deepl', deeplKey: 'key-pro', deeplPlan: 'pro' }), 'Hello', {});
  assert.equal(pro.fetch.calls[0].url, 'https://api.deepl.com/v2/translate');
});

test('DeepL reports exhausted quota', async () => {
  const { PT } = setup(() => jsonResponse(456, { message: 'Quota exceeded' }));
  await assert.rejects(
    PT.translate(config(PT, { provider: 'deepl', deeplKey: 'k' }), 'Hello', {}),
    (error) => {
      assert.equal(error.code, 'quota');
      assert.match(error.message, /额度/);
      return true;
    }
  );
});

test('LibreTranslate posts JSON and forwards the optional api key', async () => {
  const { PT, fetch } = setup(() =>
    jsonResponse(200, { translatedText: '你好', detectedLanguage: { language: 'en', confidence: 90 } })
  );

  const result = await PT.translate(
    config(PT, { provider: 'libre', libreUrl: 'translate.example.com', libreKey: 'libre-key' }),
    'Hello',
    {}
  );
  assert.equal(result.text, '你好');
  assert.equal(result.detected, 'en');
  assert.equal(fetch.calls[0].url, 'https://translate.example.com/translate');
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), {
    q: 'Hello',
    source: 'auto',
    target: 'zh',
    format: 'text',
    api_key: 'libre-key'
  });
});

test('LibreTranslate surfaces its own error field', async () => {
  const { PT } = setup(() => jsonResponse(200, { error: 'Invalid target language' }));
  await assert.rejects(
    PT.translate(config(PT, { provider: 'libre', libreUrl: 'https://libre.example' }), 'Hello', {}),
    (error) => {
      assert.equal(error.code, 'request');
      assert.match(error.message, /Invalid target language/);
      return true;
    }
  );
});

test('OpenAI-compatible chat completions are parsed', async () => {
  const { PT, fetch } = setup(() =>
    jsonResponse(200, { choices: [{ message: { role: 'assistant', content: '你好' } }] })
  );

  const result = await PT.translate(
    config(PT, { provider: 'openai', openaiBaseUrl: 'https://api.example.com/v1', openaiKey: 'sk-test' }),
    'Hello',
    {}
  );
  assert.equal(result.text, '你好');
  assert.equal(result.detected, 'en');
  assert.equal(fetch.calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(header(fetch.calls[0], 'Authorization'), 'Bearer sk-test');

  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /简体中文/);
  assert.deepEqual(body.messages[1], { role: 'user', content: 'Hello' });
});

test('OpenAI accepts array-shaped content and no auth key', async () => {
  const { PT, fetch } = setup(() =>
    jsonResponse(200, { choices: [{ message: { content: [{ type: 'text', text: '你好' }, { type: 'text', text: '！' }] } }] })
  );
  const result = await PT.translate(
    config(PT, { provider: 'openai', openaiBaseUrl: 'http://localhost:11434/v1', openaiKey: '' }),
    'Hello',
    {}
  );
  assert.equal(result.text, '你好！');
  assert.equal(header(fetch.calls[0], 'Authorization'), undefined);
});

test('HTTP status codes map to actionable error codes', async () => {
  const cases = [
    [401, { error: { message: 'unauthorized' } }, 'auth'],
    [403, {}, 'auth'],
    [429, {}, 'quota'],
    [400, {}, 'request'],
    [404, {}, 'request'],
    [422, {}, 'request'],
    [500, {}, 'server'],
    [503, {}, 'server']
  ];

  for (const [status, body, expected] of cases) {
    const { PT } = setup(() => jsonResponse(status, body));
    await assert.rejects(
      PT.translate(config(PT, { provider: 'azure', azureKey: 'k' }), 'Hello', {}),
      (error) => {
        assert.equal(error.code, expected, 'HTTP ' + status);
        assert.equal(error.status, status);
        assert.ok(error.hint && error.hint.length > 0);
        return true;
      },
      'HTTP ' + status + ' should map to ' + expected
    );
  }
});

test('network failures and timeouts are distinguished', async () => {
  const network = setup(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(network.PT.translate(config(network.PT), 'Hello', {}), (error) => {
    assert.equal(error.code, 'network');
    assert.match(error.hint, /网络/);
    return true;
  });

  const timeout = setup(() => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  });
  await assert.rejects(timeout.PT.translate(config(timeout.PT), 'Hello', {}), (error) => {
    assert.equal(error.code, 'timeout');
    assert.match(error.hint, /超时/);
    return true;
  });
});

test('empty text and unknown providers fail before any request', async () => {
  const { PT, fetch } = setup(() => jsonResponse(200, {}));
  await assert.rejects(PT.translate(config(PT), '   ', {}), (error) => error.code === 'empty');
  await assert.rejects(PT.translate(config(PT, { provider: 'nope' }), 'Hello', {}), (error) => {
    assert.equal(error.code, 'config');
    assert.match(error.message, /未知/);
    return true;
  });
  await assert.rejects(
    PT.translate(config(PT, { provider: 'azure', azureKey: '' }), 'Hello', {}),
    (error) => error.code === 'config'
  );
  assert.equal(fetch.calls.length, 0);
});

test('identical requests hit the cache; noCache and clearCache behave', async () => {
  let calls = 0;
  const { PT, fetch } = setup(() => {
    calls += 1;
    return jsonResponse(200, { responseStatus: 200, responseData: { translatedText: '你好' } });
  });

  const settings = config(PT);
  const first = await PT.translate(settings, 'Hello', {});
  const second = await PT.translate(settings, 'Hello', {});
  assert.equal(fetch.calls.length, 1, 'second call is served from the cache');
  assert.notEqual(first, second, 'cached results are copied, not shared');

  await PT.translate(settings, 'Hello', { noCache: true });
  assert.equal(fetch.calls.length, 2);

  PT.clearCache();
  await PT.translate(settings, 'Hello', {});
  assert.equal(fetch.calls.length, 3);
  assert.ok(calls >= 3);
});

test('the cache is scoped to provider configuration', async () => {
  const { PT, fetch } = setup(() =>
    jsonResponse(200, [{ translations: [{ text: '你好' }] }])
  );

  const base = config(PT, { provider: 'azure', azureKey: 'secret-key' });
  const custom = Object.assign({}, base, { azureEndpoint: 'https://translator.example.com' });

  await PT.translate(base, 'Hello', {});
  await PT.translate(custom, 'Hello', {});
  await PT.translate(custom, 'Hello', {});

  assert.equal(fetch.calls.length, 2, 'a new endpoint does not reuse the old result');
  assert.match(fetch.calls[0].url, /^https:\/\/api\.cognitive\.microsofttranslator\.com\//);
  assert.match(fetch.calls[1].url, /^https:\/\/translator\.example\.com\//);
});

test('concurrent identical requests share one flight', async () => {
  let resolveResponse;
  const pending = new Promise((resolve) => { resolveResponse = resolve; });
  const { PT, fetch } = setup(() => pending);

  const settings = config(PT);
  const one = PT.translate(settings, 'Hello', {});
  const two = PT.translate(settings, 'Hello', {});
  assert.equal(PT.cacheStats().inflight, 1);
  resolveResponse(jsonResponse(200, { responseStatus: 200, responseData: { translatedText: '你好' } }));

  const [a, b] = await Promise.all([one, two]);
  assert.equal(a.text, '你好');
  assert.equal(b.text, '你好');
  assert.equal(fetch.calls.length, 1);
  assert.equal(PT.cacheStats().inflight, 0);
});

test('providerSupportsAutoDetect is false only for OpenAI', () => {
  const { PT } = setup(() => jsonResponse(200, {}));
  PT.PROVIDERS.forEach((provider) => {
    assert.equal(PT.providerSupportsAutoDetect(provider.id), provider.id !== 'openai');
  });
});
