import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, loadPT, createBrowserStub, wait } from './support.mjs';

function withPT(options) {
  const browser = options && options.browser;
  const context = createSandbox(browser ? { browser } : {});
  return { PT: loadPT(context), context };
}

test('the default target language follows the browser UI', () => {
  const traditional = withPT({ browser: { i18n: { getUILanguage: () => 'zh-Hant-TW' } } });
  assert.equal(traditional.PT.defaultTarget(), 'zh-TW');

  const simplified = withPT({ browser: { i18n: { getUILanguage: () => 'zh-CN' } } });
  assert.equal(simplified.PT.defaultTarget(), 'zh-CN');

  const english = withPT({ browser: { i18n: { getUILanguage: () => 'en-US' } } });
  assert.equal(english.PT.defaultTarget(), 'en');
});

test('language tables are consistent', () => {
  const { PT } = withPT();
  const codes = PT.LANGUAGES.map((lang) => lang.code);
  assert.equal(new Set(codes).size, codes.length, 'language codes are unique');
  assert.ok(codes.includes('zh-CN'));
  assert.ok(codes.includes('en'));
  assert.ok(!codes.includes('auto'), 'auto is not a selectable target');
  assert.equal(PT.languageName('zh-CN'), '简体中文');
  assert.equal(PT.languageName('auto'), '自动检测');
  assert.equal(PT.languageName('xx'), 'xx');
  assert.equal(PT.isLangCode('auto'), true);
  assert.equal(PT.isLangCode('zh-CN'), true);
  assert.equal(PT.isLangCode('klingon'), false);
  assert.equal(PT.baseLang('zh-TW'), 'zh');
  assert.equal(PT.baseLang('en_US'), 'en');
});

test('provider metadata is ordered and complete', () => {
  const { PT } = withPT();
  const ids = PT.PROVIDERS.map((provider) => provider.id);
  assert.deepEqual(Array.from(ids), ['mymemory', 'google', 'azure', 'aliyun', 'tencent', 'deepl', 'libre', 'openai']);
  assert.equal(ids[0], 'mymemory', 'the keyless provider is the default');

  PT.PROVIDERS.forEach((provider) => {
    assert.ok(provider.label, provider.id + ' has a label');
    assert.ok(provider.desc, provider.id + ' has a description');
    assert.ok(provider.docs.startsWith('https://'), provider.id + ' has docs');
    assert.ok(['free', 'key', 'self'].includes(provider.badgeTone), provider.id + ' badge tone');
    assert.equal(provider.keyless, provider.badgeTone === 'free', provider.id + ' keyless flag');
  });

  assert.equal(PT.providerMeta('tencent').label, '腾讯云机器翻译');
  assert.equal(PT.providerName('nope'), 'MyMemory');
});

test('per-provider language mapping', () => {
  const { PT } = withPT();
  assert.equal(PT.mapLang('tencent', 'zh-CN', true), 'zh');
  assert.equal(PT.mapLang('tencent', 'zh-TW', true), 'zh_TW');
  assert.equal(PT.mapLang('aliyun', 'zh-TW', true), 'zh-tw');
  assert.equal(PT.mapLang('azure', 'zh-TW', true), 'zh-Hant');
  assert.equal(PT.mapLang('azure', 'zh-CN', true), 'zh-Hans');
  assert.equal(PT.mapLang('deepl', 'zh-CN', true), 'ZH-HANS');
  assert.equal(PT.mapLang('deepl', 'zh-TW', true), 'ZH-HANT');
  assert.equal(PT.mapLang('deepl', 'pt', true), 'PT-PT');
  assert.equal(PT.mapLang('deepl', 'en', false), 'EN');
  assert.equal(PT.mapLang('mymemory', 'zh-CN', true), 'zh-CN');
  assert.equal(PT.mapLang('libre', 'zh-TW', true), 'zt');
  assert.equal(PT.mapLang('google', 'fr', true), 'fr');
  assert.equal(PT.mapLang('google', 'auto', false), 'auto');
});

test('detected provider languages normalise to UI codes', () => {
  const { PT } = withPT();
  assert.equal(PT.normalizeDetected('azure', 'zh-Hans'), 'zh-CN');
  assert.equal(PT.normalizeDetected('tencent', 'zh_TW'), 'zh-TW');
  assert.equal(PT.normalizeDetected('aliyun', 'zh-tw'), 'zh-TW');
  assert.equal(PT.normalizeDetected('google', 'jp'), 'ja');
  assert.equal(PT.normalizeDetected('google', 'kr'), 'ko');
  assert.equal(PT.normalizeDetected('google', 'iw'), 'he');
  assert.equal(PT.normalizeDetected('deepl', 'EN'), 'en');
  assert.equal(PT.normalizeDetected('mymemory', ''), '');
});

test('defaults and normalisation', () => {
  const browser = createBrowserStub();
  const { PT } = withPT({ browser });
  const defaults = PT.defaultSettings();
  assert.equal(defaults.provider, 'mymemory');
  assert.equal(defaults.sourceLang, 'auto');
  assert.equal(defaults.targetLang, 'zh-CN', 'Chinese UI defaults to Chinese');
  assert.equal(defaults.pageMode, 'replace');
  assert.equal(defaults.selectionButton, true);
  assert.equal(defaults.theme, 'auto');
  assert.equal(defaults.azureEndpoint, 'https://api.cognitive.microsofttranslator.com');
  assert.equal(defaults.aliyunRegion, 'cn-hangzhou');
  assert.equal(defaults.tencentRegion, 'ap-guangzhou');
  assert.equal(defaults.deeplPlan, 'free');
  assert.equal(defaults.openaiModel, 'gpt-4o-mini');

  const normalized = PT.normalizeSettings({
    provider: 'bogus',
    targetLang: 'auto',
    sourceLang: 'nope',
    pageMode: 'sideways',
    theme: 'neon',
    deeplPlan: 'enterprise',
    selectionButton: false
  });
  assert.equal(normalized.provider, 'mymemory');
  assert.equal(normalized.targetLang, 'zh-CN');
  assert.equal(normalized.sourceLang, 'auto');
  assert.equal(normalized.pageMode, 'replace');
  assert.equal(normalized.theme, 'auto');
  assert.equal(normalized.deeplPlan, 'free');
  assert.equal(normalized.selectionButton, false);

  const kept = PT.normalizeSettings({ provider: 'tencent', targetLang: 'ja', pageMode: 'replace', theme: 'dark' });
  assert.equal(kept.provider, 'tencent');
  assert.equal(kept.targetLang, 'ja');
  assert.equal(kept.pageMode, 'replace');
  assert.equal(kept.theme, 'dark');

  const bilingual = PT.normalizeSettings({ pageMode: 'bilingual' });
  assert.equal(bilingual.pageMode, 'bilingual', 'an explicit bilingual choice is preserved');
});

test('provider validation explains what is missing', () => {
  const { PT } = withPT();
  const base = PT.defaultSettings();

  assert.equal(PT.validateProvider(base), null, 'keyless is ready to use');
  assert.equal(PT.validateProvider({ ...base, provider: 'google' }), null);

  const azure = PT.validateProvider({ ...base, provider: 'azure' });
  assert.equal(azure.code, 'config');
  assert.match(azure.message, /微软/);
  assert.ok(azure.hint.includes('设置'));
  assert.equal(PT.validateProvider({ ...base, provider: 'azure', azureKey: '  ' }).code, 'config');
  assert.equal(PT.validateProvider({ ...base, provider: 'azure', azureKey: 'k' }), null);

  assert.match(PT.validateProvider({ ...base, provider: 'aliyun' }).message, /AccessKey ID/);
  assert.equal(
    PT.validateProvider({ ...base, provider: 'aliyun', aliyunKeyId: 'id', aliyunKeySecret: 'secret' }),
    null
  );

  assert.match(PT.validateProvider({ ...base, provider: 'tencent' }).message, /SecretId/);
  assert.equal(
    PT.validateProvider({ ...base, provider: 'tencent', tencentSecretId: 'id', tencentSecretKey: 'key' }),
    null
  );

  assert.match(PT.validateProvider({ ...base, provider: 'deepl' }).message, /DeepL API Key/);
  assert.equal(PT.validateProvider({ ...base, provider: 'deepl', deeplKey: 'x' }), null);

  assert.match(PT.validateProvider({ ...base, provider: 'libre', libreUrl: '' }).message, /服务地址/);
  assert.equal(PT.validateProvider({ ...base, provider: 'libre', libreUrl: 'libretranslate.local' }), null);

  assert.match(PT.validateProvider({ ...base, provider: 'openai', openaiBaseUrl: '' }).message, /接口地址/);
  assert.match(
    PT.validateProvider({ ...base, provider: 'openai', openaiModel: ' ' }).message,
    /模型名称/
  );
  assert.equal(PT.validateProvider({ ...base, provider: 'openai', openaiKey: 'sk' }), null);
});

test('endpoint normalisation adds a scheme and trims slashes', () => {
  const { PT } = withPT();
  assert.equal(PT.normalizeEndpoint('libretranslate.com/'), 'https://libretranslate.com');
  assert.equal(PT.normalizeEndpoint('  http://localhost:5000//  '), 'http://localhost:5000');
  assert.equal(PT.normalizeEndpoint(''), '');
});

test('text normalisation and splitting never lose content', () => {
  const { PT } = withPT();
  assert.equal(PT.normalizeText('  Hello\u00a0\n  world \t '), 'Hello world');
  assert.equal(PT.normalizeText(null), '');

  const long = Array.from({ length: 40 }, (_, index) => 'Sentence number ' + index + '.').join(' ');
  const parts = PT.splitText(long, 120);
  assert.ok(parts.length > 1);
  parts.forEach((part) => assert.ok(part.length <= 120, 'part fits: ' + part.length));
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));

  const cjk = '这是一段没有标点符号的中文文本'.repeat(20);
  const cjkParts = PT.splitText(cjk, 100);
  assert.equal(cjkParts.join(''), cjk);

  // splitByBytes enforces a floor of 20 bytes so tiny budgets stay useful.
  const bytes = PT.splitByBytes('hello world this is a longer text', 24);
  assert.ok(bytes.length > 1);
  bytes.forEach((part) => assert.ok(Buffer.byteLength(part) <= 24, 'byte budget'));
  assert.equal(bytes.join(''), 'hello world this is a longer text');

  const mixed = PT.splitByBytes('中文abc中文中文abc中文', 24);
  mixed.forEach((part) => assert.ok(Buffer.byteLength(part) <= 24));
  assert.equal(mixed.join(''), '中文abc中文中文abc中文');
});

test('local language detection and translate-worthiness', () => {
  const { PT } = withPT();
  assert.equal(PT.detectLanguage('Hello there, how are you?'), 'en');
  assert.equal(PT.detectLanguage('这是一个简单的句子。'), 'zh-CN');
  assert.equal(PT.detectLanguage('這是一個簡單的句子。'), 'zh-TW');
  assert.equal(PT.detectLanguage('こんにちは世界'), 'ja');
  assert.equal(PT.detectLanguage('안녕하세요'), 'ko');
  assert.equal(PT.detectLanguage('Привет мир'), 'ru');
  assert.equal(PT.detectLanguage(''), '');

  assert.equal(PT.shouldTranslate('Hello world', 'zh-CN'), true);
  assert.equal(PT.shouldTranslate('Hello world', 'en'), false, 'same language');
  assert.equal(PT.shouldTranslate('你好世界', 'zh-CN'), false);
  assert.equal(PT.shouldTranslate('a', 'zh-CN'), false, 'too short');
  assert.equal(PT.shouldTranslate('https://example.com/a/b', 'zh-CN'), false);
  assert.equal(PT.shouldTranslate('user@example.com', 'zh-CN'), false);
  assert.equal(PT.shouldTranslate('12345', 'zh-CN'), false, 'no letters');
  assert.equal(PT.shouldTranslate('读取', 'en'), false, 'no latin letters for an English target');
});

test('errors serialise with a usable hint', () => {
  const { PT } = withPT();
  const error = new PT.ProviderError('auth', '密钥无效', { provider: 'azure', detail: '401' });
  // The script runs in its own vm realm, so `instanceof Error` does not hold.
  assert.equal(error.name, 'ProviderError');
  assert.equal(typeof error.message, 'string');

  const serialized = PT.serializeError(error);
  assert.equal(serialized.code, 'auth');
  assert.equal(serialized.message, '密钥无效');
  assert.equal(serialized.provider, 'azure');
  assert.equal(serialized.detail, '401');
  assert.match(serialized.hint, /密钥/);

  const unknown = PT.serializeError(new Error('boom'));
  assert.equal(unknown.code, 'unknown');
  assert.equal(unknown.message, 'boom');
  assert.ok(unknown.hint.length > 0);
});

test('storage round-trip and change notifications', async () => {
  const browser = createBrowserStub();
  const context = createSandbox({ browser });
  const PT = loadPT(context);

  const initial = await PT.loadSettings();
  assert.equal(initial.provider, 'mymemory');
  assert.equal(initial.targetLang, 'zh-CN');

  await PT.saveSettings({ ...initial, provider: 'tencent', targetLang: 'ja' });
  const stored = await PT.loadSettings();
  assert.equal(stored.provider, 'tencent');
  assert.equal(stored.targetLang, 'ja');
  assert.equal(browser.storage.data.settings.provider, 'tencent');

  const updated = await PT.updateSettings({ targetLang: 'de' });
  assert.equal(updated.targetLang, 'de');
  assert.equal(updated.provider, 'tencent', 'update keeps other keys');

  const seen = [];
  const off = PT.onSettingsChanged((settings) => seen.push(settings.targetLang));
  await PT.updateSettings({ targetLang: 'ko' });
  await wait(5);
  off();
  await PT.updateSettings({ targetLang: 'fr' });
  await wait(5);
  assert.ok(seen.includes('ko'));
  assert.ok(!seen.includes('fr'), 'listener was removed');
});

test('clipboard helper falls back to execCommand', async () => {
  const { JSDOM } = await import('./support.mjs').then((m) => m.loadJsdom());
  const dom = new JSDOM('<!doctype html><body></body>');
  const copied = [];
  dom.window.document.execCommand = (command) => {
    copied.push(command);
    return true;
  };
  const context = createSandbox({ document: dom.window.document, navigator: {}, browser: createBrowserStub() });
  const PT = loadPT(context);
  assert.equal(await PT.copyText('你好'), true);
  assert.deepEqual(copied, ['copy']);
  assert.equal(dom.window.document.querySelectorAll('textarea').length, 0, 'temporary node is removed');
});

test('Safari probe ignores Chromium user agents', async () => {
  const safari = createSandbox({
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', language: 'zh-CN' }
  });
  assert.equal(loadPT(safari).isSafari(), true);

  const chrome = createSandbox({
    navigator: { userAgent: 'Mozilla/5.0 Chrome/130.0 Safari/537.36', language: 'zh-CN' }
  });
  assert.equal(loadPT(chrome).isSafari(), false);
});
