# 免费池 FreePool

**六家有免费额度、而 magpie 内置预设里没有的渠道，一个包装进 magpie。**
每家一张卡、各存各的 key，模型目录按账号实时拉取 —— 装上就能在模型列表里选中直接用。

```
magpie plugin add github:MYCF711/magpie-freepool
```

## 它给你什么

- **6 个供应商**：LLM7、NaraRoute、xKiro、SambaNova、Cohere、Hugging Face。
- **登录就是粘贴 API key**：不弹浏览器、不存 refresh token、不做签到。两家（LLM7 / NaraRoute 的目录）连 key 都不需要。
- **模型按账号拉**：每家的 `/models` 各自解析，字段对不上就不猜 —— 窗口、看图能力只在厂商自己说了的时候才写。
- **拉不到不会变空**：目录失败时退回上次成功快照，再退回内置 seed，卡片上不会出现「0 models」。
- **额度只说知道的**：只有 xKiro 有可读的额度接口，卡片就显示它；其余五家**不画进度条** —— 画一个 100% 的假进度条会把空号排到智能路由队首。

## 六家一览

| 供应商 | 免费额度 | 要 key 吗 | 额度条 |
| --- | --- | --- | --- |
| [LLM7](https://token.llm7.io/) | 免费池：匿名也能用（限额更低） | 不要 | — |
| [NaraRoute](https://router.bynara.id/) | 免费池：注册即用的免费模型 | 要（对话层） | — |
| [xKiro](https://xkiro.com/) | 免费池：账户自带免费 token 窗口 | 要 | ✅ 读 `/usage` |
| [SambaNova](https://cloud.sambanova.ai/apis) | 免费试用额度 | 要 | — |
| [Cohere](https://dashboard.cohere.com/api-keys) | Trial key 的限速额度 | 要 | — |
| [Hugging Face](https://huggingface.co/settings/tokens) | 每月少量推理额度 | 要 | — |

> 额度数字以各家控制台为准：这些是**免费池**，厂商随时会调。本插件不承诺数字，只承诺「说得出就显示、说不出就不编」。

## 为什么是这六家（不是那七家）

被 magpie 内置覆盖的渠道不做成插件条目 —— 两个插件抢同一个 provider id 只会互相覆盖：

```bash
magpie provider add mistral <key>        # Mistral
magpie provider add groq <key>           # Groq
magpie provider add google <key>         # Gemini
magpie provider add openrouter <key>     # OpenRouter
magpie provider add kilo                 # Kilo Gateway
magpie provider add opencode-zen         # OpenCode Zen
magpie provider add ollama-cloud <key>   # Ollama Cloud
magpie provider add nvidia <key>         # NVIDIA NIM
```

Cloudflare Workers AI 已有社区插件：`@magpie-community/opencode-cloudflare-workers-ai-auth`。
三家本地（Ollama / LM Studio / llama.cpp）不需要登录态也不吃额度，插件卡片对它们没有意义。

## 已知网络限制（实测 2026-11-17）

- **Cohere**：`api.cohere.ai` 从部分出口会被边缘层直接回 `403 Forbidden`（HTML，不是 JSON）。
  遇到 403 先确认本机网络能否直连该域名，换 key 不会有用。
- **Hugging Face**：`router.huggingface.co` 在部分网络下不可达（连接超时）。
  同域 `huggingface.co` 能通、`router` 不能的，属于本机 DNS / 代理设置问题。

这两家是「能连就更好用」的补充渠道，不通不影响其余四家。

## 安装与验证

```bash
magpie plugin add github:MYCF711/magpie-freepool   # 稳定版（默认分支）
magpie plugin list                                 # 应该看到六行 provider
magpie plugin login llm7                           # 贴 key（LLM7 可留空）
magpie models                                      # 看模型是否出现在列表里
```

从仓库目录直接装（开发时）：

```bash
magpie plugin add /path/to/magpie-freepool
```

取消：

```bash
magpie plugin rm magpie-freepool
```

## 不要做的事

- **不要拿它当「免费额度无限」用**：免费池都有限速与日/月上限，超了上游自己会拒绝，本插件不做重试放大。
- **不要把同一个 key 贴进两个 provider**：额度都记在同一个账号上，两张卡会各算一遍。
- **不要指望它有签到按钮**：这六家都没有每日签到，卡片上不画这个按钮。

## 参考源

本包的实现是重写，不是复制。事实来源与工程底座都在 [`NOTICE.md`](./NOTICE.md) 里逐条列了：

- [Alishahryar1/free-claude-code](https://github.com/Alishahryar1/free-claude-code)（AGPL-3.0-only）—— 六个站点的端点形态与各家字段语义，**只取事实**。
- [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute)（MIT）—— 免费额度的口径与审计方法。
- [MYCF711/magpie-plugin-scaffold](https://github.com/MYCF711/magpie-plugin-scaffold)（MIT）—— `src/` 与 `scripts/` 的工程底座。

## 许可

**AGPL-3.0-only**（Copyright (c) 2026 MYCF711）。完整正文见 [`LICENSE`](./LICENSE)，归属说明在 [`NOTICE.md`](./NOTICE.md)。

各上游厂商的名称与商标归各自公司所有；本插件不是它们的官方产品，也未获其背书。
