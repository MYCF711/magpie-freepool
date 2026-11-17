# 更新记录

## 0.1.0 — 2026-11-17

一张卡，15 家有免费额度的渠道。

- **聚合形态**：只有一个 provider（`freepool`）。模型 id 带渠道前缀 ——
  `llm7/…`、`nararoute/…`、`xkiro/…`、`sambanova/…`、`cohere/…`、`huggingface/…`、
  `cloudflare/…`、`mistral/…`、`groq/…`、`gemini/…`、`openrouter/…`、`kilo/…`、
  `opencode-zen/…`、`ollama-cloud/…`、`nvidia/…` —— 每条条目的 `api.url` 指向它自己的上游，
  所以一张卡能同时打 15 个 host。
- **一次粘贴配齐所有 key**：`groq=gsk_…;openrouter=sk-or-…;cloudflare=账号ID:token`，
  也收 JSON。只有 LLM7 完全免 key，其余 14 家是各家官网的免费 key。
- **目录逐家收**：只拉「配了 key 或免 key」的渠道，一家失败不影响其他家（`allSettled`）；
  全失败才退回上次快照，再退回每家的 seed —— 绝不返回空表。
- **渠道差异只在数据里**：nararoute 的 `/models` 不能带 Authorization（带了就 401）、
  Cloudflare 的目录是 `/ai/models/search`、Cohere 兼容层不认 10 个 body 字段、
  Hugging Face 的窗口要所有 live 推理商一致 —— 全部落在 `src/vendors.mjs` 一列字段里，
  逻辑里没有 `if (vendor === …)`。
- **错误语义**：未知模型前缀 → 404 `model_not_found`（只搁置那个模型）；
  某家缺 key → 401 `sign_in_required` + `X-Magpie-Sign-In: kept`（不把整张卡标成失效）。
- **额度**：只有 xKiro 有可读的 `/usage`，卡片显示它；其余渠道不画假进度条。
