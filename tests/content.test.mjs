import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPage,
  stubRangeRect,
  selectNodeText,
  bootContent,
  wait,
  waitFor
} from './support.mjs';

const ARTICLE = `
  <main>
    <h1>Hello world</h1>
    <p id="first">Hello world</p>
    <p id="chinese">这是一段中文。</p>
    <p id="hidden" style="display:none">Hidden English text</p>
    <pre><code>const answer = 42;</code></pre>
    <script>window.__scriptRan = true;</script>
    <blockquote><p id="nested">Nested English paragraph</p></blockquote>
    <ul><li id="item">List item in English</li></ul>
  </main>
`;

function batchEcho(texts) {
  return texts.map((text) => ({ ok: true, text: '[译]' + text, detected: 'en', provider: 'mymemory' }));
}

function defaultRespond(message) {
  if (message.type === 'translate') {
    return { ok: true, text: '你好，世界', detected: 'en', provider: 'mymemory' };
  }
  if (message.type === 'translateBatch') {
    return { ok: true, results: batchEcho(message.texts) };
  }
  return { ok: true };
}

async function contentPage(options = {}) {
  const page = createPage(options.html === undefined ? ARTICLE : options.html, {
    settings: Object.assign(
      {
        provider: 'mymemory',
        sourceLang: 'auto',
        targetLang: 'zh-CN',
        pageMode: 'bilingual',
        selectionButton: true,
        theme: 'auto'
      },
      options.settings || {}
    ),
    respond: options.respond || defaultRespond,
    scripts: ['content.js'],
    url: options.url || 'https://example.com/article'
  });
  stubRangeRect(page.window);
  const content = await bootContent(page);
  return { ...page, content };
}

function shadow(page) {
  return page.content.getState().shadow;
}

function role(page, name) {
  return shadow(page).querySelector('[data-role="' + name + '"]');
}

function mouseUp(page, x = 150, y = 120) {
  page.window.document.body.dispatchEvent(
    new page.window.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x, clientY: y })
  );
}

test('the content script boots without translating anything', async () => {
  const page = await contentPage();
  assert.ok(page.window.document.querySelector('[data-pt-ui]'), 'UI host is injected');
  assert.equal(page.window.document.querySelectorAll('[data-pt-translation]').length, 0);
  assert.notEqual(role(page, 'selection').style.display, 'flex');
  assert.equal(role(page, 'panel').classList.contains('pt-open'), false);
  assert.equal(role(page, 'progress').hidden, true);
  assert.equal(page.browser.sent.length, 0, 'no request is made on load');
});

test('selecting text shows the floating button and a click translates it', async () => {
  const page = await contentPage();
  const paragraph = page.window.document.getElementById('first');
  selectNodeText(page.window, paragraph);

  mouseUp(page);
  await waitFor(() => role(page, 'selection').style.display === 'flex', 500, 'button visible');

  const button = role(page, 'selection');
  assert.equal(button.getAttribute('aria-label'), '翻译所选文字');
  assert.match(button.textContent, /翻译/);
  assert.ok(parseInt(button.style.left, 10) >= 8);
  assert.ok(parseInt(button.style.top, 10) >= 8);

  button.click();
  await waitFor(() => role(page, 'result').textContent === '你好，世界', 1000, 'translation shown');

  assert.equal(role(page, 'panel').classList.contains('pt-open'), true);
  assert.equal(role(page, 'original').textContent, 'Hello world');
  assert.equal(role(page, 'result').hidden, false);
  assert.equal(role(page, 'loading').hidden, true);
  assert.equal(role(page, 'status-dot').getAttribute('data-state'), 'ok');
  assert.equal(role(page, 'langs').textContent, '英语 → 简体中文');
  assert.equal(role(page, 'provider').textContent, 'MyMemory');

  const request = page.browser.sent[0];
  assert.equal(request.__pt, true);
  assert.equal(request.type, 'translate');
  assert.equal(request.text, 'Hello world');
  assert.equal(request.to, 'zh-CN');
  assert.equal(role(page, 'selection').style.display, 'none', 'button hides after clicking');
});

test('a selection longer than 5000 characters does not offer a button', async () => {
  const page = await contentPage();
  const paragraph = page.window.document.getElementById('first');
  paragraph.textContent = 'hello '.repeat(900);
  selectNodeText(page.window, paragraph);

  mouseUp(page);
  await wait(40);
  assert.equal(role(page, 'selection').style.display, 'none');
});

test('the floating button can be disabled in the settings', async () => {
  const page = await contentPage({ settings: { selectionButton: false } });
  selectNodeText(page.window, page.window.document.getElementById('first'));

  mouseUp(page);
  await wait(40);
  assert.notEqual(role(page, 'selection').style.display, 'flex');
});

test('turning the selection button off in storage hides it live', async () => {
  const page = await contentPage();
  selectNodeText(page.window, page.window.document.getElementById('first'));
  mouseUp(page);
  await waitFor(() => role(page, 'selection').style.display === 'flex', 500, 'button visible');

  await page.browser.storage.local.set({
    settings: { provider: 'mymemory', targetLang: 'zh-CN', selectionButton: false }
  });
  await wait(30);
  assert.equal(role(page, 'selection').style.display, 'none');
});

test('provider errors are shown with a hint and a settings shortcut', async () => {
  const page = await contentPage({
    respond: (message) =>
      message.type === 'translate'
        ? {
            ok: false,
            error: { code: 'auth', message: '微软翻译密钥无效', hint: '请检查密钥和区域。', provider: 'azure' }
          }
        : { ok: true }
  });

  await page.content.translateSelection('Hello world', { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 });
  await waitFor(() => role(page, 'error').hidden === false, 800, 'error shown');

  assert.equal(role(page, 'result').hidden, true);
  assert.equal(role(page, 'error-title').textContent, '密钥无效或权限不足');
  assert.equal(role(page, 'error-message').textContent, '微软翻译密钥无效');
  assert.equal(role(page, 'error-hint').textContent, '请检查密钥和区域。');
  assert.equal(role(page, 'status-dot').getAttribute('data-state'), 'error');
  assert.equal(shadow(page).querySelector('[data-action="retry"]').disabled, false);
});

test('translations are inserted with textContent, never HTML', async () => {
  const payload = '<img src=x onerror="window.__xss = true"><b>bold</b>';
  const page = await contentPage({
    respond: (message) =>
      message.type === 'translate'
        ? { ok: true, text: payload, detected: 'en', provider: 'mymemory' }
        : { ok: true }
  });

  await page.content.translateSelection('Hello world', { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 });
  await waitFor(() => role(page, 'result').textContent.length > 0, 800, 'result rendered');

  assert.equal(role(page, 'result').textContent, payload);
  assert.equal(role(page, 'result').querySelector('img'), null);
  assert.equal(role(page, 'result').querySelector('b'), null);
  await wait(20);
  assert.equal(page.window.__xss, undefined);
});

test('Escape closes the panel', async () => {
  const page = await contentPage();
  await page.content.translateSelection('Hello world', { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 });
  await waitFor(() => role(page, 'panel').classList.contains('pt-open'), 800, 'panel open');

  page.window.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(role(page, 'panel').classList.contains('pt-open'), false);
});

test('bilingual page translation appends translations and skips code/script/hidden text', async () => {
  const page = await contentPage();

  await page.content.translatePage('bilingual');
  await waitFor(
    () => page.content.getState().page.status === 'translated' && !page.content.getState().page.running,
    3000,
    'page translated'
  );

  const document = page.window.document;
  const first = document.getElementById('first');
  const span = first.querySelector('[data-pt-translation]');
  assert.ok(span, 'translation span inserted');
  assert.equal(span.textContent, '[译]Hello world');
  assert.equal(span.getAttribute('lang'), 'zh-CN');
  assert.equal(first.textContent, 'Hello world[译]Hello world', 'original text is preserved');

  assert.equal(document.querySelector('pre [data-pt-translation]'), null, 'code is skipped');
  assert.equal(document.getElementById('hidden').querySelector('[data-pt-translation]'), null, 'hidden text is skipped');
  assert.equal(document.getElementById('chinese').querySelector('[data-pt-translation]'), null, 'same language is skipped');
  assert.equal(document.getElementById('nested').querySelector('[data-pt-translation]').textContent, '[译]Nested English paragraph');
  assert.equal(document.getElementById('item').querySelector('[data-pt-translation]').textContent, '[译]List item in English');

  assert.equal(page.content.getState().page.total, 4, 'h1, first, nested and item');

  const batch = page.browser.sent.find((message) => message.type === 'translateBatch');
  assert.ok(batch, 'batched requests are used');
  assert.equal(batch.to, 'zh-CN');
  assert.equal(batch.from, 'auto');
  assert.ok(Array.isArray(batch.texts));
  assert.ok(!batch.texts.some((text) => text.includes('const answer')), 'code is not sent');

  assert.equal(role(page, 'progress').hidden, false, 'progress panel stays up briefly');
  assert.match(role(page, 'toast-text').textContent, /已完成 4 段翻译/);
});

test('restoring a bilingual page removes every inserted node', async () => {
  const page = await contentPage();
  await page.content.translatePage('bilingual');
  await waitFor(() => page.content.getState().page.status === 'translated', 3000, 'translated');
  assert.ok(page.window.document.querySelectorAll('[data-pt-translation]').length > 0);

  page.content.restorePage();
  assert.equal(page.window.document.querySelectorAll('[data-pt-translation]').length, 0);
  assert.equal(page.window.document.getElementById('first').textContent, 'Hello world');
  assert.equal(page.content.getState().page.status, 'idle');
  assert.equal(role(page, 'toast-text').textContent, '已还原原文');
});

test('replace mode swaps text and restores the exact original whitespace', async () => {
  const html = '<article><p id="one">  Hello world  </p><p id="two">Another sentence here</p><code>keep me</code></article>';
  const page = await contentPage({ html });

  await page.content.translatePage('replace');
  await waitFor(
    () => page.content.getState().page.status === 'translated' && !page.content.getState().page.running,
    3000,
    'replace finished'
  );

  const document = page.window.document;
  assert.equal(document.getElementById('one').textContent, '  [译]Hello world  ');
  assert.equal(document.getElementById('two').textContent, '[译]Another sentence here');
  assert.equal(document.querySelector('code').textContent, 'keep me');
  assert.equal(document.querySelectorAll('[data-pt-translation]').length, 0, 'replace mode adds no spans');

  page.content.restorePage();
  assert.equal(document.getElementById('one').textContent, '  Hello world  ');
  assert.equal(document.getElementById('two').textContent, 'Another sentence here');
});

test('a page without translatable text reports it instead of requesting', async () => {
  const page = await contentPage({ html: '<p>这里只有中文内容。</p>' });
  await page.content.translatePage('bilingual');
  await waitFor(() => role(page, 'toast-text').textContent.length > 0, 800, 'toast shown');

  assert.match(role(page, 'toast-text').textContent, /没有找到需要翻译的文本/);
  assert.equal(page.browser.sent.length, 0);
});


test('restoring mid-flight does not let the stale run clobber a new translation', async () => {
  let release;
  let gated = false;
  const gate = new Promise((resolve) => { release = resolve; });

  const page = await contentPage({
    respond: (message) => {
      if (message.type !== 'translateBatch') return { ok: true };
      const results = message.texts.map((text) => ({
        ok: true,
        text: '[译]' + text,
        detected: 'en',
        provider: 'mymemory'
      }));
      if (!gated) {
        gated = true;
        return gate.then(() => ({ ok: true, results }));
      }
      return { ok: true, results };
    }
  });

  const firstRun = page.content.translatePage('bilingual');
  await wait(30);
  assert.equal(page.content.getState().page.running, true, 'first run still waiting');

  page.content.restorePage();
  const secondRun = page.content.translatePage('bilingual');
  await secondRun;
  assert.equal(page.content.getState().page.status, 'translated');
  assert.ok(page.window.document.querySelectorAll('[data-pt-translation]').length > 0);

  release();
  await firstRun;

  assert.equal(page.content.getState().page.status, 'translated', 'second run keeps ownership');
  assert.equal(page.content.getState().page.running, false);
  assert.ok(page.window.document.querySelectorAll('[data-pt-translation]').length > 0, 'translations survive');
  assert.match(role(page, 'toast-text').textContent, /已完成/);
});

test('fatal provider errors stop the run and explain the failure', async () => {
  const page = await contentPage({
    respond: (message) =>
      message.type === 'translateBatch'
        ? {
            ok: true,
            results: message.texts.map(() => ({
              ok: false,
              error: { code: 'auth', message: '密钥无效', hint: '检查密钥' }
            }))
          }
        : { ok: true }
  });

  await page.content.translatePage('bilingual');
  await waitFor(() => !page.content.getState().page.running, 2000, 'run stopped');

  const state = page.content.getState().page;
  assert.equal(state.status, 'idle');
  assert.match(role(page, 'toast-text').textContent, /翻译中断：密钥无效/);
  assert.equal(page.window.document.querySelectorAll('[data-pt-translation]').length, 0);
});

test('a half-failed batch keeps the successful translations', async () => {
  let call = 0;
  const page = await contentPage({
    respond: (message) => {
      if (message.type !== 'translateBatch') return { ok: true };
      call += 1;
      return {
        ok: true,
        results: message.texts.map((text, index) =>
          index === 0 && call === 1
            ? { ok: false, error: { code: 'server', message: '临时故障' } }
            : { ok: true, text: '[译]' + text, detected: 'en' }
        )
      };
    }
  });

  await page.content.translatePage('bilingual');
  await waitFor(() => !page.content.getState().page.running, 3000, 'run finished');

  assert.ok(page.window.document.querySelectorAll('[data-pt-translation]').length > 0);
  assert.match(role(page, 'toast-text').textContent, /段失败/);
});

test('runtime messages drive selection, page, restore and ping', async () => {
  const page = await contentPage();

  const ping = page.browser.emitMessage({ __pt: true, type: 'pt:ping' });
  assert.deepEqual({ ...ping }, { ok: true, translated: false });

  const reply = page.browser.emitMessage({ __pt: true, type: 'pt:translate-selection', text: 'Hello world' });
  assert.equal(reply.ok, true);
  await waitFor(() => role(page, 'result').textContent === '你好，世界', 1000, 'message translation');

  page.browser.emitMessage({ __pt: true, type: 'pt:translate-page', mode: 'bilingual' });
  await waitFor(() => page.content.getState().page.status === 'translated', 3000, 'page translated');
  assert.equal(page.browser.emitMessage({ __pt: true, type: 'pt:ping' }).translated, true);

  page.browser.emitMessage({ __pt: true, type: 'pt:restore-page' });
  assert.equal(page.window.document.querySelectorAll('[data-pt-translation]').length, 0);
  assert.equal(page.browser.emitMessage({ __pt: true, type: 'pt:ping' }).translated, false);

  const ignored = page.browser.emitMessage({ type: 'pt:translate-page' });
  assert.equal(ignored, undefined, 'messages without __pt are ignored');
});

test('pt:get-selection returns the selected text', async () => {
  const page = await contentPage();
  selectNodeText(page.window, page.window.document.getElementById('first'));

  const reply = page.browser.emitMessage({ __pt: true, type: 'pt:get-selection' });
  assert.equal(reply.ok, true);
  assert.equal(reply.text, 'Hello world');
});

test('the provider label follows settings changes', async () => {
  const page = await contentPage();
  assert.equal(role(page, 'provider').textContent, 'MyMemory');

  await page.browser.storage.local.set({
    settings: { provider: 'tencent', targetLang: 'ja', selectionButton: true }
  });
  await wait(30);

  const pending = page.content.translateSelection('Hello world', {
    left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20
  });
  assert.equal(role(page, 'provider').textContent, 'Tencent Cloud');
  await pending;
  assert.equal(page.content.getState().settings.provider, 'tencent');
});

test('the panel target language can be changed', async () => {
  const page = await contentPage();
  await page.content.translateSelection('Hello world', { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 });
  await waitFor(() => role(page, 'result').textContent === '你好，世界', 1000, 'first translation');

  const select = role(page, 'target');
  assert.equal(select.value, 'zh-CN');
  select.value = 'ja';
  select.dispatchEvent(new page.window.Event('change', { bubbles: true }));

  await waitFor(() => page.browser.storage.data.settings.targetLang === 'ja', 1000, 'target saved');
  await waitFor(() => page.browser.sent.filter((message) => message.type === 'translate').length === 2, 1000, 'retranslated');
  assert.equal(page.browser.sent[1].to, 'ja');
});
