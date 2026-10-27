# Safari Translator — 划词与网页翻译

一个原生 Safari 网页扩展：整页翻译、划词翻译、双语对照，支持 8 种翻译服务。

> 本项目是独立项目，与 Apple Inc. 无关联。“Safari” 是 Apple Inc. 的商标，此处仅用于说明运行平台。

- 一键翻译整页；翻译过的网站会被记住，之后站内跳转自动续译
- 选中文字 → 旁边出现浮动「翻译」按钮，点击才翻译所选内容
- 右键菜单 → 翻译所选文字 / 翻译此页面 / 还原原文
- 已翻译的文字会复用本地缓存，重启 Safari 后依然有效，不重复消耗翻译额度
- 支持 Microsoft Translator、阿里云、腾讯云、DeepL、LibreTranslate、OpenAI 兼容接口，以及免密钥的 MyMemory 和 Google 翻译

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
- [推荐项目](#推荐项目)

---

## 功能

### 网页翻译

- 在工具栏弹窗或右键菜单点击「翻译此页面」即可翻译整页
- 翻译后会记住当前网站：在同一网站的站内跳转（包括单页应用路由切换）会自动翻译新页面
- 站内跳转只处理新增或变化的文字，侧边栏等未变化区域不会重复翻译
- 无限滚动加载的新内容会自动继续翻译，不需要再次点击
- 长页面会完整翻译，不设段落或文本节点数量上限
- 「还原原文」会恢复页面，并让该网站恢复为不自动翻译
- **替换原文**：直接替换页面文字，适合快速浏览；**双语对照**：在原文下方插入译文，适合阅读和对照
- 默认使用「替换原文」，可在设置页改为「双语对照」
- 先翻译当前屏幕可见的内容，其余部分随后补全；右下角显示进度，可随时取消
- 自动跳过代码、输入框、可编辑区域和隐藏内容；翻译失败不会破坏原文
- 已翻译过的相同文字会直接复用本地缓存，不再次请求翻译服务

### 划词翻译

在网页中选中一段文字，选区旁会出现一个小按钮；点击按钮后，译文显示在浮层面板中。

- 面板展示原文、检测到的语言、当前翻译服务、译文
- 支持朗读译文、复制译文、切换目标语言、重试、打开设置
- 页面滚动时，面板会跟随所选文字移动
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

### 工具栏弹窗

点击 Safari 工具栏中的扩展图标：

- 查看并切换翻译服务、目标语言
- 一键「翻译此页面」（按设置中的方式，默认替换原文）、切换另一种方式、还原原文
- 开关划词按钮
- 打开完整设置页

> 如果工具栏没有图标：Safari → 显示 → 自定义工具栏，把 Safari Translator 拖到工具栏。图标不是使用扩展的必要条件，右键菜单始终可用。

### 设置页

设置项修改后自动保存，并同步给已打开的标签页：

- **翻译服务**：8 个服务卡片，标记「免密钥」「需密钥」「自建」
- **服务配置**：按服务显示所需字段，支持「测试翻译」
- **语言**：源语言（默认自动检测）、目标语言
- **页面翻译**：默认翻译方式（替换 / 双语）、划词按钮开关、浅色 / 深色 / 跟随系统
- **其他**：恢复默认设置、GitHub 仓库地址、版本信息

---

## 安装

### 环境要求

- macOS 13 或更高版本
- Safari 16.4 或更高版本

### 下载安装

[下载最新版 Safari Translator DMG](https://github.com/xlab6/safari-translator/releases/latest/download/Safari-Translator.dmg)

打开 DMG，把 Safari Translator 拖到「应用程序」，然后启动一次。首次打开如果提示“无法验证开发者”（发布包未经过 Apple 公证）：

- 在“应用程序”中右键 **Safari Translator** → **打开** → 再点一次 **打开**；或
- 在终端执行：

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Safari Translator.app"
  ```

启动后，在 **Safari → 设置 → 扩展** 中勾选 **Safari Translator**，并按提示允许扩展访问网页。

### 从源码构建

需要 Xcode 15 或更高版本。

1. 打开 `xcode/Safari Translator/Safari Translator.xcodeproj`
2. 为 **Safari Translator** 和 **Safari Translator Extension** 两个 target 选择同一个 Team
3. Scheme 选择 **Safari Translator**，目标选择 **My Mac**，按 `⌘R` 运行
4. 在 Safari 设置中启用扩展，并允许访问网页

如果要修改 Bundle Identifier，扩展的 Bundle Identifier 必须是主应用 Bundle Identifier 加后缀（例如 `com.yourname.safaritranslator.Extension`），否则 Xcode 会拒绝构建。

> Safari 只有在主应用至少运行过一次、且扩展已签名后，才会在扩展列表中显示该扩展。若列表中没有，先确认 Safari 版本、应用是否成功启动，再重新打开 Safari 设置。

---

## 使用

### 翻译整个页面

1. 打开网页
2. 点击工具栏图标 → **翻译此页面**，或右键 → **翻译此页面**
3. 想换翻译方式，可在工具栏弹窗点另一个按钮，或在设置页修改默认方式

翻译后，扩展会记住这个网站：在同一网站内点击链接或切换单页应用页面时，新内容会自动翻译。点击 **还原原文** 会恢复页面，并让该网站恢复为不自动翻译。

### 翻译所选文字

1. 用鼠标或键盘选中文字
2. 点击选区旁的「翻译」按钮
3. 在面板中查看译文；可以朗读、复制、切换目标语言或重试

也可以选中文字后点击右键 → **翻译所选文字**。如果网页拦截了浮动按钮，右键菜单是稳定的替代入口。

### 演示页

不想安装扩展也可以先看交互效果：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080/demo/preview.html
```

演示页使用本地词典模拟翻译，不会联网。

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
| OpenAI 兼容接口 | 视服务 | 自定义 | 可接 OpenAI、DeepSeek、Ollama 等 |

### MyMemory（默认，免密钥）

开箱即用，不需要任何配置。

- 免费额度有限，长页面可能触发限流
- 返回质量参差，适合演示和轻度使用
- 不建议翻译包含隐私信息的页面

### Google 翻译（免密钥）

- 不是 Google 官方付费 API，没有 SLA，随时可能变更或封禁
- 中国大陆网络通常无法直连，表现为超时或 `request` 错误
- 如果主要在中国大陆使用，建议改用微软、阿里云或腾讯云

### Microsoft Translator（Azure）

1. 在 [Azure 门户](https://portal.azure.com/) 创建「翻译器」资源，选择免费层 F0 或付费层
2. 打开资源 → **密钥和终结点**，复制 **Key** 和 **Region**
3. 在扩展设置中选择 **Microsoft Translator**，填入：
   - **订阅密钥（Key）**：必填
   - **区域（Region）**：多区域资源必填，例如 `eastasia`；单区域资源可留空
   - **服务端点**：默认值一般不用改
4. 点击「测试翻译」，看到「测试成功」即可

免费层每月有字符额度，超出后 Azure 会拒绝请求；具体额度以 Azure 控制台为准。

### 阿里云机器翻译

1. 在阿里云控制台开通 **机器翻译** 服务
2. 创建 RAM 子账号，授予 `AliyunMTFullAccess`（或等效的机器翻译权限），生成 AccessKey
3. 在扩展设置中选择 **阿里云机器翻译**，填入 AccessKey ID、AccessKey Secret 和地域 ID（默认 `cn-hangzhou`）
4. 点击「测试翻译」

建议使用只授予机器翻译权限的 RAM 子账号，不要使用主账号 AccessKey。

### 腾讯云机器翻译

1. 在腾讯云控制台开通 **机器翻译 TMT** 服务
2. 在 **访问管理 → API 密钥管理** 创建 SecretId / SecretKey，建议使用仅授权 TMT 的子账号
3. 在扩展设置中选择 **腾讯云机器翻译**，填入 SecretId、SecretKey 和地域（默认 `ap-guangzhou`）
4. 点击「测试翻译」

### DeepL

1. 在 [DeepL API](https://www.deepl.com/pro-api) 注册 Free 或 Pro 套餐
2. 复制 API Key
3. 在扩展设置中选择 **DeepL**，填入密钥并选择对应套餐：
   - **Free**：`api-free.deepl.com`，每月 50 万字符额度
   - **Pro**：`api.deepl.com`
4. 点击「测试翻译」

Free 密钥配 Pro 端点（或反之）会返回 403。

### LibreTranslate

1. 准备一个 LibreTranslate 实例，可以是公共实例或自建实例
2. 在扩展设置中选择 **LibreTranslate**，填写服务地址（例如 `https://libretranslate.com` 或 `http://localhost:5000`）和可选的 API Key
3. 点击「测试翻译」

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

这类服务通过提示词翻译，速度和成本取决于模型，译文可能比传统翻译服务更意译。

### 测试翻译

设置页的「测试翻译」会发送一句 `Hello, world!`，并显示：

- 成功：服务名 + 耗时 + 译文预览
- 失败：错误原因 + 修复建议（密钥、区域、额度、网络等）

测试结果不会写入翻译缓存。

---

## 隐私与安全

### 会发送什么

- **划词翻译**：只发送你选中的文字
- **整页翻译**：发送当前页面中需要翻译的段落（跳过代码、脚本、输入框、隐藏内容）
- **测试翻译**：发送固定的 `Hello, world!`

文字会发送到你在设置中选择的翻译服务。涉及机密、个人信息或未公开文档的页面，请先确认对应服务的条款，或改用自建 LibreTranslate / 本地 Ollama。

### 密钥如何保存

- 所有密钥保存在 Safari 扩展的本地存储中，不会上传到本扩展以外的服务器
- 密钥没有额外加密；能访问你的用户目录或浏览器配置的人可以读取
- 建议使用权限最小化的子账号密钥（只授予翻译权限），并定期轮换
- 不要在共享 Mac 上保存长期密钥
- 扩展没有统计、遥测或远程配置

### 本地数据

- **已翻译网站记录**：用于决定站内跳转是否自动翻译，可在「还原原文」时清除该网站
- **翻译缓存**：已翻译的文字保存在本地，重启 Safari 后仍可复用；清除扩展数据或恢复默认设置会一并清除
- 页面上的译文只存在于当前页面，刷新后消失

---

## 权限说明

| 权限 | 用途 |
| --- | --- |
| 存储 | 保存翻译服务配置、语言、外观、已翻译网站和翻译缓存 |
| 右键菜单 | 创建翻译相关菜单项 |
| 访问所有网站 | 在网页中显示划词按钮、读取选中文字、翻译页面，并请求你选择的翻译服务 |

扩展不会读取与翻译无关的页面内容。如果只想在少数网站使用，可以在 Safari 设置 → 扩展 → Safari Translator → 网站访问中改为「仅允许指定网站」。

---

## 推荐项目

**[JSON Viewer for Safari](https://github.com/xlab6/json-viewer-safari)** — 在 Safari 中格式化、查看和折叠 JSON 的浏览器扩展，界面与交互风格和 Safari Translator 一致，同样支持 macOS Safari。
