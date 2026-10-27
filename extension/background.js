/*
 * Safari Translator — background page.
 *
 * Responsibilities:
 *   - context menus (selection + whole page + options)
 *   - the privileged network layer (all provider calls happen here)
 *   - routing popup/content messages to the right tab
 *   - injecting the content script on demand (e.g. tabs opened before install)
 */
(function (global) {
  'use strict';

  var PT = global.PT;
  var api = global.browser || global.chrome;

  if (!PT || !api) return;

  var MENU = {
    selection: 'pt-translate-selection',
    page: 'pt-translate-page',
    restore: 'pt-restore-page',
    options: 'pt-options'
  };

  // Safari supports the page-level contexts but not every Chrome context
  // (for example `password`). Listing them explicitly keeps the page actions
  // reachable on links, images and editable fields without relying on `all`.
  var PAGE_CONTEXTS = ['page', 'selection', 'link', 'image', 'video', 'audio', 'editable'];

  /* ------------------------------------------------------------------ *
   * Promise helpers (Safari supports both promise and callback styles)
   * ------------------------------------------------------------------ */

  function invoke(fn, thisArg, args) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(error, value) {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(value);
      }

      var result;
      try {
        result = fn.apply(
          thisArg,
          (args || []).concat(function (value) {
            var lastError = api.runtime && api.runtime.lastError;
            finish(lastError ? new Error(lastError.message || String(lastError)) : null, value);
          })
        );
      } catch (error) {
        finish(error);
        return;
      }

      if (result && typeof result.then === 'function') {
        result.then(function (value) { finish(null, value); }, function (error) { finish(error); });
      }
      // Otherwise wait for the callback: Safari's native browser methods
      // report a length of 0 and return undefined even when they accept one.
    });
  }

  function mapLimit(items, limit, worker) {
    return new Promise(function (resolve) {
      var results = new Array(items.length);
      var next = 0;
      var active = 0;
      var completed = 0;

      if (!items.length) {
        resolve(results);
        return;
      }

      function launch() {
        while (active < limit && next < items.length) {
          (function (index) {
            active++;
            Promise.resolve()
              .then(function () { return worker(items[index], index); })
              .then(
                function (value) { results[index] = value; },
                function (error) {
                  results[index] = {
                    ok: false,
                    error: PT.serializeError(error)
                  };
                }
              )
              .then(function () {
                active--;
                completed++;
                if (completed === items.length) resolve(results);
                else launch();
              });
          })(next++);
        }
      }
      launch();
    });
  }

  /* ------------------------------------------------------------------ *
   * Context menus
   * ------------------------------------------------------------------ */

  var menuSetup = null;

  function removeAllMenus() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve();
      }
      try {
        var result = api.contextMenus.removeAll(finish);
        if (result && typeof result.then === 'function') result.then(finish, finish);
      } catch (e) {
        finish();
        return;
      }
      // Safari occasionally never calls the callback when there is nothing to
      // remove; do not block menu creation forever.
      setTimeout(finish, 400);
    });
  }

  function createMenu(props) {
    try {
      api.contextMenus.create(props, function () {
        // Touch lastError so Safari does not log "unchecked runtime.lastError".
        void (api.runtime && api.runtime.lastError);
      });
    } catch (e) {
      // Duplicate ids are harmless.
    }
  }

  function setupMenus() {
    if (!api.contextMenus) return Promise.resolve();
    if (menuSetup) return menuSetup;

    menuSetup = removeAllMenus()
      .then(function () {
        createMenu({
          id: MENU.selection,
          title: '翻译所选文字',
          contexts: ['selection']
        });
        createMenu({ id: 'pt-sep-1', type: 'separator', contexts: PAGE_CONTEXTS });
        createMenu({
          id: MENU.page,
          title: '翻译此页面',
          contexts: PAGE_CONTEXTS
        });
        createMenu({
          id: MENU.restore,
          title: '还原原文',
          contexts: PAGE_CONTEXTS
        });
        createMenu({ id: 'pt-sep-2', type: 'separator', contexts: PAGE_CONTEXTS });
        createMenu({
          id: MENU.options,
          title: '翻译设置…',
          contexts: PAGE_CONTEXTS
        });
      })
      .catch(function (error) {
        console.warn('[Safari Translator] 创建右键菜单失败：', error);
      })
      .then(function () {
        menuSetup = null;
      });

    return menuSetup;
  }

  function openOptions() {
    return PT.openOptionsPage().catch(function (error) {
      console.warn('[Safari Translator] 无法打开设置页：', error);
    });
  }

  function sendToTab(tabId, message) {
    return invoke(api.tabs.sendMessage, api.tabs, [tabId, message]).catch(function () {
      return injectAndSend(tabId, message);
    });
  }

  function injectAndSend(tabId, message) {
    var files = ['common.js', 'content.js'];
    var chain = Promise.resolve();

    files.forEach(function (file) {
      chain = chain.then(function () {
        return invoke(api.tabs.executeScript, api.tabs, [tabId, { file: file }]);
      });
    });

    chain = chain.then(function () {
      return invoke(api.tabs.insertCSS, api.tabs, [tabId, { file: 'content.css' }]).catch(function () {
        // CSS injection is best effort.
      });
    });

    return chain
      .then(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 60); });
      })
      .then(function () {
        return invoke(api.tabs.sendMessage, api.tabs, [tabId, message]);
      });
  }

  function translateTab(tabId, mode) {
    return sendToTab(tabId, { __pt: true, type: 'pt:translate-page', mode: mode || 'replace' });
  }

  function restoreTab(tabId) {
    return sendToTab(tabId, { __pt: true, type: 'pt:restore-page' });
  }

  function firstActiveTab(tabs) {
    var list = Array.isArray(tabs) ? tabs : [];
    var fallback = null;

    for (var i = 0; i < list.length; i += 1) {
      var tab = list[i];
      if (!tab || tab.id == null) continue;
      if (!fallback) fallback = tab;
      // Prefer a normal web page when Safari returns active tabs from
      // several windows, for example an extension page or the Start Page.
      if (!tab.url || /^https?:/i.test(tab.url)) return tab;
    }

    return fallback;
  }

  function activeTab() {
    // Safari sometimes reports no tabs for `currentWindow` while the toolbar
    // popup is open, because the popup is not a normal browser window.
    // Fall back to the last focused window, then to any active tab.
    var filters = [
      { active: true, currentWindow: true },
      { active: true, lastFocusedWindow: true },
      { active: true }
    ];
    var index = 0;

    function next() {
      if (index >= filters.length) {
        return Promise.reject(new PT.ProviderError('no-tab', '没有找到当前标签页', {
          hint: '请确认 Safari 中有一个打开的网页，并让该网页处于最前面。'
        }));
      }

      var filter = filters[index];
      index += 1;

      return invoke(api.tabs.query, api.tabs, [filter]).then(function (tabs) {
        return firstActiveTab(tabs) || next();
      }, function () {
        return next();
      });
    }

    return next();
  }

  /* ------------------------------------------------------------------ *
   * Menus + keyboard-ish entry points
   * ------------------------------------------------------------------ */

  if (api.contextMenus && api.contextMenus.onClicked) {
    api.contextMenus.onClicked.addListener(function (info, tab) {
      var id = String(info.menuItemId || '');

      if (id === MENU.options) {
        openOptions();
        return;
      }
      if (!tab || tab.id == null) return;

      if (id === MENU.selection) {
        var selection = PT.normalizeText(info.selectionText || '');
        sendToTab(tab.id, {
          __pt: true,
          type: 'pt:translate-selection',
          text: selection
        }).catch(function (error) {
          console.warn('[Safari Translator] 划词翻译失败：', error);
        });
        return;
      }
      if (id === MENU.page) {
        Promise.resolve().then(function () {
          return PT.loadSettings();
        }).then(function (settings) {
          var mode = PT.normalizeSettings(settings).pageMode;
          return translateTab(tab.id, mode);
        }).catch(function (error) {
          console.warn('[Safari Translator] 页面翻译失败：', error);
        });
        return;
      }
      if (id === MENU.restore) {
        restoreTab(tab.id).catch(function (error) {
          console.warn('[Safari Translator] 还原失败：', error);
        });
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Message router
   * ------------------------------------------------------------------ */

  async function handleMessage(message) {
    switch (message.type) {
      case 'pt:ping':
        return { ok: true, version: PT.VERSION };

      case 'translate': {
        var settings = PT.normalizeSettings(message.settings || (await PT.loadSettings()));
        var result = await PT.translate(settings, message.text, {
          from: message.from,
          to: message.to,
          provider: message.provider,
          noCache: message.noCache
        });
        return { ok: true, text: result.text, detected: result.detected, provider: result.provider };
      }

      case 'translateBatch': {
        var batchSettings = PT.normalizeSettings(message.settings || (await PT.loadSettings()));
        var texts = Array.isArray(message.texts) ? message.texts.slice(0, 200) : [];
        if (!texts.length) return { ok: true, results: [] };

        var results = await PT.translateMany(batchSettings, texts, {
          from: message.from,
          to: message.to,
          provider: message.provider
        });

        return { ok: true, results: results };
      }

      case 'test-provider': {
        var testSettings = PT.normalizeSettings(message.settings);
        var test = await PT.translate(testSettings, message.text || 'Hello, world!', {
          from: message.from || 'auto',
          to: message.to || testSettings.targetLang,
          provider: testSettings.provider,
          noCache: true
        });
        return {
          ok: true,
          text: test.text,
          detected: test.detected,
          provider: test.provider
        };
      }

      case 'translate-active-page':
      case 'translateActivePage': {
        var tab = await activeTab();
        await translateTab(tab.id, message.mode || 'replace');
        return { ok: true };
      }

      case 'restore-active-page':
      case 'restoreActivePage': {
        var active = await activeTab();
        await restoreTab(active.id);
        return { ok: true };
      }

      case 'open-options':
      case 'openOptions': {
        await openOptions();
        return { ok: true };
      }

      default:
        return { ok: false, error: { code: 'request', message: '未知的请求：' + message.type } };
    }
  }

  if (api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || message.__pt !== true) return undefined;

      handleMessage(message).then(
        function (response) { sendResponse(response); },
        function (error) {
          sendResponse({ ok: false, error: PT.serializeError(error) });
        }
      );
      return true;
    });
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  setupMenus();

  if (api.runtime) {
    if (api.runtime.onInstalled) {
      api.runtime.onInstalled.addListener(function () { setupMenus(); });
    }
    if (api.runtime.onStartup) {
      api.runtime.onStartup.addListener(function () { setupMenus(); });
    }
  }

  // Exported for the test-suite; harmless in production.
  global.__PT_BACKGROUND__ = {
    MENU: MENU,
    handleMessage: handleMessage,
    setupMenus: setupMenus,
    sendToTab: sendToTab,
    mapLimit: mapLimit
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
