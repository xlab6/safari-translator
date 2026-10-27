import test from 'node:test';
import assert from 'node:assert/strict';
import {
  read,
  loadJsdom,
  createBrowserStub,
  wait,
  waitFor
} from './support.mjs';

/**
 * Load a real extension page (popup.html / options.html) into jsdom, install
 * the browser stub, then evaluate common.js and the page script.
 */
function loadExtensionPage(file, options = {}) {
  const { JSDOM: Dom } = loadJsdom();
  const dom = new Dom(read(file), {
    url: 'safari-web-extension://safari-translator/' + file,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });

  const window = dom.window;
  window.matchMedia = () => ({
    matches: false,
    media: '',
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {}
  });
  window.confirm = () => true;
  window.close = () => { window.__closed = true; };

  const browser = options.browser || createBrowserStub(options);
  window.browser = browser;

  window.eval(read('common.js'));
  (options.scripts || [pathScript(file)]).forEach((script) => {
    if (script) window.eval(read(script));
  });

  return { dom, window, browser, document: window.document };
}

function pathScript(file) {
  return file.replace(/\.html$/, '.js');
}

function $(page, id) {
  return page.document.getElementById(id);
}

function card(page, provider) {
  return page.document.querySelector('[data-provider="' + provider + '"]');
}

function providerIds(page) {
  return Array.from(page.document.querySelectorAll('.provider-card')).map((node) =>
    node.getAttribute('data-provider')
  );
}

function providerCards(page) {
  return Array.from(page.document.querySelectorAll('.provider-card'));
}

/* ------------------------------------------------------------------ *
 * Popup
 * ------------------------------------------------------------------ */

function popup(options = {}) {
  return loadExtensionPage('popup.html', Object.assign({
    settings: {
      provider: 'mymemory',
      sourceLang: 'auto',
      targetLang: 'zh-CN',
      selectionButton: true,
      pageMode: 'bilingual',
      theme: 'auto'
    }
  }, options));
}

test('the popup renders the current provider, language and version', async () => {
  const page = popup({
    settings: {
      provider: 'azure',
      azureKey: 'secret',
      sourceLang: 'auto',
      targetLang: 'ja',
      selectionButton: false,
      pageMode: 'bilingual',
      theme: 'auto'
    }
  });

  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  assert.equal($(page, 'provider-name').textContent, 'Microsoft Translator');
  assert.equal($(page, 'provider-badge').textContent, 'Az');
  assert.equal($(page, 'provider-badge').getAttribute('data-tone'), 'key');
  assert.equal($(page, 'target').value, 'ja');
  assert.ok($(page, 'target').options.length >= 30);
  assert.equal($(page, 'selection-toggle').checked, false);
  assert.equal($(page, 'version').textContent, 'v1.1.9');
});

test('the popup uses the saved page mode for the primary action', async () => {
  let release;
  const page = popup({
    respond: (message) =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      })
  });
  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  assert.equal($(page, 'page-mode-label').textContent, '双语对照');
  assert.equal($(page, 'alternate-page').textContent, '替换原文');

  $(page, 'translate-page').click();
  await waitFor(() => $(page, 'translate-page').disabled, 500, 'busy state');

  assert.equal(page.browser.sent.length, 1);
  assert.equal(page.browser.sent[0].type, 'translate-active-page');
  assert.equal(page.browser.sent[0].mode, 'bilingual');
  assert.equal(page.browser.sent[0].__pt, true);
  assert.equal($(page, 'restore-page').disabled, true);

  release();
  await wait(30);
  assert.equal(page.window.__closed, true);
});

test('the popup defaults to replacing the original text', async () => {
  const page = popup({
    settings: {
      provider: 'mymemory',
      sourceLang: 'auto',
      targetLang: 'zh-CN',
      selectionButton: true,
      theme: 'auto'
    }
  });
  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  assert.equal($(page, 'page-mode-label').textContent, '替换原文');
  assert.equal($(page, 'alternate-page').textContent, '双语对照');

  $(page, 'translate-page').click();
  await waitFor(() => page.browser.sent.length === 1, 500, 'request sent');
  assert.equal(page.browser.sent[0].type, 'translate-active-page');
  assert.equal(page.browser.sent[0].mode, 'replace');
});

test('the alternate mode button requests the other mode', async () => {
  const page = popup();
  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  $(page, 'alternate-page').click();
  await waitFor(() => page.browser.sent.length === 1, 500, 'request sent');
  assert.equal(page.browser.sent[0].type, 'translate-active-page');
  assert.equal(page.browser.sent[0].mode, 'replace');
});

test('the popup restore button asks the background to restore', async () => {
  const page = popup();
  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  $(page, 'restore-page').click();
  await waitFor(() => page.browser.sent.length === 1, 500, 'request sent');
  assert.equal(page.browser.sent[0].type, 'restore-active-page');
});

test('a failing page action shows the error, hint and a settings shortcut', async () => {
  const page = popup({
    respond: () => ({
      ok: false,
      error: { code: 'auth', message: '微软翻译密钥无效', hint: '请检查密钥和区域。' }
    })
  });
  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  $(page, 'translate-page').click();
  await waitFor(() => !$(page, 'status').hidden, 800, 'status shown');

  const status = $(page, 'status');
  assert.equal(status.getAttribute('data-tone'), 'error');
  assert.match(status.textContent, /密钥无效/);
  assert.match(status.textContent, /请检查密钥和区域/);
  assert.ok(status.querySelector('button'), 'offers a shortcut');
  assert.equal(status.querySelector('button').textContent, '打开设置');
  assert.equal($(page, 'translate-page').disabled, false, 'controls re-enabled');
});

test('an unconfigured provider is rejected before any message is sent', async () => {
  const page = popup({
    settings: { provider: 'tencent', sourceLang: 'auto', targetLang: 'zh-CN', selectionButton: true }
  });
  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  $(page, 'translate-page').click();
  await wait(30);

  assert.equal(page.browser.sent.length, 0);
  const status = $(page, 'status');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /SecretId|密钥/);
  assert.equal(status.querySelector('button').textContent, '打开设置');
});

test('changing the target language persists it', async () => {
  const page = popup();
  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  const select = $(page, 'target');
  select.value = 'fr';
  select.dispatchEvent(new page.window.Event('change', { bubbles: true }));

  await waitFor(() => page.browser.storage.data.settings.targetLang === 'fr', 1000, 'target saved');
});

test('the floating-button toggle persists its state', async () => {
  const page = popup();
  await waitFor(() => $(page, 'target').options.length >= 30, 1000, 'popup init');

  const toggle = $(page, 'selection-toggle');
  toggle.checked = false;
  toggle.dispatchEvent(new page.window.Event('change', { bubbles: true }));

  await waitFor(() => page.browser.storage.data.settings.selectionButton === false, 1000, 'toggle saved');
});

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

function options(options = {}) {
  return loadExtensionPage('options.html', Object.assign({
    settings: {
      provider: 'mymemory',
      sourceLang: 'auto',
      targetLang: 'zh-CN',
      selectionButton: true,
      pageMode: 'bilingual',
      theme: 'auto'
    }
  }, options));
}

test('the options page lists every provider with the current one selected', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');

  assert.deepEqual(providerIds(page), [
    'mymemory', 'google', 'azure', 'aliyun', 'tencent', 'deepl', 'libre', 'openai'
  ]);
  assert.equal(providerCards(page).length, 8);
  assert.equal(card(page, 'mymemory').getAttribute('aria-checked'), 'true');
  assert.equal(card(page, 'azure').getAttribute('aria-checked'), 'false');
  assert.deepEqual(
    providerCards(page).map((node) => node.querySelector('.provider-name').textContent),
    [
      'MyMemory', 'Google 翻译', 'Microsoft Translator', 'Alibaba Cloud',
      'Tencent Cloud', 'DeepL', 'LibreTranslate', 'OpenAI Compatible'
    ]
  );
  assert.equal($(page, 'version').textContent, '1.1.9 · macOS Safari');
  assert.match($(page, 'fields').textContent, /无需填写密钥/);

  const repo = page.document.querySelector('.repo-link');
  assert.equal(repo.getAttribute('href'), 'https://github.com/xlab6/safari-translator');
  assert.equal(repo.getAttribute('target'), '_blank');
  assert.equal(repo.textContent, 'github.com/xlab6/safari-translator');
  assert.equal(page.document.querySelector('.security'), null, 'privacy section removed');
  assert.doesNotMatch(page.document.body.textContent, /隐私与安全/);
});

test('switching provider re-renders its credential fields and saves at once', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');

  card(page, 'azure').click();
  await waitFor(() => page.browser.storage.data.settings.provider === 'azure', 1000, 'provider saved');

  assert.equal(card(page, 'azure').getAttribute('aria-checked'), 'true');
  assert.equal(card(page, 'mymemory').getAttribute('aria-checked'), 'false');
  assert.ok($(page, 'field-azureKey'), 'key field rendered');
  assert.ok($(page, 'field-azureRegion'), 'region field rendered');
  assert.ok($(page, 'field-azureEndpoint'), 'endpoint field rendered');
  assert.equal($(page, 'field-azureKey').type, 'password');
  assert.match($(page, 'config-desc').textContent, /Azure/);

  card(page, 'tencent').click();
  await waitFor(() => $(page, 'field-tencentSecretId'), 1000, 'tencent fields');
  assert.ok($(page, 'field-tencentSecretKey'));
  assert.ok($(page, 'field-tencentRegion'));
  assert.equal($(page, 'field-tencentSecretKey').type, 'password');
});

test('a dropped settings write is reported instead of showing 已保存', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');

  // Safari has returned resolved writes that never reached storage.
  page.browser.storage.local.set = (items, callback) => {
    setTimeout(() => callback && callback(), 0);
    return Promise.resolve();
  };

  card(page, 'google').click();
  await waitFor(() => $(page, 'save-state').textContent === '保存失败', 2000, 'failure reported');
  assert.equal(page.browser.storage.data.settings.provider, 'mymemory');
});

test('credential edits are auto-saved after a short delay', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');
  card(page, 'azure').click();
  await waitFor(() => $(page, 'field-azureKey'), 1000, 'azure fields');
  await waitFor(() => $(page, 'save-state').textContent === '已保存', 1000, 'provider saved');
  await wait(60);

  const input = $(page, 'field-azureKey');
  input.value = 'super-secret-key';
  input.dispatchEvent(new page.window.Event('input', { bubbles: true }));

  assert.equal($(page, 'save-state').textContent, '保存中…');
  await wait(150);
  assert.notEqual(page.browser.storage.data.settings.azureKey, 'super-secret-key', 'debounced');

  await waitFor(() => page.browser.storage.data.settings.azureKey === 'super-secret-key', 1500, 'auto-saved');
  assert.equal($(page, 'save-state').textContent, '已保存');
});

test('the reveal button toggles the password field', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');
  card(page, 'deepl').click();
  await waitFor(() => $(page, 'field-deeplKey'), 1000, 'deepl fields');

  const input = $(page, 'field-deeplKey');
  assert.equal(input.type, 'password');
  const reveal = input.parentElement.querySelector('.reveal');
  reveal.click();
  assert.equal(input.type, 'text');
});

test('testing a keyless provider reports the translated sample', async () => {
  const page = options({
    respond: () => ({ ok: true, text: '你好，世界！', detected: 'en', provider: 'mymemory' })
  });
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');

  $(page, 'test').click();
  await waitFor(() => !$(page, 'test-result').hidden, 1000, 'test result');

  const box = $(page, 'test-result');
  assert.equal(box.getAttribute('data-tone'), 'ok');
  assert.equal(box.querySelector('.test-title').textContent, '测试成功 · MyMemory');
  assert.equal(box.querySelector('.test-text').textContent, '你好，世界！');
  assert.match(box.querySelector('.test-hint').textContent, /检测到原文语言/);

  const sent = page.browser.sent[0];
  assert.equal(sent.type, 'test-provider');
  assert.equal(sent.text, 'Hello, world!');
  assert.equal(sent.settings.provider, 'mymemory');
  assert.equal($(page, 'test').disabled, false);
  assert.equal($(page, 'test').textContent, '测试翻译');
});

test('testing with missing credentials is blocked locally', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');
  card(page, 'aliyun').click();
  await waitFor(() => $(page, 'field-aliyunKeyId'), 1000, 'aliyun fields');

  $(page, 'test').click();
  await wait(30);
  assert.equal(page.browser.sent.length, 0);

  const box = $(page, 'test-result');
  assert.equal(box.hidden, false);
  assert.equal(box.getAttribute('data-tone'), 'error');
  assert.equal(box.querySelector('.test-title').textContent, '无法测试');
  assert.match(box.textContent, /AccessKey/);
});

test('a provider error is rendered in the test result', async () => {
  const page = options({
    respond: () => ({
      ok: false,
      error: { code: 'quota', message: '本月免费额度已用完', hint: '请充值或改用其他服务。' }
    })
  });
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');

  $(page, 'test').click();
  await waitFor(() => !$(page, 'test-result').hidden, 1000, 'test result');

  const box = $(page, 'test-result');
  assert.equal(box.getAttribute('data-tone'), 'error');
  assert.equal(box.querySelector('.test-title').textContent, '测试失败');
  assert.match(box.textContent, /本月免费额度已用完/);
  assert.match(box.textContent, /请充值/);
});

test('the options page defaults to replace mode', async () => {
  const page = options({
    settings: {
      provider: 'mymemory',
      sourceLang: 'auto',
      targetLang: 'zh-CN',
      selectionButton: true,
      theme: 'auto'
    }
  });
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');

  assert.equal(
    page.document.querySelector('.mode[data-mode="replace"]').getAttribute('aria-checked'),
    'true'
  );
  assert.equal(
    page.document.querySelector('.mode[data-mode="bilingual"]').getAttribute('aria-checked'),
    'false'
  );
});

test('page mode, theme and language controls persist', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');

  const replace = page.document.querySelector('.mode[data-mode="replace"]');
  replace.click();
  await waitFor(() => page.browser.storage.data.settings.pageMode === 'replace', 1000, 'mode saved');
  assert.equal(replace.getAttribute('aria-checked'), 'true');
  assert.equal(
    page.document.querySelector('.mode[data-mode="bilingual"]').getAttribute('aria-checked'),
    'false'
  );

  const theme = $(page, 'theme');
  theme.value = 'dark';
  theme.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  await waitFor(() => page.browser.storage.data.settings.theme === 'dark', 1000, 'theme saved');

  const source = $(page, 'source-lang');
  source.value = 'ja';
  source.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  await waitFor(() => page.browser.storage.data.settings.sourceLang === 'ja', 1000, 'source saved');

  const selection = $(page, 'selection-button');
  selection.checked = false;
  selection.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  await waitFor(() => page.browser.storage.data.settings.selectionButton === false, 1000, 'selection saved');
});

test('reset restores the default settings', async () => {
  const page = options({
    settings: {
      provider: 'tencent',
      tencentSecretId: 'id',
      tencentSecretKey: 'key',
      targetLang: 'ja',
      pageMode: 'replace',
      sourceLang: 'ja'
    }
  });
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');
  assert.equal(card(page, 'tencent').getAttribute('aria-checked'), 'true');

  $(page, 'reset').click();
  await waitFor(() => page.browser.storage.data.settings.provider === 'mymemory', 1500, 'reset saved');

  const saved = page.browser.storage.data.settings;
  assert.equal(saved.targetLang, 'zh-CN');
  assert.equal(saved.pageMode, 'replace');
  assert.equal(saved.tencentSecretId, '');
  await waitFor(() => card(page, 'mymemory').getAttribute('aria-checked') === 'true', 1000, 'defaults rendered');
  assert.equal($(page, 'save-state').textContent, '已恢复默认');
});

test('the chosen provider is still selected after reopening the page', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');

  card(page, 'deepl').click();
  await waitFor(() => page.browser.storage.data.settings.provider === 'deepl', 1500, 'provider saved');
  assert.equal($(page, 'save-state').textContent, '已保存');

  const reopened = options({ browser: page.browser });
  await waitFor(() => providerIds(reopened).length > 0, 1000, 'reopened providers');
  assert.equal(card(reopened, 'deepl').getAttribute('aria-checked'), 'true');
  assert.equal(card(reopened, 'mymemory').getAttribute('aria-checked'), 'false');
});

test('a reused options page re-reads the stored settings when shown again', async () => {
  const page = options();
  await waitFor(() => providerIds(page).length > 0, 1000, 'providers rendered');
  assert.equal(card(page, 'mymemory').getAttribute('aria-checked'), 'true');

  // Simulate another tab changing the provider while this page is hidden.
  await page.browser.storage.local.set({
    settings: Object.assign({}, page.browser.storage.data.settings, { provider: 'azure', azureKey: 'k' })
  });
  page.window.dispatchEvent(new page.window.Event('pageshow'));

  await waitFor(() => card(page, 'azure').getAttribute('aria-checked') === 'true', 1000, 'page resynced');
  assert.ok($(page, 'field-azureKey'), 'the config for the stored provider is rendered');
});
