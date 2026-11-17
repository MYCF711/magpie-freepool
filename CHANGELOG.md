# 更新记录

## 0.1.5 — 2026-11-17

- **证据表改成可重跑生成的**：新增 `scripts/probe-vendors.mjs`（`npm run probe:write`），
  逐家发 `GET /models` + 一次 `POST /chat/completions`，把结果直接回写 `docs/availability.md` 的表格块。
  给上环境变量（`GROQ_API_KEY`、`OPENROUTER_API_KEY`…）就同时把「有 key」两栏也测掉。
- **新增 `tests/availability.test.mjs`**：把「表里的结论」和「代码里的 keyless 标记」锁成一致 ——
  两边不一致（表过期或标错）CI 直接红，避免文档说能用、装上去用不了。
- 不再手写证据表：手写的会过期，跑出来的不会。

## 0.1.4 — 2026-11-17

- **`key_hint` 现在有真实作用**：开着（默认）时，把「你还没配 key 的那几家」也摆进模型列表，
  名字带「· 需 key」—— 用户能看到自己还能解锁什么；关掉就只列当前真能调的渠道。
  （0.1.3 的标记其实标不到任何东西：没 key 且不免 key 的家本来就被跳过。这是修正，不是新增。）

## 0.1.3 — 2026-11-17

- **插件选项 `key_hint`（默认开，置顶）**：开着时把「你还没配 key 的渠道」在模型名后标出「· 需 key」，
  开关的说明文字直接写清谁免 key（LLM7 / Kilo `kilo-auto/free` / OpenCode Zen）、其余去哪领。
  选项在使用点实时读，切换即生效；关掉则只按渠道分组显示。
- **新增 [docs/availability.md](./docs/availability.md)**：15 家逐条的实测证据表（免 key / 有 key 两栏），
  标注口径与复查方式；「有 key」一栏如实写「未测」，不编造。
- 说明：本机出口被挡的三家（cohere 403、groq 403、HF/mistral/gemini 不可达）也如实记录，不删除表项。

## 0.1.2 — 2026-11-17

- **只列真能用的模型**：过滤 embedding / rerank / 语音 / 生图类 id（选中必报错的那些）。
- **免 key 渠道只列免费档**：Kilo 的 469 个模型里绝大多数要登录，没配 key 时只列 `kilo-auto/*`；
  OpenCode Zen 只列 `*-free` 与 `big-pickle`。模型数从 606 收到「装完就能真跑」的那批。
- OpenCode Zen 的 seed 换成实测存在的免费 id `deepseek-v4.1-flash-free`。

## 0.1.1 — 2026-11-17

- **三家免 key 渠道自动生效**：实测 `llm7`（chat 层无凭据 200）、`kilo`（`kilo-auto/free` 无凭据 200）、
  `opencode-zen`（免费模型无凭据，返回 429 是「免费额度用尽」而不是缺凭据）。
  装上插件、key 留空也直接可用，这三家会去拉真实模型目录。
- **未配 key 的渠道一眼可辨**：seed 模型名带「· 需 key」标记，用户不用逐个试才知道哪家要登录。
- 领取入口仍在两处：错误文案里带该家的 `keyUrl`；README 的渠道表逐行给出了地址。

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
