import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSandbox,
  loadBackground,
  createStorage,
  wait,
  waitFor
} from './support.mjs';

function createBackgroundBrowser() {
  const created = [];
  const sentToTabs = [];
  const injected = [];
  const inserted = [];
  const openedOptions = [];
  const messageListeners = [];
  const clickListeners = [];
  const storage = createStorage({ settings: { provider: 'mymemory', targetLang: 'zh-CN' } });

  let sendToTabFails = 0;
  let sendToTabResponse = { ok: true };

  const tabs = {
    query() { return Promise.resolve([{ id: 7, active: true }]); },
    sendMessage(tabId, message) {
      sentToTabs.push({ tabId, message });
      if (sendToTabFails > 0) {
        sendToTabFails -= 1;
        return Promise.reject(new Error('Could not establish connection'));
      }
      return Promise.resolve(sendToTabResponse);
    },
    executeScript(tabId, details) {
      injected.push({ tabId, details });
      return Promise.resolve([]);
    },
    insertCSS(tabId, details) {
      inserted.push({ tabId, details });
      return Promise.resolve();
    }
  };

  const browser = {
    runtime: {
      lastError: null,
      openOptionsPage() { openedOptions.push(true); return Promise.resolve(); },
      onMessage: {
        addListener(fn) { messageListeners.push(fn); },
        removeListener(fn) {
          const index = messageListeners.indexOf(fn);
          if (index >= 0) messageListeners.splice(index, 1);
        }
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    },
    storage,
    tabs,
    contextMenus: {
      removeAll(callback) {
        created.length = 0;
        setTimeout(() => callback && callback(), 0);
        return Promise.resolve();
      },
      create(props, callback) {
        created.push(props);
        setTimeout(() => callback && callback(), 0);
        return props.id;
      },
      onClicked: { addListener(fn) { clickListeners.push(fn); } }
    }
  };

  return {
    browser,
    created,
    sentToTabs,
    injected,
    inserted,
    openedOptions,
    messageListeners,
    clickListeners,
    storage,
    failNextSendToTab(times = 1) { sendToTabFails = times; },
    setSendToTabResponse(response) { sendToTabResponse = response; }
  };
}

function setup() {
  const fixture = createBackgroundBrowser();
  const context = createSandbox({ browser: fixture.browser });
  const api = loadBackground(context);
  return { fixture, context, api };
}

/** Dispatch an onMessage event and wait for the async sendResponse call. */
function dispatch(fixture, message) {
  return new Promise((resolve) => {
    let returned;
    fixture.messageListeners.forEach((fn) => {
      returned = fn(message, { id: 'test' }, resolve);
    });
    if (returned !== true) resolve(returned);
    setTimeout(() => resolve(undefined), 500);
  }).then((response) => ({ response, returned: undefined }));
}

function click(fixture, info, tab) {
  fixture.clickListeners.forEach((fn) => fn(info, tab));
}

test('context menus are created with explicit translate entries', async () => {
  const { fixture, api } = setup();
  await waitFor(() => fixture.created.length >= 7, 1500, 'menus created');

  assert.deepEqual({ ...api.MENU }, {
    selection: 'pt-translate-selection',
    bilingual: 'pt-translate-page-bilingual',
    replace: 'pt-translate-page-replace',
    restore: 'pt-restore-page',
    options: 'pt-options'
  });

  const ids = fixture.created.map((item) => item.id);
  assert.deepEqual(ids, [
    'pt-translate-selection',
    'pt-sep-1',
    'pt-translate-page-bilingual',
    'pt-translate-page-replace',
    'pt-restore-page',
    'pt-sep-2',
    'pt-options'
  ]);

  const selection = fixture.created[0];
  assert.equal(selection.title, '翻译所选文字');
  assert.deepEqual(Array.from(selection.contexts), ['selection']);

  const bilingual = fixture.created[2];
  assert.match(bilingual.title, /双语/);
  assert.deepEqual(
    Array.from(bilingual.contexts),
    ['page', 'selection', 'link', 'image', 'video', 'audio', 'editable'],
    'page actions also work on links and images'
  );

  const replace = fixture.created[3];
  assert.match(replace.title, /替换/);

  const options = fixture.created[6];
  assert.equal(Array.from(options.contexts).length, 7);
});

test('selection menu click forwards normalised text to the tab', async () => {
  const { fixture } = setup();
  await waitFor(() => fixture.clickListeners.length === 1, 1000, 'menu listener');

  click(fixture, { menuItemId: 'pt-translate-selection', selectionText: '  Hello\n  world  ' }, { id: 12 });
  await wait(30);
  assert.equal(fixture.sentToTabs.length, 1);
  assert.equal(fixture.sentToTabs[0].tabId, 12);
  assert.deepEqual(
    { ...fixture.sentToTabs[0].message },
    { __pt: true, type: 'pt:translate-selection', text: 'Hello world' }
  );
});

test('page menu clicks request bilingual, replace and restore', async () => {
  const { fixture } = setup();
  await waitFor(() => fixture.clickListeners.length === 1, 1000, 'menu listener');

  click(fixture, { menuItemId: 'pt-translate-page-bilingual' }, { id: 3 });
  await wait(20);
  click(fixture, { menuItemId: 'pt-translate-page-replace' }, { id: 3 });
  await wait(20);
  click(fixture, { menuItemId: 'pt-restore-page' }, { id: 3 });
  await wait(20);

  assert.deepEqual(
    fixture.sentToTabs.map((call) => call.message.type),
    ['pt:translate-page', 'pt:translate-page', 'pt:restore-page']
  );
  assert.equal(fixture.sentToTabs[0].message.mode, 'bilingual');
  assert.equal(fixture.sentToTabs[1].message.mode, 'replace');
});

test('the options menu entry opens the options page without a tab', async () => {
  const { fixture } = setup();
  await waitFor(() => fixture.clickListeners.length === 1, 1000, 'menu listener');

  click(fixture, { menuItemId: 'pt-options' }, undefined);
  await wait(50);
  assert.equal(fixture.openedOptions.length, 1);
  assert.equal(fixture.sentToTabs.length, 0);
});

test('messages without the __pt envelope are ignored', async () => {
  const { fixture } = setup();
  assert.equal(fixture.messageListeners.length, 1);
  const listener = fixture.messageListeners[0];
  assert.equal(listener({ type: 'translate', text: 'Hello' }, {}, () => {}), undefined);
  assert.equal(listener(null, {}, () => {}), undefined);
  assert.equal(listener({ __pt: true, type: 'pt:ping' }, {}, () => {}), true);
});

test('ping and unknown requests answer through sendResponse', async () => {
  const { fixture } = setup();
  const ping = await dispatch(fixture, { __pt: true, type: 'pt:ping' });
  assert.equal(ping.response.ok, true);
  assert.equal(ping.response.version, '1.0.0');

  const unknown = await dispatch(fixture, { __pt: true, type: 'pt:whatever' });
  assert.equal(unknown.response.ok, false);
  assert.equal(unknown.response.error.code, 'request');
  assert.match(unknown.response.error.message, /未知/);
});

test('translate messages use the settings carried in the message', async () => {
  const { fixture, context } = setup();
  const calls = [];
  context.PT.translate = async (settings, text, options) => {
    calls.push({ settings, text, options });
    return { text: '你好', detected: 'en', provider: settings.provider };
  };

  const answer = await dispatch(fixture, {
    __pt: true,
    type: 'translate',
    text: 'Hello',
    settings: { provider: 'azure', azureKey: 'k', targetLang: 'zh-CN', sourceLang: 'auto' },
    from: 'auto',
    to: 'zh-CN'
  });

  assert.equal(answer.response.ok, true);
  assert.equal(answer.response.text, '你好');
  assert.equal(answer.response.detected, 'en');
  assert.equal(answer.response.provider, 'azure');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].settings.azureKey, 'k');
  assert.equal(calls[0].options.to, 'zh-CN');
});

test('errors are serialised for the UI', async () => {
  const { fixture, context } = setup();
  fixture.storage.local.set({
    settings: { provider: 'azure', targetLang: 'zh-CN' }
  });
  const answer = await dispatch(fixture, { __pt: true, type: 'translate', text: 'Hello' });
  assert.equal(answer.response.ok, false);
  assert.equal(answer.response.error.code, 'config');
  assert.ok(answer.response.error.hint.length > 0);
  assert.equal(context.PT.cacheStats().inflight, 0);
});

test('batch translation keeps per-item failures and caps the batch size', async () => {
  const { fixture, context } = setup();
  context.PT.translate = async (settings, text) => {
    if (text === 'bad') {
      throw new context.PT.ProviderError('auth', '密钥无效', { provider: 'azure' });
    }
    return { text: '译:' + text, detected: 'en', provider: 'mymemory' };
  };

  const answer = await dispatch(fixture, {
    __pt: true,
    type: 'translateBatch',
    texts: ['one', 'bad', 'three'],
    settings: { provider: 'mymemory', targetLang: 'zh-CN' }
  });

  assert.equal(answer.response.ok, true);
  const results = answer.response.results;
  assert.equal(results.length, 3);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].text, '译:one');
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error.code, 'auth');
  assert.equal(results[2].text, '译:three');

  const empty = await dispatch(fixture, {
    __pt: true,
    type: 'translateBatch',
    texts: [],
    settings: { provider: 'mymemory', targetLang: 'zh-CN' }
  });
  assert.deepEqual(Array.from(empty.response.results), []);

  const many = Array.from({ length: 260 }, (_, index) => 't' + index);
  const capped = await dispatch(fixture, {
    __pt: true,
    type: 'translateBatch',
    texts: many,
    settings: { provider: 'mymemory', targetLang: 'zh-CN' }
  });
  assert.equal(capped.response.results.length, 200);
});

test('test-provider bypasses the cache and reports the provider', async () => {
  const { fixture, context } = setup();
  const options = [];
  context.PT.translate = async (settings, text, opts) => {
    options.push({ text, opts });
    return { text: '你好，世界！', detected: 'en', provider: settings.provider };
  };

  const answer = await dispatch(fixture, {
    __pt: true,
    type: 'test-provider',
    settings: { provider: 'tencent', tencentSecretId: 'id', tencentSecretKey: 'key', targetLang: 'zh-CN' }
  });
  assert.equal(answer.response.ok, true);
  assert.equal(answer.response.provider, 'tencent');
  assert.equal(answer.response.text, '你好，世界！');
  assert.equal(options[0].text, 'Hello, world!');
  assert.equal(options[0].opts.noCache, true);
});

test('mapLimit honours the concurrency limit and preserves order', async () => {
  const { api } = setup();
  let active = 0;
  let peak = 0;
  const order = [];

  const results = await api.mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await wait(5 + (7 - value) * 2);
    active -= 1;
    order.push(value);
    return value * 10;
  });

  assert.equal(peak, 3);
  assert.deepEqual(Array.from(results), [10, 20, 30, 40, 50, 60, 70]);
  assert.equal(order.length, 7);

  const empty = await api.mapLimit([], 3, async () => 'never');
  assert.equal(empty.length, 0);

  const failures = await api.mapLimit([1, 2], 1, async (value) => {
    if (value === 2) throw new Error('boom');
    return 'ok';
  });
  assert.equal(failures[0], 'ok');
  assert.equal(failures[1].ok, false);
  assert.equal(failures[1].error.message, 'boom');
});

test('page actions target the active tab', async () => {
  const { fixture } = setup();
  const result = await dispatch(fixture, { __pt: true, type: 'translate-active-page', mode: 'replace' });
  assert.equal(result.response.ok, true);
  assert.equal(fixture.sentToTabs.length, 1);
  assert.equal(fixture.sentToTabs[0].tabId, 7);
  assert.equal(fixture.sentToTabs[0].message.type, 'pt:translate-page');
  assert.equal(fixture.sentToTabs[0].message.mode, 'replace');

  const restored = await dispatch(fixture, { __pt: true, type: 'restore-active-page' });
  assert.equal(restored.response.ok, true);
  assert.equal(fixture.sentToTabs[1].message.type, 'pt:restore-page');
});

test('a missing content script triggers injection and a retry', async () => {
  const { fixture } = setup();
  fixture.failNextSendToTab(1);

  const result = await dispatch(fixture, { __pt: true, type: 'translate-active-page' });
  assert.equal(result.response.ok, true);

  assert.deepEqual(fixture.injected.map((call) => call.details.file), ['common.js', 'content.js']);
  assert.deepEqual(fixture.inserted.map((call) => call.details.file), ['content.css']);
  assert.equal(fixture.sentToTabs.length, 2, 'message is retried after injecting');
  assert.equal(fixture.sentToTabs[1].message.type, 'pt:translate-page');
  assert.equal(fixture.sentToTabs[1].message.mode, 'bilingual');
});

test('CSS injection failures do not break the fallback', async () => {
  const { fixture } = setup();
  fixture.failNextSendToTab(1);
  fixture.browser.tabs.insertCSS = () => Promise.reject(new Error('no css'));

  const result = await dispatch(fixture, { __pt: true, type: 'translate-active-page' });
  assert.equal(result.response.ok, true);
  assert.equal(fixture.sentToTabs.length, 2);
});

test('the open-options message opens settings', async () => {
  const { fixture } = setup();
  const result = await dispatch(fixture, { __pt: true, type: 'open-options' });
  assert.equal(result.response.ok, true);
  assert.equal(fixture.openedOptions.length, 1);
});
