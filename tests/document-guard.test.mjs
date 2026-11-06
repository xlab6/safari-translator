import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, read, wait, waitFor } from './support.mjs';

/**
 * The content script is declared for <all_urls>, so Safari also injects it
 * into JSON and plain-text documents. Two things must hold there:
 *
 *   1. nothing is attached to the page (a raw JSON document is not a web page),
 *   2. a page whose CSP refuses the injected stylesheet never shows the
 *      unstyled UI (fail closed instead of covering the page).
 *
 * api.github.com is the reference case: `content-type: application/json` plus
 * `content-security-policy: default-src 'none'`.
 */

const API_URL = 'https://api.github.com/repos/octocat/Hello-World';

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

/** Boot the real content script against a document with an explicit MIME type. */
function bootDocument(body, contentType, url) {
  const page = createPage('<pre>' + escapeHtml(body) + '</pre>', { scripts: [], url });
  // jsdom can only build HTML documents, so report the MIME type Safari would.
  Object.defineProperty(page.window.document, 'contentType', {
    value: contentType,
    configurable: true
  });
  page.window.eval(read('content.js'));
  return page;
}

function closePage(page) {
  try { page.window.close(); } catch (error) { /* already closed */ }
}

test('api.github.com: the extension leaves the JSON document alone', async (t) => {
  let response;
  try {
    response = await fetch(API_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'safari-translator-tests' }
    });
  } catch (error) {
    t.skip('api.github.com is unreachable: ' + error.message);
    return;
  }

  if (response.status !== 200) {
    t.skip('api.github.com answered ' + response.status + ' (rate limited?)');
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();

  // Guard the assumptions this test relies on.
  assert.match(contentType, /^application\/json/);
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/);

  const page = bootDocument(body, contentType, API_URL);
  await wait(80);

  const document = page.window.document;
  assert.equal(document.querySelector('[data-pt-ui]'), null, 'no UI host on a JSON document');
  assert.equal(document.querySelector('.pt-layer'), null);
  assert.equal(page.window.__PT_CONTENT__, undefined, 'content script stopped before booting');

  // Clicking “翻译此页面” still answers, with a reason instead of silence.
  const ping = page.browser.emitMessage({ __pt: true, type: 'pt:ping' });
  assert.equal(ping.ok, true);
  assert.equal(ping.translatable, false);
  const refused = page.browser.emitMessage({ __pt: true, type: 'pt:translate-page' });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'document');
  assert.match(refused.error.message, /不是网页/);

  closePage(page);
});

test('the same payload served as text/html still gets the floating UI', async () => {
  const page = bootDocument('{"name":"cluster-service"}', 'text/html; charset=utf-8', 'https://example.com/artifact');
  await waitFor(() => page.window.__PT_CONTENT__, 2000, 'content script boot');

  assert.ok(page.window.document.querySelector('[data-pt-ui]'), 'UI host is injected');
  assert.equal(page.window.document.documentElement.firstChild.nodeType, 1);
  closePage(page);
});

test('a page whose CSP refuses the stylesheet gets no UI at all', async () => {
  const page = createPage('<p>Hello world</p>', { scripts: [], url: 'https://example.com/csp' });
  const window = page.window;

  // What a strict style-src CSP does: no constructed stylesheet support for the
  // injected content, and the inline <style> element never gets a sheet.
  Object.defineProperty(window, 'CSSStyleSheet', { value: undefined, configurable: true });
  Object.defineProperty(window.HTMLStyleElement.prototype, 'sheet', {
    get() { return null; },
    configurable: true
  });

  window.eval(read('content.js'));
  await wait(80);

  assert.equal(window.document.querySelector('[data-pt-ui]'), null, 'unstyled UI must not stay in the page');
  assert.equal(window.__PT_CONTENT__, undefined, 'boot stops when the stylesheet is unavailable');
  closePage(page);
});
