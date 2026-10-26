(function () {
  'use strict';

  var PT = window.PT;
  if (!PT) return;

  var api = PT.getApi();
  var settings = null;
  var busy = false;

  function $(id) {
    return document.getElementById(id);
  }

  function showStatus(message, tone, actionLabel, action) {
    var box = $('status');
    box.textContent = '';
    box.hidden = false;
    box.setAttribute('data-tone', tone || 'muted');
    box.appendChild(document.createTextNode(message));

    if (actionLabel) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = actionLabel;
      button.addEventListener('click', action);
      box.appendChild(button);
    }
  }

  function hideStatus() {
    $('status').hidden = true;
  }

  function setBusy(value) {
    busy = value;
    ['translate-page', 'replace-page', 'restore-page', 'target', 'selection-toggle'].forEach(function (id) {
      $(id).disabled = value;
    });
  }

  function openOptions() {
    try {
      if (api.runtime.openOptionsPage) {
        api.runtime.openOptionsPage();
        window.close();
        return;
      }
    } catch (error) { /* fall through */ }

    api.runtime.sendMessage({ __pt: true, type: 'open-options' }).then(function () {
      window.close();
    }).catch(function () {
      showStatus('无法打开设置页，请在扩展管理器中打开“选项”。', 'error');
    });
  }

  var SHORT_BADGE = {
    mymemory: 'M',
    google: 'G',
    azure: 'Az',
    aliyun: '阿',
    tencent: '腾',
    deepl: 'D',
    libre: 'L',
    openai: 'AI'
  };

  function renderProvider() {
    var meta = PT.providerMeta(settings.provider);
    var badge = $('provider-badge');
    badge.textContent = SHORT_BADGE[meta.id] || 'T';
    badge.setAttribute('data-tone', meta.badgeTone || 'slate');
    $('provider-name').textContent = meta.name;
    $('provider').title = meta.name + ' — 点击更改翻译服务';
  }

  function renderLanguages() {
    var select = $('target');
    select.textContent = '';
    PT.LANGUAGES.forEach(function (lang) {
      var option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.zh;
      select.appendChild(option);
    });
    select.value = settings.targetLang;
    if (!select.value) select.value = PT.defaultTarget();
  }

  function renderToggles() {
    $('selection-toggle').checked = settings.selectionButton !== false;
    $('version').textContent = 'v' + PT.VERSION;
  }

  function errorOf(response) {
    var info = (response && response.error) || {};
    return {
      message: info.message || '操作失败',
      hint: info.hint || '',
      code: info.code || 'unknown'
    };
  }

  async function save(patch) {
    try {
      settings = await PT.updateSettings(patch);
      renderProvider();
      return true;
    } catch (error) {
      showStatus('设置保存失败：' + (error && error.message ? error.message : '未知错误'), 'error');
      return false;
    }
  }

  async function runPageAction(message) {
    if (busy) return;
    hideStatus();
    setBusy(true);
    try {
      var response = await api.runtime.sendMessage(Object.assign({ __pt: true }, message));
      if (!response || !response.ok) {
        var info = errorOf(response);
        throw Object.assign(new Error(info.message), info);
      }
      window.close();
    } catch (error) {
      var hint = error && error.hint ? ' ' + error.hint : '';
      showStatus((error && error.message ? error.message : '操作失败') + hint, 'error',
        error && (error.code === 'config' || error.code === 'auth') ? '打开设置' : null,
        openOptions);
      setBusy(false);
    }
  }

  function translatePage(mode) {
    if (!settings) return;
    var problem = PT.validateProvider(settings);
    if (problem) {
      showStatus(problem.message, 'error', '打开设置', openOptions);
      return;
    }
    runPageAction({
      type: 'translate-active-page',
      mode: mode
    });
  }

  function restorePage() {
    runPageAction({ type: 'restore-active-page' });
  }

  async function init() {
    try {
      settings = await PT.loadSettings();
    } catch (error) {
      settings = PT.defaultSettings();
      showStatus('无法读取设置，已使用默认值。', 'error');
    }

    renderProvider();
    renderLanguages();
    renderToggles();

    $('provider').addEventListener('click', openOptions);
    $('settings').addEventListener('click', openOptions);
    $('open-options').addEventListener('click', openOptions);

    $('target').addEventListener('change', async function (event) {
      var value = event.target.value;
      if (!PT.isLangCode(value) || value === 'auto') return;
      var ok = await save({ targetLang: value });
      if (ok) hideStatus();
    });

    $('selection-toggle').addEventListener('change', async function (event) {
      await save({ selectionButton: event.target.checked });
    });

    $('translate-page').addEventListener('click', function () { translatePage('bilingual'); });
    $('replace-page').addEventListener('click', function () { translatePage('replace'); });
    $('restore-page').addEventListener('click', restorePage);
  }

  init();
})();
