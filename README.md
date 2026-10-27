# Safari Translator — 划词与网页翻译

一个原生 Safari 网页扩展（Safari Web Extension，Manifest V2）：**默认自动翻译整页**，同时保留划词翻译和手动控制。

> 本项目是独立项目，与 Apple Inc. 无关联。“Safari” 是 Apple Inc. 的商标，此处仅用于说明运行平台。

- 打开网页及站内跳转时自动翻译整页（含单页应用路由切换，可在设置中关闭）
- 选中文字 → 旁边出现浮动「翻译」按钮，点击才翻译所选内容
- 右键菜单 → 翻译所选文字 / 翻译此页面（按设置中的默认方式）/ 还原原文
- 整页翻译优先处理可视区，屏幕外内容在后台补全
- 支持 Microsoft Translator、阿里云、腾讯云、DeepL、LibreTranslate、OpenAI 兼容接口，以及免密钥的 MyMemory 和 Google 翻译
- 所有翻译请求都在后台页发出，页面只负责取词和显示结果

[English README](README.en.md) · [交互演示](demo/preview.html)

[![下载 DMG](https://img.shields.io/github/v/release/xlab6/safari-translator?style=for-the-badge&label=%E4%B8%8B%E8%BD%BD%20DMG&color=blue)](https://github.com/xlab6/safari-translator/releases/latest/download/Safari-Translator.dmg)

---

## 目录

- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [翻译服务配置](#翻译服务配置)
- [隐私与安全](#隐私与安全)
- [权限说明](#权限说明)
- [工作原理](#工作原理)
- [开发](#开发)
- [已知限制](#已知限制)
- [故障排查](#故障排查)
- [目录结构](#目录结构)

---

## 功能

### 自动翻译

- **默认开启**：打开 http/https 网页后，等待 DOM 就绪并按设置中的默认方式翻译整页
- 同一标签页内的站内跳转会自动重新翻译，包括 `pushState` / `replaceState` 的单页应用路由切换
- 仅修改 `#hash` 的跳转不会重复翻译；旧页面的译文会先还原，再处理新路由内容
- 自动翻译同样优先处理可视区，屏幕外内容随后异步补全
- 成功时不会弹出打扰式提示；服务未配置等致命问题会显示错误并引导打开设置
- 可在工具栏弹窗或设置页关闭「自动翻译网页」，关闭后仍可使用划词和右键菜单

### 划词翻译

在网页中选中一段文字，选区旁会出现一个小按钮；点击按钮后，译文显示在浮层面板中。

- 浮动按钮只响应鼠标选择或键盘选择；自动整页翻译由独立的页面逻辑触发
- 面板展示原文、检测到的语言、当前翻译服务、译文
- 支持朗读译文、复制译文、切换目标语言、重试、打开设置
- 选中超过 5000 字符时不显示浮动按钮，避免误发超长请求
- 可在设置中关闭浮动按钮，只保留右键菜单

### 右键菜单

在网页任意位置点击右键：

| 菜单项 | 行为 |
| --- | --- |
| 翻译所选文字 | 翻译当前选中的文字（未选中时提示先选择） |
| 翻译此页面 | 按设置中的默认方式翻译整页（默认替换原文） |
| 还原原文 | 移除插入的译文，或恢复被替换的原文 |
| 翻译设置… | 打开扩展设置页 |

菜单只在网页内容区域出现；Safari 内部页面、扩展页面不会出现。

### 整页翻译

- **双语对照**：每个段落后面插入一段带左侧竖线的译文，原文保留，适合阅读和对照
- **替换原文**：直接替换文本节点，适合快速浏览；点击「还原原文」可以恢复
- 默认使用「替换原文」，可在设置页改为「双语对照」；自动翻译、右键菜单和工具栏弹窗都遵循此设置
- 自动跳过 `script`、`style`、`code`、`pre`、`textarea`、可编辑区域、隐藏元素和已翻译内容
- 先翻译当前可视区，再在后台补全屏幕外内容（约 450ms 后开始）；滚动到附近时会提前处理
- 按 8 段 / 2600 字符分批，最多 3 个请求并发；右下角显示进度，可随时取消
- 默认最多处理 400 个段落或 700 个文本节点，超出部分不翻译，避免长页面请求过量
- 同一页面内相同文本会复用翻译缓存；失败不会破坏原文

### 工具栏弹窗

点击 Safari 工具栏中的扩展图标：

- 查看当前翻译服务、目标语言和启用状态
- 开关「自动翻译网页」
- 一键「翻译此页面」（按设置中的方式，默认替换原文）、切换另一种方式、还原原文
- 开关划词按钮
- 快速切换目标语言（会同步保存到设置）
- 打开完整设置页

> 如果工具栏没有图标：Safari → 显示 → 自定义工具栏，把 Safari Translator 拖到工具栏。图标不是使用扩展的必要条件，右键菜单始终可用。

### 设置页

设置项修改后自动保存（约 450 毫秒防抖），并立即同步给已打开的标签页：

- **翻译服务**：8 个服务卡片，标记「免密钥」「需密钥」「自建」
- **服务配置**：按服务显示所需字段，支持「测试翻译」
- **语言**：源语言（默认自动检测）、目标语言
- **页面翻译**：自动翻译开关、默认模式（替换 / 双语）、划词按钮开关、浅色 / 深色 / 跟随系统
- **隐私与安全**：密钥存储方式说明
- **其他**：恢复默认设置、版本信息

---

## 安装

### 环境要求

- macOS 13 或更高版本（推荐最新版 macOS）
- Xcode 15 或更高版本（本项目在 Xcode 27.1 上构建通过）
- Safari 16.4 或更高版本

### 直接下载（预览版）

[下载最新版 Safari Translator DMG](https://github.com/xlab6/safari-translator/releases/latest/download/Safari-Translator.dmg)

当前发布包使用 `Apple Development` 证书签名，**未经过 Apple 公证**。首次打开如果提示“无法验证开发者”：

- 在“应用程序”中右键 **Safari Translator** → **打开** → 再点一次 **打开**；或
- 在终端执行：

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Safari Translator.app"
  ```

> 这是预览分发。要让用户下载后双击直接打开、不出现安全提示，必须使用付费 Apple Developer Program 的 `Developer ID Application` 证书并完成公证；见下文「签名、公证与发布 DMG」。

### 从源码构建

1. 打开工程：

   ```bash
   open "xcode/Safari Translator/Safari Translator.xcodeproj"
   ```

2. 在 Xcode 中选中 **Safari Translator** 项目 → **Signing & Capabilities**：
   - 为 **Safari Translator** 和 **Safari Translator Extension** 两个 target 选择同一个 Team
   - 如果 `cn.oxzz.safari-translator` 不可用（已被占用或没有该前缀），改成你自己的反向域名，例如 `com.yourname.safaritranslator`
   - 扩展的 Bundle Identifier **必须**是主应用 Bundle Identifier 加后缀，例如 `com.yourname.safaritranslator.Extension`，否则 Xcode 会报 `Embedded binary's bundle identifier is not prefixed with the parent app's bundle identifier`
   - 欢迎窗口会从内嵌的 `.appex` 自动读取扩展标识，所以改完 Bundle Identifier 无需再改 Swift 代码
3. Scheme 选择 **Safari Translator**，目标选择 **My Mac**，按 `⌘R` 运行
4. 应用会显示一个欢迎窗口，点击「打开 Safari 扩展设置」
5. 在 Safari 中启用扩展：
   - **Safari → 设置 → 扩展**，勾选 **Safari Translator**
   - 按提示允许扩展访问网页（可选择「始终允许」或按网站询问）
6. 打开任意网页，选中文字或点击右键开始使用

> Safari 只有在主应用至少运行过一次、且扩展已签名后，才会在扩展列表中显示该扩展。若列表中没有，先确认当前 Safari 版本、应用是否成功启动，再重新打开 Safari 设置。

### 命令行构建（仅检查编译）

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

这会生成未签名的 `build/products/Debug/Safari Translator.app`，只适合验证能否编译。**日常安装和调试请用 Xcode 签名运行**，否则 Safari 不会把它当作可加载的扩展。

> 如果 `xcodebuild` 报错 `You don't have permission to save ... XCBuildData/PIFCache`，说明 Xcode 的 DerivedData / Build 位置指向了只读目录或网络盘。上面的 `SYMROOT`、`OBJROOT`、`-derivedDataPath` 参数可以把中间产物重定向到工程目录。也可以在 Xcode → Settings → Locations 中改回默认位置。

### 签名、公证与发布 DMG

> 要让其他人下载后双击直接打开、不出现 Gatekeeper 提示，需要 **付费 Apple Developer Program** 的 `Developer ID Application` 证书并完成 Apple 公证。当前 GitHub Release 是使用本机 `Apple Development` 证书签名的预览包，未公证，首次打开需要右键「打开」或移除 quarantine；正式分发请按本节重新打包。

1. 在 Xcode → Settings → Accounts → Manage Certificates 中创建 **Developer ID Application** 证书，或导入已有的 `.p12`。
2. 把公证凭据保存到钥匙串配置（密码是 Apple ID 的 App 专用密码，不是登录密码）：

   ```bash
   xcrun notarytool store-credentials "safari-translator-notary" \
     --apple-id "you@example.com" \
     --team-id "YOUR_TEAM_ID" \
     --password "xxxx-xxxx-xxxx-xxxx"
   ```

3. 构建、签名、公证并生成 DMG：

   ```bash
   DEVELOPMENT_TEAM="YOUR_TEAM_ID" \
   DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (YOUR_TEAM_ID)" \
   NOTARY_PROFILE="safari-translator-notary" \
   npm run release:dmg
   ```

脚本会签署 App 和内嵌 `.appex`、公证并 staple App、生成并签名 DMG、公证并 staple DMG，最后在 `dist/` 输出 DMG 和 SHA-256。只做本机签名、不公证时可加 `NOTARIZE=0`，但这样的包仍会被 Gatekeeper 拦截，只能作为预览包。

### 重新生成 Xcode 工程

工程已经生成好，通常不需要重新运行转换器。只有在你大幅修改 manifest 或增删扩展文件时才需要：

```bash
xcrun safari-web-extension-converter ./extension \
  --project-location ./xcode \
  --app-name "Safari Translator" \
  --bundle-identifier cn.oxzz.safari-translator \
  --swift --macos-only --no-open --no-prompt --force
```

注意：重新生成会**覆盖**欢迎页、`ViewController.swift`、Bundle Identifier 和图标等手工修改，请先提交或备份 `xcode/`。

---

## 使用

### 自动翻译

默认情况下，打开网页后会自动按设置中的默认方式翻译整页；同一标签页内的站内跳转（包括单页应用路由切换）也会自动重新翻译。

如需关闭，可点击工具栏图标或打开设置页，关闭「自动翻译网页」。关闭后仍可使用划词翻译、右键菜单和工具栏弹窗。

### 翻译所选文字

1. 用鼠标或键盘选中文字
2. 点击选区旁的「翻译」按钮
3. 在面板中查看译文；可以朗读、复制、切换目标语言或重试

也可以选中文字后点击右键 → **翻译所选文字**。如果你的浏览器或网页拦截了浮动按钮，右键菜单是稳定的替代入口。

### 翻译整个页面

- 打开网页或站内跳转后，启用自动翻译时会自动按设置中的默认方式翻译整页
- 右键 → **翻译此页面**：手动按设置中的默认方式翻译整页
- 右键 → **还原原文**：恢复页面

想换翻译方式，可在工具栏弹窗点另一个按钮，或在设置页修改默认方式。两种方式都支持随时还原。

翻译过程中右下角会显示进度条和「取消」按钮。关闭页面或刷新后译文不会保留。

### 快捷键

扩展没有注册全局快捷键，避免和 Safari 自身快捷键冲突。所有功能通过右键菜单、工具栏弹窗和浮动按钮触发。

### 演示页

不想安装扩展也可以先看交互效果：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080/demo/preview.html
```

演示页用本地词典模拟翻译，**不会联网**，也不包含任何扩展 API；它只是加载同一份 `content.js` 来展示划词按钮、双语对照、替换和还原的交互。

直接双击 `demo/preview.html` 也可以，但部分浏览器会限制 `file://` 下的脚本；建议用上面的本地服务器。

---

## 翻译服务配置

在 **Safari → 设置 → 扩展 → Safari Translator → 翻译设置**，或右键菜单 → **翻译设置…** 中配置。

| 服务 | 是否需要密钥 | 默认端点 | 说明 |
| --- | --- | --- | --- |
| MyMemory | 否 | `api.mymemory.translated.net` | 默认服务，适合试用；有每日额度限制 |
| Google 翻译 | 否 | `translate.googleapis.com` | 非官方公开端点，可能随时失效；中国大陆网络通常无法访问 |
| Microsoft Translator | 是 | `api.cognitive.microsofttranslator.com` | Azure AI 翻译资源，稳定，支持术语和自动检测 |
| 阿里云机器翻译 | 是 | `mt.aliyuncs.com` | 需要 AccessKey ID / Secret，按量计费 |
| 腾讯云机器翻译 | 是 | `tmt.tencentcloudapi.com` | 需要 SecretId / SecretKey，按量计费 |
| DeepL | 是 | Free / Pro 两个域名 | 质量好；Free 与 Pro 密钥不能混用 |
| LibreTranslate | 视实例 | 自定义 | 可自建；公共实例通常需要 API Key |
| OpenAI 兼容接口 | 视服务 | 自定义 | 通过 Chat Completions 提示翻译，可接 OpenAI、DeepSeek、Ollama 等 |

### MyMemory（默认，免密钥）

开箱即用，不需要任何配置。它会按 `源语言|目标语言` 查询，源语言选择「自动检测」时扩展会先在本地判断语言再传参。

- 免费额度有限，长页面可能触发限流
- 返回质量参差，适合演示和轻度使用
- 不建议翻译包含隐私信息的页面

### Google 翻译（免密钥）

使用 `translate.googleapis.com/translate_a/single` 公开端点，不需要密钥。

- 不是 Google 官方付费 API，没有 SLA，随时可能变更或封禁
- 中国大陆网络通常无法直连，表现为超时或 `request` 错误
- 如果主要在中国大陆使用，建议改用微软、阿里云或腾讯云

### Microsoft Translator（Azure）

1. 在 [Azure 门户](https://portal.azure.com/) 创建「翻译器」资源（Translator），选择免费层 F0 或付费层
2. 打开资源 → **密钥和终结点**，复制 **Key** 和 **Region**
3. 在扩展设置中选择 **Microsoft Translator**，填入：
   - **订阅密钥（Key）**：必填
   - **区域（Region）**：多区域资源必填，例如 `eastasia`；单区域资源可留空
   - **服务端点**：默认 `https://api.cognitive.microsofttranslator.com`，一般不用改
4. 点击「测试翻译」，看到「测试成功」即可

免费层每月有字符额度，超出后 Azure 会拒绝请求；具体额度以 Azure 控制台为准。

### 阿里云机器翻译

1. 在阿里云控制台开通 **机器翻译** 服务
2. 创建 RAM 子账号，授予 `AliyunMTFullAccess`（或等效的机器翻译权限），生成 AccessKey
3. 在扩展设置中选择 **阿里云机器翻译**，填入：
   - **AccessKey ID**：必填，通常以 `LTAI` 开头
   - **AccessKey Secret**：必填
   - **地域 ID**：默认 `cn-hangzhou`
4. 点击「测试翻译」

建议使用只授予机器翻译权限的 RAM 子账号，不要使用主账号 AccessKey。接口使用 RPC 签名（HMAC-SHA1），密钥只保存在本地浏览器存储中。

### 腾讯云机器翻译

1. 在腾讯云控制台开通 **机器翻译 TMT** 服务
2. 在 **访问管理 → API 密钥管理** 创建 SecretId / SecretKey，建议使用仅授权 TMT 的子账号
3. 在扩展设置中选择 **腾讯云机器翻译**，填入：
   - **SecretId**：必填，通常以 `AKID` 开头
   - **SecretKey**：必填
   - **地域**：默认 `ap-guangzhou`
4. 点击「测试翻译」

接口使用腾讯云 TC3-HMAC-SHA256 签名，单次请求最多约 1800 字符，扩展会自动分段。

### DeepL

1. 在 [DeepL API](https://www.deepl.com/pro-api) 注册 Free 或 Pro 套餐
2. 复制 API Key
3. 在扩展设置中选择 **DeepL**，填入密钥并选择对应套餐：
   - **Free**：`api-free.deepl.com`，每月 50 万字符额度
   - **Pro**：`api.deepl.com`
4. 点击「测试翻译」

Free 密钥配 Pro 端点（或反之）会返回 403。DeepL 的部分目标语言使用大写特殊代码（如 `ZH-HANS`、`ZH-HANT`、`PT-PT`），扩展会自动映射，不需要手动填写。

### LibreTranslate

1. 准备一个 LibreTranslate 实例，可以是公共实例或自建实例
2. 在扩展设置中选择 **LibreTranslate**，填写：
   - **服务地址**：例如 `https://libretranslate.com` 或 `http://localhost:5000`
   - **API Key（可选）**：公共实例通常需要；自建实例可留空
3. 点击「测试翻译」

自建实例的语言代码可能不完整，目标语言不可用时接口会返回错误。扩展会把部分代码转换为 LibreTranslate 的写法（例如繁体中文使用 `zt`）。

### OpenAI 兼容接口

适用于任何兼容 OpenAI Chat Completions 的服务：

- OpenAI：`https://api.openai.com/v1`，模型如 `gpt-4o-mini`
- DeepSeek：`https://api.deepseek.com/v1`，模型 `deepseek-chat`
- Ollama：`http://localhost:11434/v1`，模型如 `qwen2.5:7b`，密钥可留空
- 其他兼容网关：填写对应的 Base URL 和模型名

设置项：

- **接口地址**：到 `/v1` 为止，不要带 `/chat/completions`
- **API Key**：本地服务可留空
- **模型**：必填

这类服务通过提示词翻译，速度和成本取决于模型；长文本会被分段，译文风格可能比传统翻译服务更意译。

### 测试翻译

设置页的「测试翻译」会向当前服务发送一句 `Hello, world!`，并显示：

- 成功：服务名 + 耗时 + 译文预览
- 失败：错误原因 + 修复建议（密钥、区域、额度、网络等）

测试请求不写入翻译缓存，也不会把测试文本保存到设置中。

### 语言代码

扩展内部使用统一的 BCP 47 风格代码（如 `zh-CN`、`zh-TW`、`en`、`ja`），调用各服务时自动转换：

| 扩展 | Azure | 腾讯云 | 阿里云 | DeepL |
| --- | --- | --- | --- | --- |
| `zh-CN` | `zh-Hans` | `zh` | `zh` | `ZH-HANS` |
| `zh-TW` | `zh-Hant` | `zh_TW` | `zh-tw` | `ZH-HANT` |
| `pt` | `pt` | `pt` | `pt` | `PT-PT` |

源语言选择「自动检测」时：MyMemory 会在本地先判断语言再显式传参；Azure、DeepL、Google 等支持自动检测的服务直接使用其自动检测能力。

---

## 隐私与安全

### 会发送什么

- **划词翻译**：只发送你选中的文字
- **整页翻译**：发送从当前页面提取的正文段落（跳过代码、脚本、输入框、隐藏元素）
- **测试翻译**：发送固定的 `Hello, world!`

文字会发送到你在设置中选择的翻译服务。请在使用前阅读对应服务的隐私政策。涉及机密、个人信息、未公开文档的页面，请先确认服务条款，或改用自建 LibreTranslate / 本地 Ollama。

### 密钥如何保存

- 所有密钥保存在 `browser.storage.local`，即 Safari 扩展的本地存储
- **没有加密，也没有使用 macOS 钥匙串**；能访问你的用户目录或浏览器配置的人可以读取
- 建议使用权限最小化的子账号密钥（只授予翻译权限），并定期轮换
- 不要在共享 Mac 上保存长期密钥
- 扩展不会把密钥发送到所选服务之外的任何地方，也没有统计、遥测或远程配置

### 本地处理

- 语言检测、文本分段、缓存都在本地完成
- 朗读使用系统 `speechSynthesis`，复制使用剪贴板 API，均不联网
- 翻译缓存只在后台页内存中，最多 600 条，重启浏览器后清空
- 页面翻译结果只存在于当前页面 DOM，刷新即消失

### 没有远程代码

扩展不加载任何远程脚本、不执行 `eval`、不注入第三方 iframe。所有逻辑都在打包的 JS 文件中。

---

## 权限说明

`extension/manifest.json` 申请了：

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存翻译服务配置、语言、外观等设置 |
| `contextMenus` | 创建右键菜单 |
| `*://*/*` | 在网页中注入划词按钮、读取选中文字、翻译整页；同时允许后台页直接请求翻译服务，避免 CORS |

扩展**没有申请** `tabs` 权限。它依靠 `*://*/*` 的 host 权限定位当前标签页、注入内容脚本并发送消息；启用自动翻译时会在页面加载后读取正文内容。Safari 仍会按网站显示访问权限提示。

如果你只想在少数网站使用，可以在 Safari 设置 → 扩展 → Safari Translator → 网站访问中改为「仅允许指定网站」。

---

## 工作原理

```
自动翻译 / 划词按钮 / 右键菜单 / 弹窗
        │
        ▼
content.js（页面上下文）
  ├─ 读取选区或遍历正文
  ├─ 分段、去重、缓存
  └─ browser.runtime.sendMessage({ __pt: true, type: 'pt:translate' | 'translateBatch', ... })
        │
        ▼
background.js（后台页，唯一联网方）
  ├─ 读取并校验设置
  ├─ PT.translate(settings, text)
  └─ providers.js → fetch(翻译服务)
        │
        ▼
content.js 渲染译文 / 错误 / 进度
```

关键设计：

- **后台页发请求**：manifest 的 `host_permissions` 覆盖所有站点，后台页请求不受页面 CORS 限制；页面脚本不直接接触密钥
- **默认自动触发 + 可关闭**：页面加载和站内 SPA 路由切换会自动翻译整页；设置中关闭后，页面请求只来自划词、右键菜单或工具栏弹窗
- **消息带 `__pt` 标记**：后台忽略没有该标记的消息，避免和网页自身的 `postMessage` / 其他扩展冲突
- **按服务适配**：`providers.js` 统一处理签名、语言映射、分段、超时（20 秒，OpenAI 45 秒）、错误归一化
- **可降级**：某个服务配置缺失时返回 `config` 错误并引导打开设置，不会静默失败

---

## 开发

### 环境

- Node.js 20+（测试使用全局 `fetch`、`crypto`、`AbortController`）
- Python 3 + Pillow + numpy（仅在重新生成图标时需要）
- Xcode（仅在构建 Safari 宿主应用时需要）

### 安装依赖

```bash
npm install
```

只会安装 `jsdom`（测试用），扩展本身没有运行时依赖，也没有打包步骤。

### 常用命令

```bash
npm test          # node --test tests/，99 个测试
npm run lint      # 校验 manifest、图标、脚本引用
npm run check:js  # node --check 检查所有扩展脚本语法
npm run check     # lint + 语法检查 + 测试
npm run icons     # 重新生成扩展图标
```

为 Xcode 工程同时生成 AppIcon：

```bash
npm run icons -- --xcode "xcode/Safari Translator/Safari Translator"
```

如果系统 Python 没有 Pillow：

```bash
python3 -m venv .venv
.venv/bin/pip install pillow numpy
.venv/bin/python scripts/build-icons.py --xcode "xcode/Safari Translator/Safari Translator"
```

### 修改扩展后

- 只修改 `extension/` 下的文件：重新运行 Xcode 即可，工程直接引用 `../../../extension/*`，不需要重新生成
- 修改 `manifest.json` 的权限、图标、content script 列表：建议在 Safari 中禁用再启用扩展，或重启 Safari
- 新增扩展文件：需要在 Xcode 中把文件加入 **Safari Translator Extension** target，或重新运行转换器（会覆盖手工修改）

### 测试说明

测试使用 `node:test` + jsdom，不访问真实网络：

- `tests/common.test.mjs`：语言映射、设置校验、文本分段、错误序列化
- `tests/providers.test.mjs`：8 个服务的请求构造、签名、分段、错误映射
- `tests/background.test.mjs`：菜单、消息路由、并发控制
- `tests/content.test.mjs`：自动页面翻译、SPA 路由、划词、整页双语/替换/还原、进度与错误
- `tests/ui.test.mjs`：弹窗与设置页的渲染、保存、重置、测试翻译

测试通过环境变量 `PT_JSDOM` 或同级项目的 `node_modules/jsdom` 查找 jsdom。

---

## 已知限制

- 不处理 iframe 内的内容（`all_frames: false`），不处理 Safari 阅读器、PDF、扩展页面和浏览器内部页面
- 自动翻译会在页面加载和站内 SPA 路由切换时触发；无限滚动页面后续新增的内容仍需要手动再次翻译
- 整页翻译受 400 段 / 700 文本节点限制；长页面可能只翻译一部分
- 整页翻译受 400 段 / 700 文本节点限制；长页面可能只翻译一部分
- 双语模式会插入 `<span data-pt-translation>`，可能影响极少数依赖 `:last-child` 或固定高度的布局
- 译文不做 HTML 保留，按纯文本插入；原文中的加粗、链接等格式在译文里会丢失
- 刷新页面后译文和缓存（页面侧）都会消失；后台缓存重启浏览器后清空
- Google 翻译使用非官方端点，可能失效；中国大陆网络通常不可用
- OpenAI 兼容接口的译文质量和速度取决于模型，不适合要求严格术语一致的场景
- 密钥明文保存在 `storage.local`，不适合共享设备
- 仅提供 macOS Safari 宿主应用；没有 iOS / iPadOS target
- Manifest V2；Chrome / Edge 移植需要调整 `browser_action`、`background` 和权限模型

---

## 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| Safari 扩展列表里没有 Safari Translator | 应用没运行过、未签名、Safari 版本过低 | 用 Xcode 签名运行一次；确认 macOS / Safari 版本；重新打开 Safari 设置 |
| 右键菜单没有翻译项 | 扩展未启用、当前页面不是 http/https、网站访问被拒绝 | 在 Safari 设置 → 扩展中启用；允许该网站访问；刷新页面 |
| 更新后右键菜单仍是旧的两个翻译入口 | Safari 缓存了旧扩展 | 完全退出 Safari（⌘Q）后重新打开；仍不行则在扩展设置中取消勾选再启用 |
| 选中文字后没有浮动按钮 | 设置中关闭了划词按钮、选区超过 5000 字符、页面阻止了脚本 | 打开设置检查开关；改用右键菜单；刷新页面 |
| 提示「翻译服务未配置」 | 当前服务需要密钥但未填写 | 打开设置 → 服务配置，填入密钥后点「测试翻译」 |
| 提示「密钥无效或权限不足」 | 密钥错误、区域不匹配、子账号无权限 | 检查 Key / Region / 子账号授权；Azure 多区域资源必须填 Region |
| 提示「请求过于频繁」或额度错误 | 免费额度用完或被限流 | 换服务、减少整页翻译、检查服务商配额 |
| Google 翻译一直超时 | 网络无法访问 Google | 改用微软、阿里云、腾讯云或 MyMemory |
| Microsoft 测试失败 401 | Key 或 Region 错误 | 在 Azure 门户重新复制；多区域资源填写 Region |
| 阿里云签名错误 | AccessKey 错误或系统时间偏差过大 | 检查 AccessKey；校准系统时间 |
| 腾讯云签名错误 | SecretId / SecretKey 错误、地域不匹配 | 重新生成密钥；确认已开通 TMT |
| DeepL 403 | Free / Pro 套餐选错 | Free 密钥配 Free，Pro 密钥配 Pro |
| 整页只翻译了一部分 | 达到 400 段 / 700 节点上限，或有失败批次 | 查看进度提示；重试或分页面翻译；长页面可先用阅读模式 |
| 页面布局被译文挤乱 | 双语模式插入了块级译文 | 改用替换模式，或点「还原原文」 |
| 设置修改后没生效 | 页面是修改前打开的，或保存失败 | 刷新页面；确认设置页显示「已保存」 |
| 提示无法保存设置 | Safari 存储被清理、隐私模式 | 退出隐私浏览；重启 Safari；检查剩余磁盘空间 |
| `xcodebuild` 权限错误 | DerivedData 指向只读目录 | 使用 README 中的 `SYMROOT` / `OBJROOT` / `-derivedDataPath` 参数 |

如果问题仍然存在，打开 Safari → 开发 → 显示 Web 检查器，检查扩展后台页和内容脚本的 Console；也可以在 Safari → 开发 → 扩展中查看错误。

---

## 目录结构

```
safari-translator/
├── extension/                 # 扩展本体，无构建步骤
│   ├── manifest.json          # MV2 清单
│   ├── common.js              # 语言、设置、分段、存储、错误
│   ├── providers.js           # 8 个翻译服务的请求与签名
│   ├── background.js          # 右键菜单、消息路由、并发、注入
│   ├── content.js             # 划词按钮、结果面板、整页翻译
│   ├── content.css            # 注入内容的兜底样式和打印隐藏
│   ├── popup.html/.css/.js    # 工具栏弹窗
│   ├── options.html/.css/.js  # 设置页
│   └── icons/                 # 16–512 px 图标
├── demo/
│   ├── preview.html           # 交互演示页（本地词典，不联网）
│   ├── demo.css
│   └── demo.js                # 模拟 browser API
├── xcode/
│   └── Safari Translator/       # 转换器生成的 macOS 宿主应用
│       ├── Safari Translator.xcodeproj
│       └── Safari Translator/
│           ├── AppDelegate.swift
│           ├── ViewController.swift
│           ├── Base.lproj/Main.storyboard
│           ├── Resources/     # 欢迎页、图标
│           └── Assets.xcassets
├── scripts/
│   ├── build-icons.py         # 生成扩展与 Xcode 图标
│   └── lint-manifest.js       # 清单与资源校验
├── tests/                     # node:test + jsdom
├── package.json
└── README.md
```

---

## 致谢

工程结构参考了 [json-viewer-safari](../json-viewer-safari) 的 Safari Web Extension 组织方式（Xcode 宿主 + 纯 JS 扩展 + 转换器生成工程）。

翻译服务由其各自提供方运营；本项目不隶属于 Microsoft、Alibaba Cloud、Tencent Cloud、DeepL、Google 或 OpenAI。
