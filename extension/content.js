/*
 * Safari Translator — content script.
 *
 * UX contract:
 *   - Nothing is translated automatically.
 *   - Selecting text shows a small floating "翻译" button.
 *   - Right-click offers explicit translate actions (see background.js).
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
  var BATCH_SIZE = 8;
  var BATCH_CHARS = 2600;
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
    requestSeq: 0,
    toastTimer: null,
    page: {
      status: 'idle', // idle | running | translated
      running: false,
      cancelled: false,
      runId: 0,
      mode: 'bilingual',
      added: [],
      originals: new Map(),
      total: 0,
      done: 0
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
      right: 18px;
      bottom: 18px;
      width: min(300px, calc(100vw - 36px));
      padding: 11px 13px 12px;
      border-radius: 12px;
      border: 1px solid var(--pt-border);
      background: var(--pt-bg);
      box-shadow: var(--pt-shadow);
      pointer-events: auto;
      animation: pt-rise .16s ease-out;
    }
    .pt-progress[hidden] { display: none; }
    .pt-progress-head { display: flex; align-items: center; gap: 8px; }
    .pt-progress-title { font-size: 12.5px; font-weight: 600; color: var(--pt-text); }
    .pt-spinner {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      border: 2px solid var(--pt-accent-soft);
      border-top-color: var(--pt-accent);
      animation: pt-spin .8s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes pt-spin { to { transform: rotate(360deg); } }

    .pt-link {
      border: 0;
      background: transparent;
      color: var(--pt-muted);
      font-size: 11.5px;
      cursor: pointer;
      padding: 2px 0;
      pointer-events: auto;
    }
    .pt-link:hover { color: var(--pt-danger); }

    .pt-bar {
      height: 4px;
      margin-top: 9px;
      border-radius: 2px;
      background: var(--pt-bg-soft);
      overflow: hidden;
    }
    .pt-bar i {
      display: block;
      height: 100%;
      width: 0;
      border-radius: 2px;
      background: linear-gradient(90deg, #2f6bff, #7c5cff);
      transition: width .25s ease;
    }
    .pt-progress-meta {
      margin-top: 6px;
      font-size: 11px;
      color: var(--pt-faint);
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    @media (prefers-reduced-motion: reduce) {
      .pt-panel, .pt-sel-btn, .pt-toast, .pt-progress { animation: none; }
      .pt-loading i { animation: none; }
      .pt-spinner { animation-duration: 1.8s; }
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
          '<div class="pt-progress-head">' +
            '<span class="pt-spinner" data-role="spinner"></span>' +
            '<span class="pt-progress-title" data-role="progress-title">正在翻译页面</span>' +
            '<span class="pt-spacer"></span>' +
            '<button type="button" class="pt-link" data-action="cancel">取消</button>' +
          '</div>' +
          '<div class="pt-bar"><i data-role="bar"></i></div>' +
          '<div class="pt-progress-meta"><span data-role="progress-count">0 / 0</span><span data-role="progress-note"></span></div>' +
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
    if (!state.settings) {
      try {
        state.settings = await PT.loadSettings();
      } catch (error) {
        state.settings = PT.defaultSettings();
      }
    }

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

      units.push({
        node: node,
        text: text,
        original: node.nodeValue
      });
    }

    return units;
  }

  function groupUnits(units) {
    var groups = [];
    var current = [];
    var chars = 0;

    units.forEach(function (unit) {
      if (current.length && (current.length >= BATCH_SIZE || chars + unit.text.length > BATCH_CHARS)) {
        groups.push(current);
        current = [];
        chars = 0;
      }
      current.push(unit);
      chars += unit.text.length;
    });
    if (current.length) groups.push(current);
    return groups;
  }

  /* ------------------------------------------------------------------ *
   * Page translation — apply / restore
   * ------------------------------------------------------------------ */

  function applyBlockTranslation(unit, translated, targetLang) {
    var element = unit.element;
    if (!element || !element.isConnected) return false;

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
    return true;
  }

  function applyTextTranslation(unit, translated) {
    var node = unit.node;
    if (!node || !node.isConnected) return false;

    if (!state.page.originals.has(node)) {
      state.page.originals.set(node, unit.original);
    }
    var raw = unit.original;
    var lead = (raw.match(/^\s*/) || [''])[0];
    var trail = (raw.match(/\s*$/) || [''])[0];
    node.nodeValue = lead + translated + trail;
    return true;
  }

  function updateProgress(done, total, note) {
    var bar = q('bar');
    var percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    if (bar) bar.style.width = percent + '%';
    var count = q('progress-count');
    if (count) count.textContent = done + ' / ' + total;
    var noteEl = q('progress-note');
    if (noteEl) noteEl.textContent = note || '';
  }

  function showProgress(total) {
    var progress = q('progress');
    progress.hidden = false;
    q('spinner').style.display = '';
    q('progress-title').textContent = '正在翻译页面';
    var cancel = progress.querySelector('[data-action="cancel"]');
    if (cancel) {
      cancel.textContent = '取消';
      cancel.disabled = false;
    }
    updateProgress(0, total, '');
  }

  function hideProgress() {
    var progress = q('progress');
    if (progress) progress.hidden = true;
  }

  function finishProgress(runId, delay) {
    setTimeout(function () {
      if (state.page.runId === runId) hideProgress();
    }, delay || 1200);
  }

  async function startPageTranslation(mode) {
    var page = state.page;
    if (page.running) {
      showToast('正在翻译当前页面，请稍候');
      return;
    }

    if (!state.settings) {
      try {
        state.settings = await PT.loadSettings();
      } catch (error) {
        state.settings = PT.defaultSettings();
      }
    }

    var problem = PT.validateProvider(state.settings);
    if (problem) {
      showToast(problem.message, '打开设置', openOptions);
      return;
    }

    if (page.added.length || page.originals.size) {
      restorePage({ silent: true });
    }

    var target = state.settings.targetLang;
    var units = mode === 'replace' ? collectTextNodes(target) : collectBlocks(target);

    if (!units.length) {
      showToast('没有找到需要翻译的文本。若页面已是目标语言，或内容位于代码块中，将不会翻译。');
      return;
    }

    var runId = ++page.runId;
    page.running = true;
    page.cancelled = false;
    page.status = 'running';
    page.mode = mode || 'bilingual';
    page.total = units.length;
    page.done = 0;
    page.added = [];
    page.originals = new Map();

    showProgress(units.length);

    var groups = groupUnits(units);
    var done = 0;
    var failed = 0;
    var fatal = null;

    for (var g = 0; g < groups.length; g++) {
      if (page.cancelled || page.runId !== runId) break;

      var response = null;
      try {
        response = await send({
          type: 'translateBatch',
          texts: groups[g].map(function (unit) { return unit.text; }),
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
      for (var i = 0; i < groups[g].length; i++) {
        if (page.cancelled || page.runId !== runId) break;
        var unit = groups[g][i];
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

      updateProgress(done + failed, units.length, failed ? failed + ' 段失败' : '');
      if (fatal) break;
    }

    // A restore or a newer run has taken over the page/UI.
    if (page.runId !== runId) return;

    page.running = false;
    page.done = done;

    if (page.cancelled) {
      page.status = page.added.length || page.originals.size ? 'translated' : 'idle';
      hideProgress();
      showToast('已取消翻译，已翻译的内容仍然保留');
      return;
    }

    if (fatal) {
      page.status = done ? 'translated' : 'idle';
      q('spinner').style.display = 'none';
      q('progress-title').textContent = '翻译中断';
      updateProgress(done + failed, units.length, '');
      var cancelButton = q('progress').querySelector('[data-action="cancel"]');
      if (cancelButton) cancelButton.textContent = '关闭';
      showToast('翻译中断：' + (fatal.message || '未知错误'), fatal.code === 'config' || fatal.code === 'auth' ? '打开设置' : null, openOptions);
      finishProgress(runId, 4000);
      return;
    }

    page.status = done ? 'translated' : 'idle';

    if (failed) {
      q('progress-title').textContent = '部分完成';
      updateProgress(done + failed, units.length, failed + ' 段失败');
      showToast('已翻译 ' + done + ' 段，' + failed + ' 段失败');
      finishProgress(runId, 2800);
    } else {
      q('progress-title').textContent = '翻译完成';
      updateProgress(units.length, units.length, '');
      showToast('已完成 ' + done + ' 段翻译', '还原原文', function () { restorePage(); });
      finishProgress(runId, 1600);
    }
  }

  function restorePage(options) {
    var page = state.page;
    page.cancelled = true;
    page.running = false;
    page.runId++;

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
    page.status = 'idle';
    page.total = 0;
    page.done = 0;

    hideProgress();

    if (!options || !options.silent) {
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
            action.textContent = '正在取消…';
            action.disabled = true;
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

    window.addEventListener('scroll', hideSelectionButton, true);

    api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || message.__pt !== true) return undefined;

      switch (message.type) {
        case 'pt:translate-selection':
          translateSelection(message.text || (readSelection() || {}).text, message.rect || null);
          sendResponse({ ok: true });
          return undefined;

        case 'pt:translate-page':
          startPageTranslation(message.mode || 'bilingual');
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

    // Expose a tiny hook for the bundled demo page and for debugging.
    window.__PT_CONTENT__ = {
      translateSelection: translateSelection,
      translatePage: startPageTranslation,
      restorePage: restorePage,
      openPanel: openPanel,
      closePanel: closePanel,
      getState: function () { return state; }
    };
  }

  boot();
})();
