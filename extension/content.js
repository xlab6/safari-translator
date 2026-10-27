/*
 * Safari Translator — content script.
 *
 * UX contract:
 *   - Pages are translated only when the user asks (popup, right-click menu,
 *     or selection button). No page is translated on load by default.
 *   - When a page is translated, its origin (site) is remembered. While that
 *     site has not been restored, same-site full navigations and SPA route
 *     changes are translated automatically so the reading state is preserved.
 *   - Restoring the original text on a page clears that site from the
 *     remembered set, so subsequent navigations stay in the original language.
 *   - Selecting text shows a small floating "翻译" button.
 *   - Right-click still offers explicit translate/restore actions.
 *   - Page translation inserts a bilingual copy (or replaces text) and can be
 *     reverted at any time.
 */
(function () {
  'use strict';

  var PT = window.PT;
  if (!PT) return;
  if (window.__PT_CONTENT_LOADED__) return;
  window.__PT_CONTENT_LOADED__ = true;

  var api = window.browser || window.chrome;
  if (!api || !api.runtime) return;

  var MAX_SELECTION = 5000;
  var MAX_BLOCKS = 400;
  var MAX_TEXT_NODES = 700;
  var BATCH_SIZE = 96;
  var BATCH_CHARS = 12000;
  var VIEWPORT_MARGIN = 240;
  var BACKGROUND_DELAY = 450;
  var AUTO_START_DELAY = 600;
  var AUTO_ROUTE_DEBOUNCE = 120;
  var AUTO_ROUTE_SETTLE = 150;
  var AUTO_ROUTE_MAX_WAIT = 1500;
  var AUTO_URL_POLL = 250;
  var FATAL_CODES = { auth: 1, config: 1, quota: 1, lang: 1 };

  var SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'code', 'pre', 'kbd', 'samp', 'var',
    'textarea', 'input', 'select', 'option', 'svg', 'math', 'canvas', 'iframe',
    'object', 'embed', 'audio', 'video', 'map', 'area',
    '[contenteditable]:not([contenteditable="false"])',
    '[data-pt-translation]', '[data-pt-ui]', '[aria-hidden="true"]', '[hidden]'
  ].join(',');

  var BLOCK_SELECTOR = [
    'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'figcaption', 'dd', 'dt', 'td', 'th', 'summary',
    'caption', 'div', 'section', 'article', 'main', 'aside', 'header',
    'footer', 'nav', 'figure', 'address'
  ].join(',');

  var state = {
    settings: null,
    host: null,
    shadow: null,
    layer: null,
    panel: null,
    button: null,
    selection: null,
    last: null,
    lastRect: null,
    anchor: null,
    anchorOffset: null,
    requestSeq: 0,
    toastTimer: null,
    auto: {
      timer: null,
      routeTimer: null,
      pollTimer: null,
      lastKey: null,
      initialized: false,
      listening: false,
      routeSeq: 0
    },
    translatedOrigins: new Set(),
    page: {
      status: 'idle', // idle | running | translated
      running: false,
      cancelled: false,
      runId: 0,
      mode: 'replace',
      target: null,
      added: [],
      originals: new Map(),
      applied: new Map(),
      blocks: new Map(),
      total: 0,
      done: 0,
      visible: 0,
      offscreen: 0,
      observer: null
    }
  };

  /* ------------------------------------------------------------------ *
   * Messaging
   * ------------------------------------------------------------------ */

  function responseError(response) {
    var info = (response && response.error) || {};
    var error = new Error(info.message || '翻译失败');
    error.code = info.code || 'unknown';
    error.hint = info.hint || '';
    error.provider = info.provider || '';
    return error;
  }

  function send(message, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        finish(null, Object.assign(new Error('翻译服务响应超时'), { code: 'timeout' }));
      }, timeoutMs || 45000);

      function finish(value, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      }

      var payload = Object.assign({ __pt: true }, message);
      var maybe;
      try {
        maybe = api.runtime.sendMessage(payload, function (response) {
          var lastError = api.runtime.lastError;
          if (lastError) {
            var error = new Error(lastError.message || String(lastError));
            error.code = /context invalidated|disconnected/i.test(error.message) ? 'network' : 'unknown';
            finish(null, error);
            return;
          }
          finish(response || { ok: false, error: { code: 'empty', message: '没有收到响应' } });
        });
      } catch (error) {
        finish(null, error);
        return;
      }

      if (maybe && typeof maybe.then === 'function') {
        maybe.then(
          function (value) { finish(value); },
          function (error) { finish(null, error); }
        );
      }
    });
  }

  function openOptions() {
    send({ type: 'open-options' }).catch(function () {
      if (api.runtime.openOptionsPage) {
        try { api.runtime.openOptionsPage(); } catch (e) { /* ignore */ }
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Shadow UI
   * ------------------------------------------------------------------ */

  var SHADOW_CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }

    .pt-layer {
      --pt-bg: #ffffff;
      --pt-bg-soft: #f5f6f8;
      --pt-bg-softer: #fafbfc;
      --pt-text: #15171c;
      --pt-muted: #6b7280;
      --pt-faint: #9aa1ad;
      --pt-border: rgba(17, 24, 39, .10);
      --pt-border-strong: rgba(17, 24, 39, .16);
      --pt-accent: #2f6bff;
      --pt-accent-soft: rgba(47, 107, 255, .10);
      --pt-danger: #d92d20;
      --pt-danger-soft: rgba(217, 45, 32, .08);
      --pt-ok: #12b76a;
      --pt-shadow: 0 16px 48px rgba(15, 23, 42, .18), 0 2px 8px rgba(15, 23, 42, .08);
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: var(--pt-text);
      -webkit-font-smoothing: antialiased;
      text-align: left;
    }

    .pt-layer[data-theme="dark"] {
      --pt-bg: #1c1f26;
      --pt-bg-soft: #262a33;
      --pt-bg-softer: #22262e;
      --pt-text: #f2f4f8;
      --pt-muted: #a3aab8;
      --pt-faint: #7c8494;
      --pt-border: rgba(255, 255, 255, .10);
      --pt-border-strong: rgba(255, 255, 255, .18);
      --pt-accent: #7aa2ff;
      --pt-accent-soft: rgba(122, 162, 255, .16);
      --pt-danger: #ff8b82;
      --pt-danger-soft: rgba(255, 139, 130, .12);
      --pt-ok: #4ade80;
      --pt-shadow: 0 18px 52px rgba(0, 0, 0, .55), 0 2px 10px rgba(0, 0, 0, .35);
    }

    button { font: inherit; color: inherit; margin: 0; }

    .pt-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 6px;
      background: linear-gradient(140deg, #2f6bff, #7c5cff);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0;
      flex: 0 0 auto;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .25);
    }

    .pt-sel-btn {
      position: fixed;
      display: none;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 11px 0 7px;
      border-radius: 9px;
      border: 1px solid var(--pt-border);
      background: var(--pt-bg);
      color: var(--pt-text);
      box-shadow: 0 6px 20px rgba(15, 23, 42, .20), 0 1px 3px rgba(15, 23, 42, .10);
      cursor: pointer;
      pointer-events: auto;
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: .2px;
      white-space: nowrap;
      transition: transform .12s ease, border-color .12s ease, color .12s ease;
      animation: pt-pop .14s ease-out;
    }
    .pt-sel-btn:hover { border-color: rgba(47, 107, 255, .55); color: var(--pt-accent); transform: translateY(-1px); }
    .pt-sel-btn:active { transform: translateY(0); }

    @keyframes pt-pop {
      from { opacity: 0; transform: translateY(3px) scale(.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .pt-panel {
      position: fixed;
      display: none;
      flex-direction: column;
      width: min(380px, calc(100vw - 20px));
      max-height: min(72vh, 560px);
      background: var(--pt-bg);
      border: 1px solid var(--pt-border);
      border-radius: 14px;
      box-shadow: var(--pt-shadow);
      pointer-events: auto;
      overflow: hidden;
      animation: pt-rise .16s cubic-bezier(.2, .8, .2, 1);
    }
    .pt-panel.pt-open { display: flex; }

    @keyframes pt-rise {
      from { opacity: 0; transform: translateY(6px) scale(.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .pt-head {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 8px 8px 8px 12px;
      border-bottom: 1px solid var(--pt-border);
      background: var(--pt-bg-softer);
      flex: 0 0 auto;
    }
    .pt-provider {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--pt-muted);
      letter-spacing: .2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 130px;
    }
    .pt-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--pt-faint);
      flex: 0 0 auto;
      transition: background .2s ease;
    }
    .pt-dot[data-state="ok"] { background: var(--pt-ok); }
    .pt-dot[data-state="error"] { background: var(--pt-danger); }
    .pt-spacer { flex: 1 1 auto; }

    .pt-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 27px;
      height: 27px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--pt-muted);
      cursor: pointer;
      pointer-events: auto;
      transition: background .12s ease, color .12s ease;
    }
    .pt-icon:hover { background: var(--pt-accent-soft); color: var(--pt-accent); }
    .pt-icon:disabled { opacity: .35; cursor: default; }
    .pt-icon:disabled:hover { background: transparent; color: var(--pt-muted); }
    .pt-icon svg { width: 15px; height: 15px; display: block; }

    .pt-body {
      padding: 12px 16px 13px;
      overflow: auto;
      overscroll-behavior: contain;
      flex: 1 1 auto;
    }

    .pt-original {
      margin: 0 0 10px;
      padding: 7px 10px;
      border-radius: 8px;
      background: var(--pt-bg-soft);
      color: var(--pt-muted);
      font-size: 12px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 7.2em;
      overflow: auto;
      user-select: text;
      -webkit-user-select: text;
    }

    .pt-result {
      margin: 0;
      font-size: 15px;
      line-height: 1.65;
      color: var(--pt-text);
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
      -webkit-user-select: text;
    }
    .pt-result[hidden] { display: none; }

    .pt-loading { display: flex; flex-direction: column; gap: 8px; padding: 3px 0 2px; }
    .pt-loading[hidden] { display: none; }
    .pt-loading i {
      display: block;
      height: 10px;
      border-radius: 5px;
      background: linear-gradient(90deg, var(--pt-bg-soft) 25%, var(--pt-border) 37%, var(--pt-bg-soft) 63%);
      background-size: 400% 100%;
      animation: pt-shimmer 1.25s ease infinite;
    }
    .pt-loading i:nth-child(1) { width: 100%; }
    .pt-loading i:nth-child(2) { width: 88%; }
    .pt-loading i:nth-child(3) { width: 62%; }

    @keyframes pt-shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: 0 0; }
    }

    .pt-error { display: block; }
    .pt-error[hidden] { display: none; }
    .pt-error-title {
      font-size: 13.5px;
      font-weight: 650;
      color: var(--pt-text);
      margin-bottom: 3px;
    }
    .pt-error-msg {
      font-size: 12.5px;
      line-height: 1.55;
      color: var(--pt-danger);
      word-break: break-word;
    }
    .pt-error-hint {
      margin-top: 5px;
      font-size: 12px;
      line-height: 1.55;
      color: var(--pt-muted);
    }
    .pt-error-actions { display: flex; gap: 8px; margin-top: 10px; }

    .pt-btn {
      appearance: none;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 5px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      pointer-events: auto;
      background: var(--pt-accent);
      color: #fff;
      transition: filter .12s ease;
    }
    .pt-btn:hover { filter: brightness(1.06); }
    .pt-btn-ghost {
      background: transparent;
      color: var(--pt-muted);
      border-color: var(--pt-border-strong);
    }
    .pt-btn-ghost:hover { color: var(--pt-text); background: var(--pt-bg-soft); }

    .pt-foot {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px 7px 14px;
      border-top: 1px solid var(--pt-border);
      background: var(--pt-bg-softer);
      flex: 0 0 auto;
    }
    .pt-langs {
      font-size: 11px;
      color: var(--pt-faint);
      letter-spacing: .15px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pt-select {
      appearance: none;
      -webkit-appearance: none;
      border: 1px solid transparent;
      background: var(--pt-bg-soft);
      color: var(--pt-muted);
      border-radius: 6px;
      padding: 3px 20px 3px 7px;
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      pointer-events: auto;
      outline: none;
      background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23838b99' stroke-width='1.3' stroke-linecap='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 6px center;
    }
    .pt-select:hover { color: var(--pt-text); border-color: var(--pt-border); }
    .pt-select option { color: #15171c; background: #fff; }

    .pt-toast {
      position: fixed;
      left: 50%;
      bottom: 26px;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: min(480px, calc(100vw - 32px));
      padding: 9px 12px 9px 14px;
      border-radius: 10px;
      background: #14161b;
      color: #f5f6f8;
      box-shadow: 0 10px 32px rgba(0, 0, 0, .35);
      font-size: 12.5px;
      line-height: 1.45;
      pointer-events: auto;
      animation: pt-toast-in .18s ease-out;
    }
    .pt-layer[data-theme="dark"] .pt-toast { background: #f2f4f8; color: #15171c; }
    .pt-toast[hidden] { display: none; }
    .pt-toast span { word-break: break-word; }
    .pt-toast button {
      flex: 0 0 auto;
      border: 0;
      background: transparent;
      color: #8fb1ff;
      font-weight: 650;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 2px;
      pointer-events: auto;
    }
    .pt-layer[data-theme="dark"] .pt-toast button { color: #2f6bff; }
    .pt-toast button[hidden] { display: none; }

    @keyframes pt-toast-in {
      from { opacity: 0; transform: translate(-50%, 6px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }

    .pt-progress {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 76px;
      height: 76px;
      pointer-events: auto;
      animation: pt-pop .18s cubic-bezier(.2, .8, .2, 1);
    }
    .pt-progress[hidden] { display: none; }

    .pt-hud {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: 1px solid var(--pt-border);
      background: var(--pt-bg);
      box-shadow: var(--pt-shadow);
    }
    .pt-ring {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }
    .pt-ring circle { fill: none; stroke-width: 4; }
    .pt-ring-bg { stroke: var(--pt-bg-soft); }
    .pt-ring-fill {
      stroke: var(--pt-accent);
      stroke-linecap: round;
      stroke-dasharray: 282.743;
      stroke-dashoffset: 282.743;
      transition: stroke-dashoffset .3s ease;
    }

    .pt-hud-center {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
      padding: 0 7px;
      text-align: center;
    }
    .pt-percent {
      font-size: 15px;
      font-weight: 650;
      line-height: 1.1;
      letter-spacing: -.2px;
      color: var(--pt-text);
      font-variant-numeric: tabular-nums;
    }
    .pt-progress-title {
      font-size: 8.5px;
      font-weight: 600;
      line-height: 1.2;
      color: var(--pt-muted);
      white-space: nowrap;
    }
    .pt-progress-count {
      font-size: 8px;
      line-height: 1.15;
      color: var(--pt-faint);
      font-variant-numeric: tabular-nums;
    }
    .pt-progress-note {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .pt-progress-cancel {
      position: absolute;
      top: -2px;
      right: -2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border-radius: 50%;
      border: 1px solid var(--pt-border);
      background: var(--pt-bg);
      color: var(--pt-faint);
      box-shadow: 0 2px 8px rgba(15, 23, 42, .16);
      cursor: pointer;
      pointer-events: auto;
      transition: color .12s ease, border-color .12s ease, opacity .12s ease;
    }
    .pt-progress-cancel svg { width: 8px; height: 8px; display: block; }
    .pt-progress-cancel:hover { color: var(--pt-danger); border-color: rgba(217, 45, 32, .35); }
    .pt-progress-cancel:disabled { opacity: .4; cursor: default; }

    @media (prefers-reduced-motion: reduce) {
      .pt-panel, .pt-sel-btn, .pt-toast, .pt-progress { animation: none; }
      .pt-loading i { animation: none; }
      .pt-ring-fill { transition: none; }
    }
  `;

  var ICONS = {
    speak:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 8.5H4v7h2.5L11 19V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a2 2 0 0 0-2 2v9"/></svg>',
    settings:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>'
  };

  function createUI() {
    var host = document.createElement('div');
    host.setAttribute('data-pt-ui', '');
    host.style.cssText =
      'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';

    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' + SHADOW_CSS + '</style>' +
      '<div class="pt-layer" data-theme="light" data-pt-ui="">' +
        '<button class="pt-sel-btn" type="button" data-role="selection" aria-label="翻译所选文字">' +
          '<span class="pt-logo">文</span><span>翻译</span>' +
        '</button>' +

        '<section class="pt-panel" data-role="panel" role="dialog" aria-label="翻译结果" aria-live="polite">' +
          '<header class="pt-head">' +
            '<span class="pt-logo">文</span>' +
            '<span class="pt-provider" data-role="provider">Safari Translator</span>' +
            '<span class="pt-dot" data-role="status-dot"></span>' +
            '<span class="pt-spacer"></span>' +
            '<button class="pt-icon" type="button" data-action="speak" title="朗读译文" aria-label="朗读译文" disabled>' + ICONS.speak + '</button>' +
            '<button class="pt-icon" type="button" data-action="copy" title="复制译文" aria-label="复制译文" disabled>' + ICONS.copy + '</button>' +
            '<button class="pt-icon" type="button" data-action="settings" title="翻译设置" aria-label="翻译设置">' + ICONS.settings + '</button>' +
            '<button class="pt-icon" type="button" data-action="close" title="关闭" aria-label="关闭">' + ICONS.close + '</button>' +
          '</header>' +
          '<div class="pt-body">' +
            '<p class="pt-original" data-role="original"></p>' +
            '<div class="pt-loading" data-role="loading" hidden><i></i><i></i><i></i></div>' +
            '<div class="pt-result" data-role="result" hidden></div>' +
            '<div class="pt-error" data-role="error" hidden>' +
              '<div class="pt-error-title" data-role="error-title"></div>' +
              '<div class="pt-error-msg" data-role="error-message"></div>' +
              '<div class="pt-error-hint" data-role="error-hint"></div>' +
              '<div class="pt-error-actions">' +
                '<button class="pt-btn" type="button" data-action="retry">重试</button>' +
                '<button class="pt-btn pt-btn-ghost" type="button" data-action="settings">打开设置</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<footer class="pt-foot">' +
            '<span class="pt-langs" data-role="langs"></span>' +
            '<span class="pt-spacer"></span>' +
            '<select class="pt-select" data-role="target" aria-label="目标语言"></select>' +
          '</footer>' +
        '</section>' +

        '<div class="pt-toast" data-role="toast" hidden>' +
          '<span data-role="toast-text"></span>' +
          '<button type="button" data-role="toast-action" hidden></button>' +
        '</div>' +

        '<section class="pt-progress" data-role="progress" hidden aria-label="页面翻译进度">' +
          '<div class="pt-hud">' +
            '<svg class="pt-ring" viewBox="0 0 100 100" aria-hidden="true">' +
              '<circle class="pt-ring-bg" cx="50" cy="50" r="45"></circle>' +
              '<circle class="pt-ring-fill" cx="50" cy="50" r="45" data-role="ring"></circle>' +
            '</svg>' +
            '<div class="pt-hud-center">' +
              '<span class="pt-percent" data-role="percent">0%</span>' +
              '<span class="pt-progress-title" data-role="progress-title">正在翻译</span>' +
              '<span class="pt-progress-count" data-role="progress-count">0 / 0</span>' +
              '<span class="pt-progress-note" data-role="progress-note"></span>' +
            '</div>' +
            '<button type="button" class="pt-progress-cancel" data-action="cancel" title="取消翻译" aria-label="取消翻译">' + ICONS.close + '</button>' +
          '</div>' +
        '</section>' +
      '</div>';

    document.documentElement.appendChild(host);

    state.host = host;
    state.shadow = shadow;
    state.layer = shadow.querySelector('.pt-layer');
    state.panel = shadow.querySelector('[data-role="panel"]');
    state.button = shadow.querySelector('[data-role="selection"]');

    bindUI();
    populateLanguages();
    applyTheme();
    updateProviderLabel();
  }

  function q(role) {
    return state.shadow.querySelector('[data-role="' + role + '"]');
  }

  function populateLanguages() {
    var select = q('target');
    select.textContent = '';
    PT.LANGUAGES.forEach(function (lang) {
      var option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.zh;
      select.appendChild(option);
    });
  }

  function applyTheme() {
    if (!state.layer) return;
    var theme = (state.settings && state.settings.theme) || 'auto';
    var dark = theme === 'dark';
    if (theme === 'auto' && window.matchMedia) {
      try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { dark = false; }
    }
    state.layer.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  function updateProviderLabel() {
    if (!state.settings) return;
    var provider = PT.providerName(state.settings.provider);
    q('provider').textContent = provider;
  }

  function syncTargetSelect() {
    if (!state.settings) return;
    var select = q('target');
    select.value = state.settings.targetLang;
    if (!select.value) {
      select.value = PT.defaultTarget();
    }
  }

  // Safari does not always deliver storage.onChanged to content scripts in
  // tabs that were already open. Read the stored settings before an explicit
  // action so a provider switch made in the options page always applies.
  async function refreshSettings() {
    try {
      state.settings = await PT.loadSettings();
    } catch (error) {
      if (!state.settings) state.settings = PT.defaultSettings();
    }
    updateProviderLabel();
    syncTargetSelect();
    applyTheme();
    return state.settings;
  }

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */

  function showToast(message, actionLabel, action) {
    var toast = q('toast');
    q('toast-text').textContent = message;
    var button = q('toast-action');
    button.hidden = !actionLabel;
    button.textContent = actionLabel || '';
    button.onclick = action
      ? function () {
          hideToast();
          action();
        }
      : null;

    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 3200);
  }

  function hideToast() {
    clearTimeout(state.toastTimer);
    var toast = q('toast');
    if (toast) toast.hidden = true;
  }

  /* ------------------------------------------------------------------ *
   * Panel rendering
   * ------------------------------------------------------------------ */

  var ERROR_TITLES = {
    auth: '密钥无效或权限不足',
    quota: '额度不足或请求过于频繁',
    network: '网络无法连接',
    timeout: '请求超时',
    config: '需要先完成设置',
    lang: '不支持的语言组合',
    server: '翻译服务暂时不可用',
    request: '请求被拒绝',
    empty: '没有可翻译的内容'
  };

  function positionPanel(rect) {
    var panel = state.panel;
    panel.classList.add('pt-open');

    var gap = 8;
    var width = panel.offsetWidth || 360;
    var height = panel.offsetHeight || 240;
    var viewportW = window.innerWidth || 1024;
    var viewportH = window.innerHeight || 768;
    var box = rect || { left: viewportW / 2, top: viewportH / 2, bottom: viewportH / 2, right: viewportW / 2 };

    var left = Math.min(Math.max(8, box.left), Math.max(8, viewportW - width - 8));
    var top = box.bottom + gap;

    if (top + height > viewportH - 8) {
      var above = box.top - height - gap;
      top = above >= 8 ? above : Math.max(8, viewportH - height - 8);
    }
    if (top < 8) top = 8;

    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  }

  function openPanel(rect, original) {
    q('original').textContent = original || '';
    q('provider').textContent = state.settings ? PT.providerName(state.settings.provider) : 'Safari Translator';
    q('status-dot').removeAttribute('data-state');
    q('result').textContent = '';
    q('result').hidden = true;
    q('loading').hidden = true;
    q('error').hidden = true;
    q('langs').textContent = PT.languageName('auto') + ' → ' + PT.languageName(state.settings ? state.settings.targetLang : PT.defaultTarget());
    setActionsEnabled(false);
    positionPanel(rect);
    state.anchorOffset = state.anchor ? {
      left: (parseFloat(state.panel.style.left) || 0) - ((rect && rect.left) || 0),
      top: (parseFloat(state.panel.style.top) || 0) - ((rect && rect.top) || 0)
    } : null;
    syncTargetSelect();
  }

  function setActionsEnabled(enabled) {
    ['speak', 'copy'].forEach(function (name) {
      var button = state.panel.querySelector('[data-action="' + name + '"]');
      if (button) button.disabled = !enabled;
    });
  }

  function showLoading() {
    q('original').hidden = false;
    q('result').hidden = true;
    q('error').hidden = true;
    q('loading').hidden = false;
    q('status-dot').removeAttribute('data-state');
    setActionsEnabled(false);
  }

  function showResult(result, original, target) {
    var text = result.text || '';
    q('loading').hidden = true;
    q('error').hidden = true;
    q('result').hidden = false;
    q('result').textContent = text;

    var detected = result.detected || '';
    q('langs').textContent =
      (detected ? PT.languageName(detected) : PT.languageName('auto')) +
      ' → ' + PT.languageName(target);
    q('provider').textContent = PT.providerName(result.provider || (state.settings && state.settings.provider));
    q('status-dot').setAttribute('data-state', 'ok');
    setActionsEnabled(true);

    state.last = {
      original: original,
      text: text,
      detected: detected,
      target: target,
      provider: result.provider || (state.settings && state.settings.provider)
    };
  }

  function showError(error, original, target) {
    var code = (error && error.code) || 'unknown';
    q('loading').hidden = true;
    q('result').hidden = true;
    q('error').hidden = false;
    q('error-title').textContent = ERROR_TITLES[code] || '翻译失败';
    q('error-message').textContent = (error && error.message) || '翻译失败，请稍后重试。';
    q('error-hint').textContent = (error && error.hint) || PT.errorHints[code] || '';
    q('status-dot').setAttribute('data-state', 'error');
    q('langs').textContent = PT.languageName(original ? PT.detectLanguage(original) : 'auto') + ' → ' + PT.languageName(target);
    setActionsEnabled(false);

    state.last = {
      original: original,
      text: '',
      detected: '',
      target: target,
      provider: state.settings && state.settings.provider
    };
  }

  function closePanel() {
    state.requestSeq++;
    state.panel.classList.remove('pt-open');
    state.last = null;
    state.anchor = null;
    state.anchorOffset = null;
    cancelSpeech();
  }

  /* ------------------------------------------------------------------ *
   * Speech / clipboard
   * ------------------------------------------------------------------ */

  var speaking = false;

  function cancelSpeech() {
    if (!speaking) return;
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) { /* ignore */ }
    speaking = false;
  }

  function speak(text, lang) {
    if (!text) return;
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') {
      showToast('当前浏览器不支持朗读');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      var utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = speechLang(lang);
      utterance.rate = 1;
      utterance.onend = function () { speaking = false; };
      utterance.onerror = function () { speaking = false; };
      speaking = true;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      showToast('朗读失败');
    }
  }

  function speechLang(code) {
    var base = PT.baseLang(code);
    if (base === 'zh') return code === 'zh-TW' ? 'zh-TW' : 'zh-CN';
    return code || 'en';
  }

  /* ------------------------------------------------------------------ *
   * Selection handling
   * ------------------------------------------------------------------ */

  function isEventInsideUI(event) {
    var path = event.composedPath ? event.composedPath() : [];
    return path.indexOf(state.host) !== -1 || path.indexOf(state.shadow) !== -1;
  }

  function nodeInsideUI(node) {
    if (!node) return false;
    try {
      return node.getRootNode ? node.getRootNode() === state.shadow : false;
    } catch (e) {
      return false;
    }
  }

  function readSelection() {
    var selection = window.getSelection && window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    var text = selection.toString()
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!text) return null;

    var range = selection.getRangeAt(0);
    if (nodeInsideUI(range.commonAncestorContainer)) return null;

    var rect = null;
    if (range.getBoundingClientRect) {
      try { rect = range.getBoundingClientRect(); } catch (e) { rect = null; }
    }
    if ((!rect || (!rect.width && !rect.height)) && range.getClientRects) {
      try {
        var rects = range.getClientRects();
        if (rects && rects.length) rect = rects[rects.length - 1];
      } catch (e) { /* ignore */ }
    }
    if (!rect || (!rect.width && !rect.height)) {
      var point = state.lastPoint || { x: (window.innerWidth || 0) / 2, y: (window.innerHeight || 0) / 2 };
      rect = { left: point.x, top: point.y, right: point.x, bottom: point.y, width: 0, height: 0 };
    }

    return {
      text: text,
      rect: {
        left: Number(rect.left) || 0,
        top: Number(rect.top) || 0,
        right: Number(rect.right) || Number(rect.left) || 0,
        bottom: Number(rect.bottom) || Number(rect.top) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0
      }
    };
  }

  function liveSelectionRange() {
    var selection = window.getSelection && window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    try {
      var range = selection.getRangeAt(0);
      if (nodeInsideUI(range.commonAncestorContainer)) return null;
      return range.cloneRange();
    } catch (e) {
      return null;
    }
  }

  function rangeRect(range) {
    if (!range) return null;
    try {
      if (range.startContainer && range.startContainer.isConnected === false) return null;
      var rect = null;
      if (range.getBoundingClientRect) rect = range.getBoundingClientRect();
      if ((!rect || (!rect.width && !rect.height)) && range.getClientRects) {
        var rects = range.getClientRects();
        if (rects && rects.length) rect = rects[rects.length - 1];
      }
      if (!rect) return null;
      return {
        left: Number(rect.left) || 0,
        top: Number(rect.top) || 0,
        right: Number(rect.right) || Number(rect.left) || 0,
        bottom: Number(rect.bottom) || Number(rect.top) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0
      };
    } catch (e) {
      return null;
    }
  }

  function showSelectionButton(selection) {
    if (!state.settings || state.settings.selectionButton === false) return;
    if (!selection || !selection.text) return;
    if (selection.text.length > MAX_SELECTION) {
      hideSelectionButton();
      return;
    }

    state.selection = selection;

    var button = state.button;
    button.style.display = 'flex';

    var width = button.offsetWidth || 76;
    var height = button.offsetHeight || 32;
    var viewportW = window.innerWidth || 1024;
    var viewportH = window.innerHeight || 768;
    var rect = selection.rect;

    var left = rect.left;
    var top = rect.bottom + 6;
    if (left + width > viewportW - 8) left = viewportW - width - 8;
    if (left < 8) left = 8;
    if (top + height > viewportH - 8) top = Math.max(8, rect.top - height - 6);

    button.style.left = Math.round(left) + 'px';
    button.style.top = Math.round(top) + 'px';
  }

  function hideSelectionButton() {
    if (state.button) state.button.style.display = 'none';
  }

  var anchorFrame = 0;

  // The panel is fixed to the viewport, so it has to be moved by hand to stay
  // next to the selected text while the page scrolls.
  function followSelectionAnchor() {
    var panel = state.panel;
    if (!panel || !panel.classList.contains('pt-open') || !state.anchor || !state.anchorOffset) return;
    var rect = rangeRect(state.anchor);
    if (!rect) {
      state.anchor = null;
      state.anchorOffset = null;
      return;
    }
    state.lastRect = rect;
    panel.style.left = Math.round(rect.left + state.anchorOffset.left) + 'px';
    panel.style.top = Math.round(rect.top + state.anchorOffset.top) + 'px';
  }

  function scheduleFollow() {
    if (anchorFrame) return;
    var run = function () {
      anchorFrame = 0;
      followSelectionAnchor();
    };
    anchorFrame = window.requestAnimationFrame ? window.requestAnimationFrame(run) : setTimeout(run, 16);
  }

  function dismissSelectionUI() {
    hideSelectionButton();
    if (state.panel && state.panel.classList.contains('pt-open')) closePanel();
  }

  function onMouseUp(event) {
    if (event.button !== 0) return;
    if (isEventInsideUI(event)) return;

    state.lastPoint = { x: event.clientX, y: event.clientY };

    setTimeout(function () {
      var selection = readSelection();
      if (selection) showSelectionButton(selection);
      else hideSelectionButton();
    }, 10);
  }

  function onMouseDown(event) {
    state.lastPoint = { x: event.clientX, y: event.clientY };
    if (isEventInsideUI(event)) return;
    dismissSelectionUI();
  }

  function onKeyUp(event) {
    if (!event.shiftKey && !/^(Arrow|Home|End|Page)/.test(event.key || '')) return;
    setTimeout(function () {
      var selection = readSelection();
      if (selection) {
        state.lastPoint = state.lastPoint || { x: selection.rect.left, y: selection.rect.bottom };
        showSelectionButton(selection);
      }
    }, 60);
  }

  function pointRect() {
    var point = state.lastPoint || {
      x: (window.innerWidth || 1024) / 2,
      y: (window.innerHeight || 768) / 2
    };
    return { left: point.x, top: point.y, right: point.x, bottom: point.y, width: 0, height: 0 };
  }

  async function translateSelection(text, rect) {
    var value = String(text || '').trim();
    if (!value) {
      showToast('没有选中文字');
      return;
    }
    if (value.length > MAX_SELECTION) {
      showToast('选中的内容过长，请分段翻译');
      return;
    }
    await refreshSettings();

    var selection = { text: value, rect: rect || pointRect() };
    state.selection = selection;
    state.lastRect = selection.rect;
    hideSelectionButton();

    var seq = ++state.requestSeq;
    openPanel(selection.rect, value);
    showLoading();

    try {
      var from = state.settings.sourceLang;
      var response = await send({
        type: 'translate',
        text: value,
        from: from,
        to: state.settings.targetLang
      }, 60000);

      if (seq !== state.requestSeq) return;
      if (!response || !response.ok) throw responseError(response);

      showResult(response, value, state.settings.targetLang);
      if (response.detected && from === 'auto') {
        // Keep the panel language pair accurate after detection.
        q('langs').textContent = PT.languageName(response.detected) + ' → ' + PT.languageName(state.settings.targetLang);
      }
    } catch (error) {
      if (seq !== state.requestSeq) return;
      showError(error, value, state.settings.targetLang);
    }
  }

  function retryLast() {
    if (!state.last || !state.last.original) return;
    translateSelection(state.last.original, state.lastRect || state.selection && state.selection.rect);
  }

  /* ------------------------------------------------------------------ *
   * Page translation — collection
   * ------------------------------------------------------------------ */

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    try {
      var style = window.getComputedStyle(element);
      if (!style) return true;
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (style.opacity === '0' || style.opacity === 0) return false;
    } catch (e) { /* ignore */ }
    return true;
  }

  function normalizeBlockText(element) {
    var clone = element.cloneNode(true);
    if (clone.querySelectorAll) {
      clone.querySelectorAll('br').forEach(function (br) {
        br.replaceWith(document.createTextNode(' '));
      });
      clone.querySelectorAll(BLOCK_SELECTOR).forEach(function (node) { node.remove(); });
      clone.querySelectorAll(SKIP_SELECTOR).forEach(function (node) { node.remove(); });
    }
    return PT.normalizeText(clone.textContent || '');
  }

  function directTranslation(element) {
    for (var child = element.firstElementChild; child; child = child.nextElementSibling) {
      if (child.hasAttribute && child.hasAttribute('data-pt-translation')) return child;
    }
    return null;
  }

  function collectBlocks(targetLang) {
    if (!document.body) return [];
    var units = [];
    var seen = new Set();
    var elements = document.body.querySelectorAll(BLOCK_SELECTOR);

    for (var i = 0; i < elements.length && units.length < MAX_BLOCKS; i++) {
      var element = elements[i];
      if (seen.has(element)) continue;
      seen.add(element);
      if (element.closest(SKIP_SELECTOR)) continue;
      if (!isVisible(element)) continue;

      var text = normalizeBlockText(element);
      if (!text || text.length > 5000) continue;
      if (!PT.shouldTranslate(text, targetLang)) continue;

      // Content that a previous route already translated stays untouched.
      // If the site re-rendered the block with different text, it is
      // collected again and the stale translation is replaced on apply.
      if (directTranslation(element) && state.page.blocks.get(element) === text) continue;

      units.push({ element: element, text: text });
    }

    return units;
  }

  function collectTextNodes(targetLang) {
    if (!document.body) return [];
    var units = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var node;

    while ((node = walker.nextNode()) && units.length < MAX_TEXT_NODES) {
      var parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest(SKIP_SELECTOR)) continue;
      if (!isVisible(parent)) continue;

      var text = PT.normalizeText(node.nodeValue);
      if (!PT.shouldTranslate(text, targetLang)) continue;

      if (state.page.originals.has(node)) {
        // Still our own translation: nothing to do. A different value means
        // the site replaced the text in place, so translate the new value.
        if (state.page.applied.get(node) === node.nodeValue) continue;
        state.page.originals.delete(node);
        state.page.applied.delete(node);
      }

      units.push({
        node: node,
        text: text,
        original: node.nodeValue
      });
    }

    return units;
  }

  function unitElement(unit) {
    if (unit.element) return unit.element;
    return unit.node && unit.node.parentElement;
  }

  function unitRect(unit) {
    // In replace mode the unit is a text node, which can sit inside a very
    // tall container. A Range gives the text's own position, not the whole
    // container's.
    if (unit.node && unit.node.nodeType === 3 && document.createRange) {
      try {
        var range = document.createRange();
        range.selectNodeContents(unit.node);
        if (typeof range.getBoundingClientRect === 'function') {
          var textRect = range.getBoundingClientRect();
          if (textRect && (textRect.width || textRect.height || textRect.top || textRect.bottom)) {
            return textRect;
          }
        }
      } catch (e) { /* fall back to the parent element */ }
    }

    var element = unitElement(unit);
    if (!element || !element.getBoundingClientRect) return null;
    try {
      return element.getBoundingClientRect();
    } catch (e) {
      return null;
    }
  }

  function isInViewport(unit) {
    var rect = unitRect(unit);
    if (!rect) return true;

    // jsdom and detached nodes report an all-zero rect. Keep those in the
    // first pass instead of stranding them in the background queue.
    if (!rect.width && !rect.height && !rect.top && !rect.bottom) return true;

    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!viewportHeight) return true;
    return rect.bottom >= -VIEWPORT_MARGIN && rect.top <= viewportHeight + VIEWPORT_MARGIN;
  }

  function createQueue() {
    return { items: [], cursor: 0 };
  }

  function nextFromQueue(queue, wantedState) {
    while (queue.cursor < queue.items.length) {
      var unit = queue.items[queue.cursor];
      if (unit.state === wantedState) return { unit: unit, queue: queue };
      queue.cursor++;
    }
    return null;
  }

  function hasPending(queue, wantedState) {
    for (var i = queue.cursor; i < queue.items.length; i++) {
      if (queue.items[i].state === wantedState) return true;
    }
    return false;
  }

  function takeBatch(visibleQueue, nearQueue, offscreenQueue, allowOffscreen) {
    var batch = [];
    var chars = 0;

    while (batch.length < BATCH_SIZE) {
      var found = nextFromQueue(visibleQueue, 'visible');
      if (!found) found = nextFromQueue(nearQueue, 'near');
      if (!found && allowOffscreen) found = nextFromQueue(offscreenQueue, 'pending');
      if (!found) break;

      // Keep the existing batch limits, but never split a single long unit.
      if (batch.length && chars + found.unit.text.length > BATCH_CHARS) break;

      found.queue.cursor += 1;
      found.unit.state = 'sending';
      batch.push(found.unit);
      chars += found.unit.text.length;
    }

    return batch;
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function stopVisibilityObserver(page) {
    if (!page.observer) return;
    try { page.observer.disconnect(); } catch (e) { /* ignore */ }
    page.observer = null;
  }

  function startVisibilityObserver(units, nearQueue, offscreenQueue, runId) {
    var Observer = window.IntersectionObserver;
    if (typeof Observer !== 'function' || !units.length) return null;

    var elements = new Map();
    var observer;

    try {
      observer = new Observer(function (entries) {
        if (state.page.runId !== runId) return;
        entries.forEach(function (entry) {
          var group = elements.get(entry.target);
          if (!group) return;

          group.forEach(function (unit) {
            if (entry.isIntersecting) {
              // A unit already sent, or already promoted by another callback,
              // is left alone; this keeps the queues free of duplicates.
              if (unit.state !== 'pending') return;
              unit.state = 'near';
              nearQueue.items.push(unit);
              return;
            }

            // If the reader scrolls away before an initially visible unit is
            // sent, demote it so text they can actually see goes first.
            if (unit.state === 'visible') {
              unit.state = 'pending';
              offscreenQueue.items.push(unit);
            }
          });
        });
      }, {
        root: null,
        rootMargin: VIEWPORT_MARGIN + 'px 0px ' + VIEWPORT_MARGIN + 'px 0px',
        threshold: 0
      });
    } catch (e) {
      return null;
    }

    units.forEach(function (unit) {
      var element = unitElement(unit);
      if (!element) return;
      var group = elements.get(element);
      if (!group) {
        group = [];
        elements.set(element, group);
        try { observer.observe(element); } catch (e) { /* ignore */ }
      }
      group.push(unit);
    });

    return observer;
  }

  /* ------------------------------------------------------------------ *
   * Page translation — apply / restore
   * ------------------------------------------------------------------ */

  function dropAdded(span) {
    var index = state.page.added.indexOf(span);
    if (index >= 0) state.page.added.splice(index, 1);
  }

  function applyBlockTranslation(unit, translated, targetLang) {
    var element = unit.element;
    if (!element || !element.isConnected) return false;

    // A block whose text changed in place may still carry its old translation.
    var stale = directTranslation(element);
    while (stale) {
      dropAdded(stale);
      stale.remove();
      stale = directTranslation(element);
    }

    var span = document.createElement('span');
    span.setAttribute('data-pt-translation', '');
    span.setAttribute('lang', targetLang);
    span.setAttribute('dir', 'auto');
    span.style.cssText =
      'display:block;margin:.35em 0 0;padding:0 0 0 .65em;border-left:2px solid rgba(47,107,255,.55);' +
      'font:inherit;font-size:.94em;line-height:inherit;color:inherit;white-space:pre-wrap;' +
      'word-break:break-word;opacity:.94;';
    span.textContent = translated;

    element.appendChild(span);
    state.page.added.push(span);
    state.page.blocks.set(element, unit.text);
    return true;
  }

  function applyTextTranslation(unit, translated) {
    var node = unit.node;
    if (!node || !node.isConnected) return false;

    var raw = unit.original;
    var lead = (raw.match(/^\s*/) || [''])[0];
    var trail = (raw.match(/\s*$/) || [''])[0];
    node.nodeValue = lead + translated + trail;
    state.page.originals.set(node, raw);
    state.page.applied.set(node, node.nodeValue);
    return true;
  }

  var RING_LENGTH = 2 * Math.PI * 45;

  function updateProgress(done, total, note) {
    var percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    var ring = q('ring');
    if (ring) ring.style.strokeDashoffset = String(RING_LENGTH * (1 - percent / 100));
    var percentEl = q('percent');
    if (percentEl) percentEl.textContent = percent + '%';
    var count = q('progress-count');
    if (count) count.textContent = done + ' / ' + total;
    var noteEl = q('progress-note');
    if (noteEl) noteEl.textContent = note || '';
    var progress = q('progress');
    if (progress) progress.title = note || '';
  }

  function showProgress(total, note) {
    var progress = q('progress');
    progress.hidden = false;
    q('progress-title').textContent = '正在翻译';
    var cancel = progress.querySelector('[data-action="cancel"]');
    if (cancel) {
      cancel.disabled = false;
      cancel.setAttribute('title', '取消翻译');
      cancel.setAttribute('aria-label', '取消翻译');
    }
    updateProgress(0, total, note || '');
  }

  function hideProgress() {
    var progress = q('progress');
    if (progress) progress.hidden = true;
  }

  function finishProgress(runId, delay) {
    setTimeout(function () {
      if (state.page.runId === runId) hideProgress();
    }, typeof delay === 'number' ? delay : 1200);
  }

  /* ------------------------------------------------------------------ *
   * Automatic page translation
   * ------------------------------------------------------------------ */

  function currentOrigin() {
    return location.origin || location.protocol + '//' + location.hostname;
  }

  async function loadTranslatedOrigins() {
    try {
      var stored = await PT.storageGet('ptTranslatedOrigins');
      var list = stored && stored.ptTranslatedOrigins;
      state.translatedOrigins = new Set(Array.isArray(list) ? list : []);
    } catch (error) {
      state.translatedOrigins = new Set();
    }
  }

  function rememberTranslatedOrigin() {
    var origin = currentOrigin();
    state.translatedOrigins.add(origin);
    PT.storageSet({ ptTranslatedOrigins: Array.from(state.translatedOrigins) }).catch(function () {});
    startNavigationWatcher();
  }

  function forgetTranslatedOrigin() {
    var origin = currentOrigin();
    state.translatedOrigins.delete(origin);
    PT.storageSet({ ptTranslatedOrigins: Array.from(state.translatedOrigins) }).catch(function () {});
    if (!state.translatedOrigins.has(origin) && state.auto.pollTimer) {
      clearInterval(state.auto.pollTimer);
      state.auto.pollTimer = null;
    }
  }

  function isAutoEligible() {
    if (window.top !== window) return false;
    var protocol = location.protocol;
    if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'file:') return false;
    if (!state.translatedOrigins.has(currentOrigin())) return false;
    return !!document.body;
  }

  function navigationKey() {
    return String(location.href).split('#')[0];
  }

  function whenDocumentReady(callback) {
    var called = false;
    function run() {
      if (called) return;
      called = true;
      callback();
    }

    if (document.readyState === 'complete') {
      setTimeout(run, 0);
      return;
    }

    window.addEventListener('load', run, { once: true });

    // A slow advert or a stalled request should not block translation forever.
    function fallback() {
      setTimeout(run, 3000);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fallback, { once: true });
    } else {
      fallback();
    }
  }

  function scheduleAutoStart(delay) {
    if (!isAutoEligible()) return;
    if (state.auto.timer) clearTimeout(state.auto.timer);
    state.auto.timer = setTimeout(function () {
      state.auto.timer = null;
      autoTranslateNow();
    }, typeof delay === 'number' ? delay : AUTO_START_DELAY);
  }

  function prunePageState() {
    var page = state.page;
    page.added = page.added.filter(function (span) {
      return span && span.isConnected;
    });
    page.originals.forEach(function (original, node) {
      if (node && node.isConnected) return;
      page.originals.delete(node);
      page.applied.delete(node);
    });
    page.blocks.forEach(function (source, element) {
      if (element && element.isConnected) return;
      page.blocks.delete(element);
    });
  }

  function autoTranslateNow() {
    if (!isAutoEligible()) return;
    if (state.page.running) return;

    var text = document.body ? document.body.textContent : '';
    if (!text || !text.trim()) return;
    startPageTranslation(state.settings.pageMode, { auto: true });
  }

  function abortPageForNavigation() {
    var page = state.page;
    if (!page.running) return;
    page.cancelled = true;
    page.running = false;
    page.runId++;
    page.status = page.added.length || page.originals.size ? 'translated' : 'idle';
    stopVisibilityObserver(page);
    hideProgress();
  }

  function waitForRouteContent(callback) {
    var done = false;
    var settleTimer = null;
    var maxTimer = null;
    var observer = null;

    function finish() {
      if (done) return;
      done = true;
      if (settleTimer) clearTimeout(settleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (observer) observer.disconnect();
      callback();
    }

    if (!document.body || !window.MutationObserver) {
      setTimeout(finish, AUTO_ROUTE_SETTLE);
      return;
    }

    try {
      observer = new window.MutationObserver(function () {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(finish, AUTO_ROUTE_SETTLE);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (error) {
      setTimeout(finish, AUTO_ROUTE_SETTLE);
      return;
    }

    settleTimer = setTimeout(finish, AUTO_ROUTE_SETTLE);
    maxTimer = setTimeout(finish, AUTO_ROUTE_MAX_WAIT);
  }

  function scheduleAutoRoute() {
    clearTimeout(state.auto.routeTimer);
    var seq = ++state.auto.routeSeq;

    state.auto.routeTimer = setTimeout(function () {
      state.auto.routeTimer = null;
      if (!isAutoEligible()) return;
      if (seq !== state.auto.routeSeq) return;

      // The old route's in-flight requests are stale, but the translations
      // it already applied are kept: SPA shells such as a sidebar stay on
      // the page and must not be translated again.
      abortPageForNavigation();
      prunePageState();

      waitForRouteContent(function () {
        if (seq !== state.auto.routeSeq) return;
        autoTranslateNow();
      });
    }, AUTO_ROUTE_DEBOUNCE);
  }

  function checkAutoNavigation() {
    if (!isAutoEligible()) return;
    var key = navigationKey();
    if (key === state.auto.lastKey) return;
    state.auto.lastKey = key;
    scheduleAutoRoute();
  }

  function startNavigationWatcher() {
    if (state.auto.pollTimer) return;

    state.auto.lastKey = navigationKey();
    state.auto.pollTimer = setInterval(checkAutoNavigation, AUTO_URL_POLL);
    if (!state.auto.listening) {
      state.auto.listening = true;
      window.addEventListener('popstate', checkAutoNavigation);
      window.addEventListener('hashchange', checkAutoNavigation);
      // Router links update history in their own click handler, so inspect on
      // the next task instead of waiting for the URL poll.
      window.addEventListener('click', function () {
        setTimeout(checkAutoNavigation, 0);
      }, true);
    }
  }

  function initAutoTranslation() {
    // Watch routes only for sites that resume automatically, or once a manual
    // translation has remembered the site (see rememberTranslatedOrigin).
    if (state.translatedOrigins.has(currentOrigin())) startNavigationWatcher();
    if (state.auto.initialized) return;
    state.auto.initialized = true;

    whenDocumentReady(function () {
      scheduleAutoStart(AUTO_START_DELAY);
    });
  }

  async function startPageTranslation(mode, options) {
    var auto = !!(options && options.auto);
    var page = state.page;
    if (page.running) {
      if (!auto) showToast('正在翻译当前页面，请稍候');
      return;
    }

    // Automatic runs happen right after load and the cached copy is current;
    // an explicit action must pick up changes made in the options tab.
    if (!auto) await refreshSettings();

    var problem = PT.validateProvider(state.settings);
    if (problem) {
      // Automatic mode must stay quiet. A misconfigured provider is reported
      // in the popup when the user explicitly asks for a translation.
      if (auto) {
        console.warn('[Safari Translator] 自动翻译未启动：' + problem.message);
        return;
      }
      showToast(problem.message, '打开设置', openOptions);
      return;
    }

    var target = state.settings.targetLang;
    prunePageState();

    // A different language or layout invalidates every existing translation.
    // Otherwise keep them and only fill in what the new route added.
    if ((page.added.length || page.originals.size) && (page.target !== target || page.mode !== mode)) {
      restorePage({ silent: true });
    }

    var units = mode === 'replace' ? collectTextNodes(target) : collectBlocks(target);

    if (!units.length) {
      if (page.added.length || page.originals.size) {
        page.status = 'translated';
        rememberTranslatedOrigin();
        if (!auto) showToast('页面已翻译，没有新的内容');
      } else {
        page.status = 'idle';
        if (!auto) {
          showToast('没有找到需要翻译的文本。若页面已是目标语言，或内容位于代码块中，将不会翻译。');
        }
      }
      return;
    }

    var runId = ++page.runId;
    page.running = true;
    page.cancelled = false;
    page.status = 'running';
    page.mode = mode || 'replace';
    page.target = target;
    page.total = units.length;
    page.done = 0;
    page.visible = 0;
    page.offscreen = 0;
    stopVisibilityObserver(page);

    var visibleQueue = createQueue();
    var nearQueue = createQueue();
    var offscreenQueue = createQueue();

    units.forEach(function (unit) {
      if (isInViewport(unit)) {
        unit.state = 'visible';
        visibleQueue.items.push(unit);
      } else {
        unit.state = 'pending';
        offscreenQueue.items.push(unit);
      }
    });

    page.visible = visibleQueue.items.length;
    page.offscreen = offscreenQueue.items.length;
    page.observer = startVisibilityObserver(units, nearQueue, offscreenQueue, runId);

    var progressNote = page.offscreen ? '优先翻译可视区' : '';
    if (auto) progressNote = progressNote ? '自动翻译 · ' + progressNote : '自动翻译';
    showProgress(units.length, progressNote);
    var runStartedAt = Date.now();

    var backgroundReady = false;
    var done = 0;
    var failed = 0;
    var fatal = null;

    while (!page.cancelled && page.runId === runId) {
      var batch = takeBatch(visibleQueue, nearQueue, offscreenQueue, backgroundReady);

      if (!batch.length) {
        // Give the reader a moment to scroll before spending requests on
        // content they may never look at. Once that window passes, translate
        // the remainder in the background so the whole page still completes.
        if (!backgroundReady && hasPending(offscreenQueue, 'pending')) {
          updateProgress(done + failed, units.length, '可视区已完成，后台继续');
          await delay(BACKGROUND_DELAY);
          backgroundReady = true;
          continue;
        }
        break;
      }

      var response = null;
      try {
        response = await send({
          type: 'translateBatch',
          texts: batch.map(function (unit) { return unit.text; }),
          from: state.settings.sourceLang,
          to: target
        }, 120000);
      } catch (error) {
        fatal = error;
        break;
      }

      if (page.cancelled || page.runId !== runId) break;

      if (!response || !response.ok) {
        fatal = responseError(response);
        break;
      }

      var results = response.results || [];
      for (var i = 0; i < batch.length; i++) {
        if (page.cancelled || page.runId !== runId) break;
        var unit = batch[i];
        var result = results[i];

        if (result && result.ok && result.text) {
          var applied = mode === 'replace'
            ? applyTextTranslation(unit, result.text)
            : applyBlockTranslation(unit, result.text, target);
          if (applied) done++;
          else failed++;
        } else {
          failed++;
          if (!fatal && result && result.error && FATAL_CODES[result.error.code]) {
            fatal = responseError({ error: result.error });
          }
        }
      }

      var note = failed ? failed + ' 段失败' : '';
      if (!note && hasPending(visibleQueue, 'visible')) note = '优先翻译可视区';
      if (!note && backgroundReady) note = '可视区已完成，后台继续';
      updateProgress(done + failed, units.length, note);
      if (fatal) break;
    }

    // A restore or a newer run has taken over the page/UI.
    if (page.runId !== runId) return;

    stopVisibilityObserver(page);
    page.running = false;
    page.done = done;

    if (page.cancelled) {
      page.status = page.added.length || page.originals.size ? 'translated' : 'idle';
      if (page.status === 'translated') rememberTranslatedOrigin();
      hideProgress();
      showToast('已取消翻译，已翻译的内容仍然保留');
      return;
    }

    if (fatal) {
      page.status = done || page.added.length || page.originals.size ? 'translated' : 'idle';
      if (page.status === 'translated') rememberTranslatedOrigin();
      q('progress-title').textContent = auto ? '自动翻译中断' : '翻译中断';
      updateProgress(done + failed, units.length, '');
      var cancelButton = q('progress').querySelector('[data-action="cancel"]');
      if (cancelButton) {
        cancelButton.setAttribute('title', '关闭');
        cancelButton.setAttribute('aria-label', '关闭');
      }
      showToast(
        (auto ? '自动翻译中断：' : '翻译中断：') + (fatal.message || '未知错误'),
        fatal.code === 'config' || fatal.code === 'auth' ? '打开设置' : null,
        openOptions
      );
      finishProgress(runId, 4000);
      return;
    }

    page.status = done || page.added.length || page.originals.size ? 'translated' : 'idle';
    if (page.status === 'translated') rememberTranslatedOrigin();

    if (failed) {
      q('progress-title').textContent = '部分完成';
      updateProgress(done + failed, units.length, failed + ' 段失败');
      if (!auto) showToast('已翻译 ' + done + ' 段，' + failed + ' 段失败');
      finishProgress(runId, 2800);
    } else {
      q('progress-title').textContent = '翻译完成';
      updateProgress(units.length, units.length, '');
      if (!auto) {
        showToast('已完成 ' + done + ' 段翻译', '还原原文', function () { restorePage(); });
      }
      // Cache hits finish in a few milliseconds; do not leave a HUD behind.
      finishProgress(runId, Date.now() - runStartedAt < 400 ? 0 : 1600);
    }
  }

  function restorePage(options) {
    var page = state.page;
    page.cancelled = true;
    page.running = false;
    page.runId++;
    stopVisibilityObserver(page);

    page.added.forEach(function (span) {
      try { span.remove(); } catch (e) { /* ignore */ }
    });
    page.originals.forEach(function (original, node) {
      try {
        if (node && node.isConnected) node.nodeValue = original;
      } catch (e) { /* ignore */ }
    });

    var hadContent = page.added.length > 0 || page.originals.size > 0;

    page.added = [];
    page.originals = new Map();
    page.applied = new Map();
    page.blocks = new Map();
    page.target = null;
    page.status = 'idle';
    page.total = 0;
    page.done = 0;
    page.visible = 0;
    page.offscreen = 0;

    hideProgress();

    if (!options || !options.silent) {
      if (hadContent) forgetTranslatedOrigin();
      showToast(hadContent ? '已还原原文' : '当前页面没有译文');
    }
  }

  /* ------------------------------------------------------------------ *
   * UI events
   * ------------------------------------------------------------------ */

  function bindUI() {
    state.button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var selection = state.selection;
      hideSelectionButton();
      if (!selection) return;
      state.anchor = liveSelectionRange();
      translateSelection(selection.text, selection.rect);
    });

    // Keep the selection while the user presses the floating button.
    state.button.addEventListener('mousedown', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });

    state.layer.addEventListener('click', function (event) {
      var action = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!action) return;
      var name = action.getAttribute('data-action');

      switch (name) {
        case 'close':
          closePanel();
          break;
        case 'copy':
          if (state.last && state.last.text) {
            PT.copyText(state.last.text).then(function (ok) {
              showToast(ok ? '译文已复制' : '复制失败，请手动选择文本');
            });
          }
          break;
        case 'speak':
          if (state.last && state.last.text) speak(state.last.text, state.last.target);
          break;
        case 'settings':
          openOptions();
          break;
        case 'retry':
          retryLast();
          break;
        case 'cancel':
          if (state.page.running) {
            state.page.cancelled = true;
            action.disabled = true;
            action.setAttribute('title', '正在取消');
            action.setAttribute('aria-label', '正在取消');
          } else {
            hideProgress();
          }
          break;
        default:
          break;
      }
    });

    q('target').addEventListener('change', async function (event) {
      var value = event.target.value;
      if (!PT.isLangCode(value) || value === 'auto') return;
      try {
        state.settings = await PT.updateSettings({ targetLang: value });
      } catch (error) {
        showToast('无法保存目标语言');
        return;
      }

      if (state.page.status === 'translated') {
        showToast('目标语言已切换为 ' + PT.languageName(value), '重新翻译页面', function () {
          startPageTranslation(state.page.mode);
        });
      }
      if (state.last && state.last.original) {
        translateSelection(state.last.original, state.lastRect);
      }
    });

    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keyup', onKeyUp, true);

    document.addEventListener('contextmenu', function (event) {
      state.lastPoint = { x: event.clientX, y: event.clientY };
    }, true);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') dismissSelectionUI();
    }, true);

    window.addEventListener('blur', dismissSelectionUI);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) dismissSelectionUI();
    });
    document.addEventListener('focusin', function (event) {
      if (isEventInsideUI(event)) return;
      dismissSelectionUI();
    }, true);

    if (window.matchMedia) {
      try {
        var media = window.matchMedia('(prefers-color-scheme: dark)');
        var listener = function () { applyTheme(); };
        if (media.addEventListener) media.addEventListener('change', listener);
        else if (media.addListener) media.addListener(listener);
      } catch (e) { /* ignore */ }
    }

    window.addEventListener('scroll', function () {
      hideSelectionButton();
      scheduleFollow();
    }, true);
    window.addEventListener('resize', scheduleFollow);

    api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || message.__pt !== true) return undefined;

      switch (message.type) {
        case 'pt:translate-selection':
          state.anchor = liveSelectionRange();
          translateSelection(message.text || (readSelection() || {}).text, message.rect || null);
          sendResponse({ ok: true });
          return undefined;

        case 'pt:translate-page':
          startPageTranslation(message.mode || 'replace');
          sendResponse({ ok: true });
          return undefined;

        case 'pt:restore-page':
          restorePage();
          sendResponse({ ok: true });
          return undefined;

        case 'pt:ping':
          sendResponse({ ok: true, translated: state.page.status === 'translated' });
          return undefined;

        case 'pt:get-selection': {
          var selection = readSelection();
          sendResponse({ ok: true, text: selection ? selection.text : '' });
          return undefined;
        }

        default:
          return undefined;
      }
    });

    PT.onSettingsChanged(function (settings) {
      state.settings = settings;
      updateProviderLabel();
      syncTargetSelect();
      applyTheme();
      if (!settings.selectionButton) hideSelectionButton();
    });
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  async function boot() {
    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
      return;
    }

    createUI();

    try {
      state.settings = await PT.loadSettings();
    } catch (error) {
      state.settings = PT.defaultSettings();
    }

    updateProviderLabel();
    syncTargetSelect();
    applyTheme();

    // Only sites the user has translated before resume automatically; other
    // pages wait for an explicit translate action.
    await loadTranslatedOrigins();
    initAutoTranslation();

    // Expose a tiny hook for the bundled demo page and for debugging.
    window.__PT_CONTENT__ = {
      translateSelection: translateSelection,
      translatePage: startPageTranslation,
      translateNow: autoTranslateNow,
      restorePage: restorePage,
      openPanel: openPanel,
      closePanel: closePanel,
      getState: function () { return state; }
    };
  }

  boot();
})();
