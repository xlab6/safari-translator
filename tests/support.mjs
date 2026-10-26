/*
 * Shared test helpers.
 *
 * The extension is made of classic scripts (no modules, no bundler), so the
 * tests load the real files into a `vm` context for the background/network
 * code and into jsdom for the DOM code. Nothing is mocked except the browser
 * APIs and `fetch`.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const EXTENSION = path.join(ROOT, 'extension');

export function read(file) {
  return fs.readFileSync(path.join(EXTENSION, file), 'utf8');
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(check, timeout = 2000, label = 'condition') {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = check();
    if (value) return value;
    await wait(10);
  }
  throw new Error('timed out waiting for ' + label);
}

/* ------------------------------------------------------------------ *
 * jsdom
 * ------------------------------------------------------------------ */

let cachedJsdom = null;

export function loadJsdom() {
  if (cachedJsdom) return cachedJsdom;
  try {
    cachedJsdom = require('jsdom');
  } catch (error) {
    // This checkout is normally tested with the jsdom copy that already lives
    // next to the reference project; `npm install` provides the real thing.
    const sibling = path.resolve(ROOT, '../json-viewer-safari/node_modules/jsdom');
    try {
      cachedJsdom = require(process.env.PT_JSDOM || sibling);
    } catch (fallbackError) {
      throw new Error(
        'jsdom is required for the DOM tests. Run `npm install` in ' +
          ROOT +
          ' (or set PT_JSDOM to a jsdom install).'
      );
    }
  }
  return cachedJsdom;
}

/* ------------------------------------------------------------------ *
 * vm context for background / provider code
 * ------------------------------------------------------------------ */

export function createSandbox(overrides = {}) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    URL,
    URLSearchParams,
    AbortController,
    crypto: webcrypto,
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    navigator: { language: 'zh-CN', userAgent: 'Mozilla/5.0 Safari/605.1.15' },
    location: { href: 'https://example.com/' },
    ...overrides
  };
  sandbox.fetch = overrides.fetch || ((...args) => globalThis.fetch(...args));
  return vm.createContext(sandbox);
}

export function run(context, code) {
  return vm.runInContext(code, context, { filename: 'extension-script.js' });
}

export function loadPT(context) {
  run(context, read('common.js'));
  run(context, read('providers.js'));
  return context.PT;
}

export function loadBackground(context) {
  loadPT(context);
  run(context, read('background.js'));
  return context.__PT_BACKGROUND__;
}

/* ------------------------------------------------------------------ *
 * Network fakes
 * ------------------------------------------------------------------ */

export function jsonResponse(status, body, headers) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {})
  });
}

/** Records every fetch call and delegates to `handler`. */
export function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const call = { url: String(url), init: init || {} };
    calls.push(call);
    return handler(call);
  };
  fn.calls = calls;
  return fn;
}

export function header(call, name) {
  const headers = (call.init && call.init.headers) || {};
  const wanted = String(name).toLowerCase();
  const key = Object.keys(headers).find((name) => name.toLowerCase() === wanted);
  return key ? headers[key] : undefined;
}

/* ------------------------------------------------------------------ *
 * browser API stubs
 * ------------------------------------------------------------------ */

export function createStorage(initial = {}) {
  // Like the real extension storage, values are serialized rather than shared
  // by reference. Without cloning, a page could mutate `settings` in place and
  // accidentally observe the change in storage before it is saved.
  function clone(value) {
    if (value === undefined) return value;
    try {
      return structuredClone(value);
    } catch (error) {
      return JSON.parse(JSON.stringify(value));
    }
  }

  const data = {};
  Object.keys(initial).forEach((key) => { data[key] = clone(initial[key]); });
  const listeners = [];

  function read(keys) {
    if (keys == null) return clone(data);
    if (typeof keys === 'string') return { [keys]: clone(data[keys]) };
    if (Array.isArray(keys)) {
      const out = {};
      keys.forEach((key) => { out[key] = clone(data[key]); });
      return out;
    }
    const out = Object.assign({}, keys);
    Object.keys(data).forEach((key) => {
      if (key in out) out[key] = clone(data[key]);
    });
    return out;
  }

  return {
    get data() { return data; },
    local: {
      get(keys, callback) {
        const value = read(keys);
        setTimeout(() => callback && callback(value), 0);
        return Promise.resolve(value);
      },
      set(items, callback) {
        const changes = {};
        Object.keys(items).forEach((key) => {
          changes[key] = { oldValue: clone(data[key]), newValue: clone(items[key]) };
          data[key] = clone(items[key]);
        });
        listeners.forEach((fn) => fn(changes, 'local'));
        setTimeout(() => callback && callback(), 0);
        return Promise.resolve();
      }
    },
    onChanged: {
      addListener(fn) { listeners.push(fn); },
      removeListener(fn) {
        const index = listeners.indexOf(fn);
        if (index >= 0) listeners.splice(index, 1);
      }
    }
  };
}

/**
 * Minimal `browser` namespace. `respond(message)` can return a response or a
 * promise; every outgoing message is kept in `sent` for assertions.
 */
export function createBrowserStub(options = {}) {
  const sent = [];
  const messageListeners = [];
  const settings = options.settings === undefined ? undefined : options.settings;
  const storage = createStorage(settings ? { settings } : {});
  const respond = options.respond || (() => ({ ok: true }));

  const runtime = {
    id: 'safari-translator-test',
    lastError: null,
    getURL(file) { return 'safari-web-extension://safari-translator/' + file; },
    sendMessage(message, callback) {
      sent.push(message);
      let answer;
      try {
        answer = respond(message);
      } catch (error) {
        answer = { ok: false, error: { code: 'unknown', message: error.message } };
      }
      const settle = (value) => setTimeout(() => callback && callback(value), 0);
      if (answer && typeof answer.then === 'function') {
        answer.then(settle, (error) => settle({ ok: false, error: { code: 'unknown', message: error.message } }));
        return answer;
      }
      settle(answer);
      return Promise.resolve(answer);
    },
    openOptionsPage() { options.onOpenOptions && options.onOpenOptions(); },
    onMessage: {
      addListener(fn) { messageListeners.push(fn); },
      removeListener(fn) {
        const index = messageListeners.indexOf(fn);
        if (index >= 0) messageListeners.splice(index, 1);
      }
    }
  };

  return {
    runtime,
    storage,
    sent,
    messageListeners,
    i18n: { getUILanguage: () => 'zh-CN' },
    emitMessage(message) {
      let response;
      messageListeners.slice().forEach((fn) => {
        fn(message, { id: 'test' }, (value) => { response = value; });
      });
      return response;
    }
  };
}

/* ------------------------------------------------------------------ *
 * jsdom document bootstrap
 * ------------------------------------------------------------------ */

const MEDIA_QUERY_LIST = {
  matches: false,
  media: '',
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return false; }
};

/**
 * Build a document, install the browser stub, then evaluate common.js and the
 * requested scripts in the window. Returns the jsdom window plus helpers.
 */
export function createPage(html, options = {}) {
  const { JSDOM } = loadJsdom();
  const dom = new JSDOM(
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' + (html || '') + '</body></html>',
    {
      url: options.url || 'https://example.com/article',
      runScripts: 'outside-only',
      pretendToBeVisual: true
    }
  );

  const window = dom.window;
  window.matchMedia = () => MEDIA_QUERY_LIST;
  if (!window.speechSynthesis) window.speechSynthesis = { cancel() {}, speak() {} };
  if (!window.SpeechSynthesisUtterance) {
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });

  const browser = options.browser || createBrowserStub(options);
  window.browser = browser;

  window.eval(read('common.js'));
  (options.scripts || []).forEach((file) => window.eval(read(file)));

  return { dom, window, browser };
}

/**
 * jsdom has no layout engine: give selection ranges a believable rectangle so
 * the floating button positions itself instead of falling back to (0, 0).
 */
export function stubRangeRect(window, rect = { left: 120, top: 140, right: 420, bottom: 170, width: 300, height: 30 }) {
  const proto = window.Range.prototype;
  proto.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top
  });
  proto.getClientRects = () => [proto.getBoundingClientRect()];
}

/** Select a DOM node's text and return the range. */
export function selectNodeText(window, node) {
  const range = window.document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

export async function bootContent(page) {
  await waitFor(() => page.window.__PT_CONTENT__, 2000, 'content script boot');
  return page.window.__PT_CONTENT__;
}
