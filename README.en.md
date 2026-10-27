# Safari Translator — Selection & Page Translation

A native Safari web extension for whole-page translation, selection translation, and bilingual reading, with support for 8 translation services.

> This is an independent project, not affiliated with Apple Inc. “Safari” is a trademark of Apple Inc., used here only to identify the host browser.

- Translate a whole page with one click; the site is remembered, so later in-site navigation is translated automatically
- Select text → a floating **翻译** (Translate) button appears next to the selection
- Right-click → translate the selection, translate the page, or restore the original
- Previously translated text is cached locally and reused after restarting Safari — no extra provider quota
- Works with Microsoft Translator, Alibaba Cloud, Tencent Cloud, DeepL, LibreTranslate, and OpenAI-compatible APIs, plus keyless MyMemory and Google Translate

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
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Recommended project](#recommended-project)

---

## Features

### Page translation

- Click **Translate this page** in the toolbar popup or the right-click menu
- The site is remembered afterwards: in-site navigation (including single-page app route changes) is translated automatically
- In-site navigation only processes new or changed text; unchanged areas such as sidebars are not retranslated
- **Restore original** brings the page back and stops automatic translation for that site
- **Replace**: replace page text directly for quick reading; **Bilingual**: insert translations below the original for side-by-side reading
- Replace is the default and can be changed in settings
- Visible content is translated first; the rest follows in the background, with progress shown in the bottom-right corner and a cancel button
- Code blocks, inputs, editable areas, and hidden content are skipped; a failed translation never damages the original page
- Identical text already translated is reused from the local cache instead of being requested again

### Selection translation

Select a piece of text on a page and a small button appears next to the selection. Click it to show the translation in a floating panel.

- The panel shows the original text, detected language, current provider, and translation
- Read the translation aloud, copy it, switch the target language, retry, or open settings
- The panel follows the selected text while the page scrolls
- Selections longer than 5000 characters do not show the floating button
- The floating button can be disabled in settings; the right-click menu still works

### Right-click menu

| Item | Behavior |
| --- | --- |
| Translate selection | Translate the selected text (prompts when nothing is selected) |
| Translate this page | Translate the whole page using the saved default mode (replace) |
| Restore original | Remove inserted translations or restore replaced text |
| Translation settings… | Open the extension settings page |

The menu only appears in web content, not on Safari internal pages or extension pages.

### Toolbar popup

Click the extension icon in the Safari toolbar:

- View and switch the translation provider and target language
- **Translate this page** (saved mode), switch to the other mode, or restore the original
- Toggle the selection button
- Open the full settings page

> No toolbar icon? Safari → View → Customize Toolbar, then drag Safari Translator onto the toolbar. The icon is optional; the right-click menu always works.

### Settings

Changes are saved automatically and synced to open tabs:

- **Providers**: 8 cards marked “No key”, “Key required”, or “Self-hosted”
- **Provider configuration**: fields for the selected service, plus **Test translation**
- **Languages**: source (auto-detect by default) and target
- **Page translation**: default mode (replace / bilingual), selection button, light / dark / system appearance
- **Other**: reset to defaults, GitHub repository, version

---

## Installation

### Requirements

- macOS 13 or later
- Safari 16.4 or later

### Download

[Download the latest Safari Translator DMG](https://github.com/xlab6/safari-translator/releases/latest/download/Safari-Translator.dmg)

Open the DMG, drag Safari Translator to Applications, and launch it once. If macOS says the developer cannot be verified (the package is not notarized by Apple):

- In Applications, right-click **Safari Translator** → **Open** → **Open** again; or
- Run:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Safari Translator.app"
  ```

Then enable **Safari Translator** in **Safari → Settings → Extensions** and allow access to websites when prompted.

### Build from source

Requires Xcode 15 or later.

1. Open `xcode/Safari Translator/Safari Translator.xcodeproj`
2. Select the same Team for both **Safari Translator** and **Safari Translator Extension**
3. Choose the **Safari Translator** scheme and **My Mac**, then press `⌘R`
4. Enable the extension in Safari settings and allow website access

If you change the bundle identifier, the extension identifier must be the app identifier plus a suffix (for example `com.yourname.safaritranslator.Extension`), or Xcode will refuse to build.

> Safari only lists the extension after the host app has run at least once and the extension is signed. If it is missing, check the Safari version and that the app launched, then reopen Safari settings.

---

## Usage

### Translate a whole page

1. Open a web page
2. Click the toolbar icon → **Translate this page**, or right-click → **Translate this page**
3. To switch modes, use the other button in the popup or change the default in settings

The site is remembered after translation: links and single-page app navigation within the same site are translated automatically. **Restore original** brings the page back and stops automatic translation for that site.

### Translate selected text

1. Select text with the mouse or keyboard
2. Click the **翻译** button next to the selection
3. Read the translation; you can listen, copy, switch the target language, or retry

You can also right-click → **Translate selection**. If a page blocks the floating button, the context menu is a reliable alternative.

### Demo

You can preview the interaction without installing the extension:

```bash
python3 -m http.server 8080
# open http://localhost:8080/demo/preview.html
```

The demo uses a local dictionary and does not access the network.

---

## Translation providers

Configure at **Safari → Settings → Extensions → Safari Translator → Translation settings**, or right-click → **Translation settings…**.

| Provider | Key required | Default endpoint | Notes |
| --- | --- | --- | --- |
| MyMemory | No | `api.mymemory.translated.net` | Default; good for trials; daily quota |
| Google Translate | No | `translate.googleapis.com` | Unofficial endpoint; may break; usually unreachable in mainland China |
| Microsoft Translator | Yes | `api.cognitive.microsofttranslator.com` | Azure AI Translator; stable; supports glossaries and detection |
| Alibaba Cloud MT | Yes | `mt.aliyuncs.com` | AccessKey ID / Secret; pay per use |
| Tencent Cloud TMT | Yes | `tmt.tencentcloudapi.com` | SecretId / SecretKey; pay per use |
| DeepL | Yes | Free / Pro domains | High quality; Free and Pro keys are not interchangeable |
| LibreTranslate | Depends | Custom | Self-hostable; public instances usually need an API key |
| OpenAI-compatible | Depends | Custom | OpenAI, DeepSeek, Ollama, and other compatible gateways |

### MyMemory (default, no key)

Works out of the box.

- Limited free quota; long pages may be rate-limited
- Quality varies; suitable for demos and light use
- Avoid translating pages that contain private information

### Google Translate (no key)

- Not an official paid Google API; no SLA and may change or be blocked at any time
- Usually unreachable in mainland China, resulting in timeouts or `request` errors
- Prefer Microsoft, Alibaba Cloud, or Tencent Cloud there

### Microsoft Translator (Azure)

1. Create a **Translator** resource in the [Azure portal](https://portal.azure.com/) (free F0 or paid tier)
2. Open the resource → **Keys and endpoint**, copy **Key** and **Region**
3. In the extension, select **Microsoft Translator** and fill in:
   - **Key**: required
   - **Region**: required for multi-region resources (for example `eastasia`); leave empty for single-region resources
   - **Endpoint**: the default is usually fine
4. Click **Test translation** until it succeeds

The free tier has a monthly character quota; Azure rejects requests once it is exhausted.

### Alibaba Cloud Machine Translation

1. Enable **Machine Translation** in the Alibaba Cloud console
2. Create a RAM sub-account with `AliyunMTFullAccess` (or equivalent) and generate an AccessKey
3. In the extension, select **Alibaba Cloud MT** and fill in the AccessKey ID, AccessKey Secret, and region ID (default `cn-hangzhou`)
4. Click **Test translation**

Use a sub-account limited to translation permissions rather than the root account.

### Tencent Cloud Machine Translation

1. Enable **TMT** in the Tencent Cloud console
2. Create a SecretId / SecretKey under **Access Management → API Keys**, preferably for a TMT-only sub-account
3. In the extension, select **Tencent Cloud MT** and fill in the SecretId, SecretKey, and region (default `ap-guangzhou`)
4. Click **Test translation**

### DeepL

1. Sign up for a Free or Pro plan at [DeepL API](https://www.deepl.com/pro-api)
2. Copy the API key
3. In the extension, select **DeepL** and choose the matching plan:
   - **Free**: `api-free.deepl.com`, 500k characters per month
   - **Pro**: `api.deepl.com`
4. Click **Test translation**

A Free key on the Pro endpoint (or vice versa) returns 403.

### LibreTranslate

1. Prepare a LibreTranslate instance, public or self-hosted
2. In the extension, select **LibreTranslate** and enter the server URL (for example `https://libretranslate.com` or `http://localhost:5000`) and an optional API key
3. Click **Test translation**

### OpenAI-compatible APIs

Works with any service that implements OpenAI Chat Completions:

- OpenAI: `https://api.openai.com/v1`, models such as `gpt-4o-mini`
- DeepSeek: `https://api.deepseek.com/v1`, model `deepseek-chat`
- Ollama: `http://localhost:11434/v1`, models such as `qwen2.5:7b`, key optional
- Other gateways: use their Base URL and model name

Settings:

- **Endpoint**: up to `/v1`, without `/chat/completions`
- **API Key**: may be empty for local services
- **Model**: required

Quality and speed depend on the model, and the output may be more paraphrased than traditional translation services.

### Test translation

**Test translation** sends a single `Hello, world!` and shows:

- Success: provider name, latency, and a preview
- Failure: the reason and a suggested fix (key, region, quota, network, etc.)

Test results are not added to the translation cache.

---

## Privacy and security

### What is sent

- **Selection translation**: only the selected text
- **Page translation**: the page segments that need translation (code, scripts, inputs, and hidden content are skipped)
- **Test translation**: the fixed text `Hello, world!`

Text is sent to the translation provider you choose. For confidential, personal, or unreleased material, review that provider’s terms first or use a self-hosted LibreTranslate / local Ollama instance.

### How keys are stored

- Keys are stored in the extension’s local storage and are not uploaded anywhere except to the provider you selected
- Keys are not additionally encrypted; anyone who can access your user profile or browser data can read them
- Prefer least-privilege sub-account keys limited to translation, and rotate them regularly
- Avoid storing long-term keys on shared Macs
- No analytics, telemetry, or remote configuration

### Local data

- **Translated-site record**: determines whether in-site navigation translates automatically; **Restore original** clears it for that site
- **Translation cache**: previously translated text is stored locally and reused after restarting Safari; resetting the extension or restoring defaults clears it
- Translations on a page exist only in that page and disappear on refresh

---

## Permissions

| Permission | Purpose |
| --- | --- |
| Storage | Save provider settings, language, appearance, translated sites, and the translation cache |
| Context menus | Create the translation menu items |
| Access all websites | Show the selection button, read selected text, translate pages, and request your chosen provider |

The extension does not read page content unrelated to translation. To limit it, open Safari → Settings → Extensions → Safari Translator → Website Access and choose **Allow on Specific Websites**.

---

## Known limitations

- Iframes, Safari Reader, PDFs, extension pages, and browser-internal pages are not supported
- Automatic in-site translation only applies within the same site after you have translated it; **Restore original** stops it
- Content added later by infinite scrolling is not translated automatically; click **Translate this page** again
- Long pages are limited to roughly 400 paragraphs or 700 text nodes; the rest is left untranslated
- Bilingual mode inserts translation blocks and may affect layouts that rely on fixed heights or adjacent elements
- Translations are inserted as plain text; bold, links, and other formatting are not preserved
- Page translations disappear on refresh, but the local translation cache remains reusable
- Google Translate uses an unofficial endpoint and may stop working; it is usually unreachable in mainland China
- OpenAI-compatible output depends on the model and is not suitable for strict terminology
- Keys are stored in plain text locally; not suitable for shared devices
- macOS Safari only; there is no iOS / iPadOS version

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Safari does not list Safari Translator | App never launched, extension unsigned, Safari too old | Launch the app once; check macOS / Safari versions; reopen Safari settings |
| No translation items in the context menu | Extension disabled, page is not http/https, site access denied | Enable it in Safari settings; allow the site; reload the page |
| A page is not translated automatically | First visit, or you restored the original earlier | Click **Translate this page**; later in-site navigation is translated automatically |
| In-site navigation stops translating | The site was restored, the link goes to another site, or the site is not remembered | Translate the page again; make sure you stayed on the same site |
| No floating button after selecting text | Selection button disabled, selection over 5000 characters, or page blocks scripts | Check the setting; use the context menu; reload the page |
| “Translation provider not configured” | The selected provider needs a key | Open settings → provider configuration, enter the key, then test |
| “Invalid key or insufficient permissions” | Wrong key, region mismatch, or sub-account lacks permission | Check key / region / permissions; multi-region Azure resources need a region |
| “Too many requests” or quota errors | Free quota exhausted or rate-limited | Switch providers, translate less, check provider quota |
| Google Translate always times out | Google is unreachable | Use Microsoft, Alibaba Cloud, Tencent Cloud, or MyMemory |
| Microsoft test fails with 401 | Wrong key or region | Copy them again from the Azure portal; set the region for multi-region resources |
| DeepL returns 403 | Wrong plan | Free key with Free plan, Pro key with Pro plan |
| Only part of a page is translated | Paragraph / node limit reached or some batches failed | Check progress; retry or translate in parts |
| Layout breaks after translation | Bilingual mode inserted blocks | Use Replace mode or restore the original |
| Settings changes do not apply | The page was opened before the change, or saving failed | Reload the page; check that settings shows “Saved” |
| Settings cannot be saved | Safari storage cleared, private browsing | Exit private browsing; restart Safari; check free disk space |
| Behavior still looks like an old version | Safari cached the old extension | Quit Safari completely (⌘Q) and reopen; otherwise disable and re-enable the extension |

If the problem persists, check extension errors under Safari → Develop → Extensions.

---

## Recommended project

**[JSON Viewer for Safari](https://github.com/xlab6/json-viewer-safari)** — a Safari extension for formatting, viewing, and collapsing JSON. It shares the same interface and interaction style as Safari Translator and also targets macOS Safari.
