# Safari Translator — Selection & Page Translation

A native Safari Web Extension (Manifest V2) that translates **only when you ask it to**.

> This is an independent project, not affiliated with Apple Inc. “Safari” is a trademark of Apple Inc., used here only to identify the host browser.

- Select text → a floating **翻译** (Translate) button appears next to the selection
- Right-click → translate the selection, translate the whole page using the saved mode, or restore the original
- Whole-page translation handles the visible viewport first and fills in offscreen content in the background
- Works with Microsoft Translator, Alibaba Cloud, Tencent Cloud, DeepL, LibreTranslate, OpenAI-compatible APIs, plus keyless MyMemory and Google Translate
- All network requests are made by the background page; content scripts only read the page and render results

[中文说明](README.md) · [Interactive demo](demo/preview.html)

[![Download DMG](https://img.shields.io/github/v/release/xlab6/safari-translator?style=for-the-badge&label=Download%20DMG&color=blue)](https://github.com/xlab6/safari-translator/releases/latest/download/Safari-Translator.dmg)

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Translation providers](#translation-providers)
- [Privacy and security](#privacy-and-security)
- [Permissions](#permissions)
- [How it works](#how-it-works)
- [Development](#development)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

---

## Features

### Selection translation

Select text on a page and a small button appears beside the selection. Click it to translate; the result opens in a floating panel.

- No request is sent on page load, scroll, or selection alone — only after you click the button or a context-menu item
- The panel shows the original text, detected language, provider, and translation
- Speak, copy, change the target language, retry, or open settings from the panel
- Selections longer than 5,000 characters do not show the floating button
- The floating button can be disabled in settings; the context menu still works

### Context menu

Right-click anywhere on a page:

| Menu item (Chinese UI) | Action |
| --- | --- |
| 翻译所选文字 | Translate the current selection |
| 翻译此页面 | Translate the page using the saved default mode (replace by default) |
| 还原原文 | Remove inserted translations or restore replaced text |
| 翻译设置… | Open the options page |

The menu appears on web content only, not on Safari internal pages or extension pages.

### Whole-page translation

- **Bilingual mode** inserts a translated block under each paragraph, with a subtle left rule
- **Replace mode** swaps text nodes in place and can be restored
- Replace mode is the default; switch to bilingual mode in Settings. Both the context menu and the toolbar popup follow this setting.
- Skips `script`, `style`, `code`, `pre`, `textarea`, editable regions, hidden elements, and already translated nodes
- Translates the visible viewport first, then fills in offscreen content in the background (~450 ms later); nearby blocks are promoted as you scroll
- Batches 8 units / 2,600 characters, with up to 3 concurrent requests; shows progress and a Cancel button
- Processes at most 400 blocks or 700 text nodes per run
- Reuses translations for repeated strings; failures leave the original text untouched

### Toolbar popup

Click the extension icon in Safari's toolbar to:

- See the current provider, target language, and status
- Translate the page using the saved mode (replace by default), switch to the other mode, or restore it
- Toggle the selection button
- Change the target language (saved immediately)
- Open the full settings page

> If the icon is hidden: Safari → View → Customize Toolbar, then drag Safari Translator into the toolbar. The context menu works without the toolbar icon.

### Settings

Changes are saved automatically (450 ms debounce) and pushed to open tabs:

- **Providers**: eight cards marked keyless / key required / self-hosted
- **Provider configuration**: fields for the selected provider and a **Test translation** button
- **Languages**: source (auto-detect by default) and target
- **Page translation**: default mode (replace / bilingual), selection button, theme (auto / light / dark)
- **Privacy and security**: explains how keys are stored
- **Other**: reset to defaults and version information

---

## Installation

### Requirements

- macOS 13 or later (latest macOS recommended)
- Xcode 15 or later (built with Xcode 27.1 for this project)
- Safari 16.4 or later

### Direct download (preview)

[Download the latest Safari Translator DMG](https://github.com/xlab6/safari-translator/releases/latest/download/Safari-Translator.dmg)

The current release is signed with an `Apple Development` certificate and is **not notarized by Apple**. On first launch, if macOS says it cannot verify the developer:

- Right-click **Safari Translator** in Applications → **Open** → **Open** again; or
- Run:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Safari Translator.app"
  ```

> This is a preview build. A double-click-to-open experience with no security prompt requires a paid Apple Developer Program membership, a `Developer ID Application` certificate, and Apple notarization; see “Signing, notarization and the DMG” below.

### Build from source

1. Open the project:

   ```bash
   open "xcode/Safari Translator/Safari Translator.xcodeproj"
   ```

2. In Xcode, select the **Safari Translator** project → **Signing & Capabilities**:
   - Choose the same Team for both **Safari Translator** and **Safari Translator Extension**
   - If `cn.oxzz.safari-translator` is unavailable, use your own reverse-DNS identifier, for example `com.yourname.safaritranslator`
   - The extension identifier **must** be the app identifier plus a suffix, for example `com.yourname.safaritranslator.Extension`. Otherwise Xcode fails with `Embedded binary's bundle identifier is not prefixed with the parent app's bundle identifier`.
   - The welcome window reads the extension identifier from the embedded `.appex`, so changing the bundle identifiers needs no Swift edit.
3. Select the **Safari Translator** scheme, choose **My Mac**, and press `⌘R`.
4. A welcome window appears. Click **打开 Safari 扩展设置** (Open Safari extension settings).
5. Enable the extension:
   - **Safari → Settings → Extensions**, check **Safari Translator**
   - Allow access to websites when prompted (always, or per site)
6. Open any web page and select text or right-click to start.

> Safari lists the extension only after the host app has been launched at least once and the extension is signed. If it does not appear, verify the Safari version, make sure the app launched successfully, and reopen Safari settings.

### Command-line build (compile check only)

```bash
cd "xcode/Safari Translator"
xcodebuild -project "Safari Translator.xcodeproj" \
  -scheme "Safari Translator" \
  -configuration Debug \
  -derivedDataPath "$PWD/build/dd" \
  SYMROOT="$PWD/build/products" \
  OBJROOT="$PWD/build/obj" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

This produces an unsigned `build/products/Debug/Safari Translator.app` and is only useful to verify that the project compiles. **Use Xcode with a signing team for an installable build**; Safari will not load an unsigned extension.

> If `xcodebuild` reports `You don't have permission to save ... XCBuildData/PIFCache`, Xcode's DerivedData or build location points to a read-only or network volume. The `SYMROOT`, `OBJROOT`, and `-derivedDataPath` flags above redirect intermediates into the project. You can also reset the locations in Xcode → Settings → Locations.

### Signing, notarization and the DMG

> A double-click-to-open experience with no Gatekeeper prompt requires a **paid Apple Developer Program** membership, a `Developer ID Application` certificate, and Apple notarization. The current GitHub release is a preview signed with an `Apple Development` certificate; it is not notarized and needs the first-launch steps above. Use this section to produce a proper distribution build.

1. In Xcode → Settings → Accounts → Manage Certificates, create a **Developer ID Application** certificate, or import an existing `.p12`.
2. Store notarization credentials in a keychain profile (use an app-specific password, not your Apple ID password):

   ```bash
   xcrun notarytool store-credentials "safari-translator-notary" \
     --apple-id "you@example.com" \
     --team-id "YOUR_TEAM_ID" \
     --password "xxxx-xxxx-xxxx-xxxx"
   ```

3. Build, sign, notarize and package:

   ```bash
   DEVELOPMENT_TEAM="YOUR_TEAM_ID" \
   DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (YOUR_TEAM_ID)" \
   NOTARY_PROFILE="safari-translator-notary" \
   npm run release:dmg
   ```

The script signs the app and embedded `.appex`, notarizes and staples the app, creates and signs the DMG, notarizes and staples the DMG, and writes the DMG plus its SHA-256 to `dist/`. Set `NOTARIZE=0` for a local-only signed build, but it will still be blocked by Gatekeeper and is only suitable as a preview.

### Regenerating the Xcode project

The project is already generated; regeneration is rarely needed. If you change the manifest substantially or add/remove extension files:

```bash
xcrun safari-web-extension-converter ./extension \
  --project-location ./xcode \
  --app-name "Safari Translator" \
  --bundle-identifier cn.oxzz.safari-translator \
  --swift --macos-only --no-open --no-prompt --force
```

Regeneration **overwrites** the welcome page, `ViewController.swift`, bundle identifiers, and icons. Commit or back up `xcode/` first.

---

## Usage

### Translate a selection

1. Select text with the mouse or keyboard.
2. Click the **翻译** button next to the selection.
3. Read the result; speak, copy, change the target language, or retry.

You can also select text and choose **翻译所选文字** from the context menu. The context menu is the reliable fallback if a page interferes with the floating button.

### Translate a page

- Right-click → **翻译此页面** to translate the page using the saved default mode.
- Right-click → **还原原文** to restore the page.

To use the other mode, click the alternate button in the toolbar popup or change the default in Settings. Both modes can be restored at any time.

A progress bar with a Cancel button appears at the bottom-right. Translations do not survive a page reload.

### Keyboard shortcut

There is no global shortcut, to avoid conflicts with Safari. Everything is triggered from the context menu, toolbar popup, or floating button.

### Demo page

You can preview the interaction without installing the extension:

```bash
python3 -m http.server 8080
# open http://localhost:8080/demo/preview.html
```

The demo uses a local glossary and **never makes network requests**. It loads the same `content.js` with a fake `browser` object to demonstrate the selection button, bilingual insertion, replace mode, and restore. Opening `demo/preview.html` directly may work, but some browsers restrict scripts over `file://`; a local server is recommended.

---

## Translation providers

Configure them in **Safari → Settings → Extensions → Safari Translator → 翻译设置**, or right-click → **翻译设置…**.

| Provider | Key required | Default endpoint | Notes |
| --- | --- | --- | --- |
| MyMemory | No | `api.mymemory.translated.net` | Default; good for trying things out; daily quota |
| Google Translate | No | `translate.googleapis.com` | Unofficial public endpoint; may break; usually unreachable from mainland China |
| Microsoft Translator | Yes | `api.cognitive.microsofttranslator.com` | Azure AI Translator resource; stable; supports auto-detect |
| Alibaba Cloud MT | Yes | `mt.aliyuncs.com` | AccessKey ID / Secret; pay per character |
| Tencent Cloud TMT | Yes | `tmt.tencentcloudapi.com` | SecretId / SecretKey; pay per character |
| DeepL | Yes | Free / Pro endpoints | High quality; Free and Pro keys are not interchangeable |
| LibreTranslate | Depends on instance | Custom | Self-hostable; public instances usually need an API key |
| OpenAI-compatible | Depends on service | Custom | Chat Completions prompt translation; OpenAI, DeepSeek, Ollama, etc. |

### MyMemory (default, no key)

Works out of the box. When the source language is set to auto-detect, the extension detects the language locally and sends an explicit `source|target` pair.

- Limited free quota; long pages may be throttled
- Variable quality; suitable for demos and light use
- Avoid sensitive pages

### Google Translate (no key)

Uses the public `translate.googleapis.com/translate_a/single` endpoint. No key required.

- Not an official paid Google API; no SLA; may change or block requests
- Usually unreachable from mainland China (timeouts / `request` errors)
- Prefer Microsoft, Alibaba Cloud, or Tencent Cloud if you are in mainland China

### Microsoft Translator (Azure)

1. Create a **Translator** resource in the [Azure portal](https://portal.azure.com/) (free F0 or paid tier).
2. Open the resource → **Keys and endpoint**, copy the **Key** and **Region**.
3. In the extension settings, choose **Microsoft Translator** and fill in:
   - **订阅密钥（Key）**: required
   - **区域（Region）**: required for multi-region resources, e.g. `eastasia`; may be blank for single-region resources
   - **服务端点**: default `https://api.cognitive.microsofttranslator.com`
4. Click **测试翻译** (Test translation).

The free tier has a monthly character quota; Azure rejects requests after it is exhausted. Check the Azure portal for current limits.

### Alibaba Cloud Machine Translation

1. Activate **Machine Translation** in the Alibaba Cloud console.
2. Create a RAM user with `AliyunMTFullAccess` (or equivalent) and generate an AccessKey.
3. In the extension settings, choose **阿里云机器翻译** and fill in:
   - **AccessKey ID**: required, usually starts with `LTAI`
   - **AccessKey Secret**: required
   - **地域 ID**: default `cn-hangzhou`
4. Click **测试翻译**.

Use a least-privilege RAM user rather than the root account. Requests use RPC signature (HMAC-SHA1); keys stay in local browser storage.

### Tencent Cloud Machine Translation

1. Activate **TMT** in the Tencent Cloud console.
2. Create a SecretId / SecretKey under **Access Management → API Key Management**; use a TMT-only sub-account.
3. In the extension settings, choose **腾讯云机器翻译** and fill in:
   - **SecretId**: required, usually starts with `AKID`
   - **SecretKey**: required
   - **地域**: default `ap-guangzhou`
4. Click **测试翻译**.

Requests use TC3-HMAC-SHA256; each request is limited to roughly 1,800 characters, and the extension splits longer text automatically.

### DeepL

1. Sign up for a Free or Pro plan at [DeepL API](https://www.deepl.com/pro-api).
2. Copy the API key.
3. In the extension settings, choose **DeepL**, paste the key, and select the matching plan:
   - **Free**: `api-free.deepl.com`, 500,000 characters/month
   - **Pro**: `api.deepl.com`
4. Click **测试翻译**.

Using a Free key with the Pro endpoint (or vice versa) returns 403. Some target languages use uppercase special codes (`ZH-HANS`, `ZH-HANT`, `PT-PT`); the extension maps them automatically.

### LibreTranslate

1. Prepare a LibreTranslate instance, public or self-hosted.
2. In the extension settings, choose **LibreTranslate** and fill in:
   - **服务地址**: e.g. `https://libretranslate.com` or `http://localhost:5000`
   - **API Key（可选）**: usually required for public instances; blank for self-hosted
3. Click **测试翻译**.

Language coverage varies by instance. The extension maps some codes to LibreTranslate's conventions (for example, Traditional Chinese uses `zt`).

### OpenAI-compatible APIs

Works with any service that implements OpenAI Chat Completions:

- OpenAI: `https://api.openai.com/v1`, model such as `gpt-4o-mini`
- DeepSeek: `https://api.deepseek.com/v1`, model `deepseek-chat`
- Ollama: `http://localhost:11434/v1`, an installed model such as `qwen2.5:7b`, blank key
- Other compatible gateways: enter the base URL and model name

Settings:

- **接口地址**: the base URL ending at `/v1`, without `/chat/completions`
- **API Key**: may be blank for local services
- **模型**: required

Translation is prompt-based, so speed and cost depend on the model. Long text is split into chunks; output may be more paraphrased than traditional MT.

### Test translation

**测试翻译** sends `Hello, world!` to the selected provider and shows:

- Success: provider, elapsed time, and a preview of the translation
- Failure: the error plus a hint (key, region, quota, network, etc.)

Test requests bypass the translation cache and are never saved to settings.

### Language codes

The extension uses BCP 47-style codes internally (`zh-CN`, `zh-TW`, `en`, `ja`) and maps them per provider:

| Extension | Azure | Tencent | Alibaba | DeepL |
| --- | --- | --- | --- | --- |
| `zh-CN` | `zh-Hans` | `zh` | `zh` | `ZH-HANS` |
| `zh-TW` | `zh-Hant` | `zh_TW` | `zh-tw` | `ZH-HANT` |
| `pt` | `pt` | `pt` | `pt` | `PT-PT` |

With auto-detect: MyMemory detects the language locally and sends an explicit source; Azure, DeepL, Google, and others use their own auto-detection.

---

## Privacy and security

### What is sent

- **Selection**: only the selected text
- **Whole page**: the extracted text blocks (code, scripts, inputs, and hidden elements are skipped)
- **Test translation**: the fixed string `Hello, world!`

Text goes to the provider you selected. Read that provider's privacy policy first. For confidential documents, personal data, or unpublished material, check the terms or use a self-hosted LibreTranslate / local Ollama.

### How keys are stored

- Keys live in `browser.storage.local` (Safari extension local storage)
- **They are not encrypted and are not stored in the macOS Keychain.** Anyone who can access your user profile or browser data can read them.
- Use least-privilege sub-account keys that can only call translation APIs, and rotate them regularly
- Do not store long-lived keys on a shared Mac
- Keys are sent only to the selected provider; there is no telemetry, analytics, or remote configuration

### Local processing

- Language detection, chunking, and caching happen locally
- Speech uses the system `speechSynthesis`; copy uses the clipboard API; neither contacts this project's servers
- The translation cache is in-memory in the background page, capped at 600 entries, and cleared when the browser restarts
- Page translations exist only in the current DOM and disappear on reload

### No remote code

The extension loads no remote scripts, uses no `eval`, and injects no third-party iframes. All logic is packaged in the extension.

---

## Permissions

`extension/manifest.json` requests:

| Permission | Purpose |
| --- | --- |
| `storage` | Save provider settings, languages, appearance |
| `contextMenus` | Create the right-click menu |
| `*://*/*` | Inject the selection button, read selections, translate pages; also lets the background page call provider APIs without CORS issues |

The extension does **not** request `tabs`. It uses the host permission to locate the active tab, inject content scripts, and send messages, and only reads page content after a user action. Safari still shows a per-site access prompt.

To limit access, change **Safari → Settings → Extensions → Safari Translator → Website access** to **Allow on specific websites**.

---

## How it works

```
User action (floating button / context menu / popup)
        │
        ▼
content.js (page context)
  ├─ read selection or walk page text
  ├─ split, deduplicate, cache
  └─ browser.runtime.sendMessage({ __pt: true, type: 'pt:translate', ... })
        │
        ▼
background.js (the only network caller)
  ├─ load and validate settings
  ├─ PT.translate(settings, text)
  └─ providers.js → fetch(provider API)
        │
        ▼
content.js renders translation / error / progress
```

Design notes:

- **Background requests**: `host_permissions` covers all sites, so the background page can call provider APIs without page CORS restrictions; content scripts never see keys
- **Explicit only**: no `MutationObserver` auto-translation and no translate-on-load; every request starts from a click
- **`__pt` message marker**: the background ignores messages without it, avoiding collisions with page `postMessage` traffic or other extensions
- **Provider adapters**: `providers.js` centralizes signing, language mapping, chunking, timeouts (20 s; 45 s for OpenAI), and error normalization
- **Graceful failure**: missing configuration returns a `config` error and points to settings instead of failing silently

---

## Development

### Requirements

- Node.js 20+ (tests use global `fetch`, `crypto`, `AbortController`)
- Python 3 with Pillow and numpy (only for regenerating icons)
- Xcode (only for building the Safari host app)

### Install dependencies

```bash
npm install
```

Only `jsdom` (for tests) is installed. The extension has no runtime dependencies and no build step.

### Commands

```bash
npm test          # node --test tests/, 88 tests
npm run lint      # validate manifest, icons, script references
npm run check:js  # node --check on every extension script
npm run check     # lint + syntax check + tests
npm run icons     # regenerate extension icons
```

Generate the Xcode AppIcon as well:

```bash
npm run icons -- --xcode "xcode/Safari Translator/Safari Translator"
```

If the system Python lacks Pillow:

```bash
python3 -m venv .venv
.venv/bin/pip install pillow numpy
.venv/bin/python scripts/build-icons.py --xcode "xcode/Safari Translator/Safari Translator"
```

### After changing files

- Changes under `extension/` are picked up by rebuilding in Xcode. The project references `../../../extension/*` directly, so no regeneration is needed.
- Changes to content script lists, permissions, or icons in `manifest.json`: disable and re-enable the extension in Safari, or restart Safari.
- New extension files: add them to the **Safari Translator Extension** target in Xcode, or regenerate the project (which overwrites manual changes).

### Tests

The tests use `node:test` + jsdom and never hit the network:

- `tests/common.test.mjs`: language mapping, settings validation, text splitting, error serialization
- `tests/providers.test.mjs`: request construction, signing, splitting, error mapping for all eight providers
- `tests/background.test.mjs`: menus, message routing, concurrency
- `tests/content.test.mjs`: selection, bilingual/replace/restore, progress, errors
- `tests/ui.test.mjs`: popup and options rendering, saving, reset, test translation

jsdom is resolved from `PT_JSDOM` or a sibling project's `node_modules/jsdom`.

---

## Known limitations

- **No automatic translation** — by design
- No iframe support (`all_frames: false`); Safari Reader, PDFs, extension pages, and browser internal pages are out of scope
- Infinite-scroll pages only translate content that exists when you trigger translation; new content requires another run
- SPA route changes do not clean up inserted translations; reload or use **还原原文**
- Whole-page translation is capped at 400 blocks / 700 text nodes; long pages may be partially translated
- Bilingual mode inserts `<span data-pt-translation>` elements, which can affect rare layouts that depend on `:last-child` or fixed heights
- Translations are inserted as plain text; inline formatting from the original (bold, links, etc.) is not preserved in translated blocks
- Translations disappear on reload; the background cache is cleared when the browser restarts
- Google Translate uses an unofficial endpoint and may stop working; it is usually unreachable from mainland China
- OpenAI-compatible output quality and speed vary by model and are not suitable for strict terminology
- Keys are stored in plaintext in `storage.local`; avoid shared devices
- macOS Safari host only; no iOS/iPadOS target
- Manifest V2; porting to Chrome/Edge requires changes to `browser_action`, `background`, and the permission model

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Safari Translator is missing from Safari extensions | App never launched, unsigned, or Safari too old | Run a signed build from Xcode; check macOS/Safari versions; reopen Safari settings |
| No translation items in the context menu | Extension disabled, page is not http/https, or site access denied | Enable it in Safari settings; allow the site; reload the page |
| The old two page-translation entries remain after updating | Safari cached the old extension | Quit Safari completely (⌘Q) and reopen it; if that fails, disable and re-enable Safari Translator in Safari settings |
| No floating button after selecting text | Selection button disabled, selection over 5,000 chars, or page blocks scripts | Check the setting; use the context menu; reload |
| “翻译服务未配置” | The selected provider needs a key | Open settings → provider configuration, enter the key, test the connection |
| “密钥无效或权限不足” | Wrong key/region or insufficient permissions | Check Key/Region and sub-account permissions; Azure multi-region resources require a region |
| Rate-limit or quota errors | Free quota exhausted or throttled | Switch providers, reduce page translation, check the provider quota |
| Google Translate always times out | Network cannot reach Google | Use Microsoft, Alibaba Cloud, Tencent Cloud, or MyMemory |
| Microsoft test returns 401 | Wrong key or region | Copy them again from the Azure portal; multi-region resources need a region |
| Alibaba signature error | Wrong AccessKey or large clock skew | Check the AccessKey; sync the system clock |
| Tencent signature error | Wrong SecretId/SecretKey or region | Regenerate credentials; confirm TMT is activated |
| DeepL returns 403 | Free/Pro plan mismatch | Match the key to its plan |
| Only part of a page is translated | Hit the 400-block / 700-node cap, or some batches failed | Check the progress toast; retry or translate in smaller pages |
| Page layout breaks | Bilingual mode inserted block-level translations | Use replace mode or restore the page |
| Settings changes do not apply | The tab predates the change, or saving failed | Reload the page; confirm the settings page says saved |
| “无法保存设置” | Safari storage cleared, private browsing, or disk full | Exit private browsing; restart Safari; check free disk space |
| `xcodebuild` permission error | DerivedData points to a read-only location | Use the `SYMROOT` / `OBJROOT` / `-derivedDataPath` flags above |

For deeper debugging, enable Safari → Develop → Show Web Inspector and inspect the extension's background page and content scripts.

---

## Project layout

```
safari-translator/
├── extension/                 # The extension itself, no build step
│   ├── manifest.json          # MV2 manifest
│   ├── common.js              # Languages, settings, splitting, storage, errors
│   ├── providers.js           # Eight provider adapters and signatures
│   ├── background.js          # Context menus, routing, concurrency, injection
│   ├── content.js             # Selection button, result panel, page translation
│   ├── content.css            # Fallback styles and print hiding
│   ├── popup.html/.css/.js    # Toolbar popup
│   ├── options.html/.css/.js  # Settings page
│   └── icons/                 # 16–512 px icons
├── demo/
│   ├── preview.html           # Interactive demo (local glossary, offline)
│   ├── demo.css
│   └── demo.js                # Fake browser API
├── xcode/
│   └── Safari Translator/       # Generated macOS host app
│       ├── Safari Translator.xcodeproj
│       └── Safari Translator/
│           ├── AppDelegate.swift
│           ├── ViewController.swift
│           ├── Base.lproj/Main.storyboard
│           ├── Resources/     # Welcome page and icon
│           └── Assets.xcassets
├── scripts/
│   ├── build-icons.py         # Extension and Xcode icons
│   └── lint-manifest.js       # Manifest and asset checks
├── tests/                     # node:test + jsdom
├── package.json
└── README.md
```

---

## Acknowledgements

The project structure follows [json-viewer-safari](../json-viewer-safari): an Xcode host app, a plain-JS Safari Web Extension, and a converter-generated project.

Translation services are operated by their respective providers. This project is not affiliated with Microsoft, Alibaba Cloud, Tencent Cloud, DeepL, Google, or OpenAI.
