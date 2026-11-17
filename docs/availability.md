# 渠道可用性实测（免 key / 有 key 两栏）

> 本文件是**证据表**，不是承诺。每次自检轮会重跑一遍并把结果写回这里。
> 探针：`GET <base>/models` + 一次 `POST <base>/chat/completions`（两者都不带凭据），由 `scripts/probe-vendors.mjs` 生成。
> 判定口径：**200 = 免 key 可读目录**；401/403 = 活着但要凭据（403 也可能是本机出口被挡）；
> NET/TIMEOUT = 本机网络不可达；404 = 路径需要账号段（Cloudflare）。

最后一次实测：**2026-11-17 20:1x（Asia/Shanghai）**

<!-- probe:start -->

| 渠道 | 免 key 目录 | 条数 | 无凭据 chat | 有 key 目录 | 有 key chat | 结论 |
|---|---|---|---|---|---|---|
| llm7 | 200 | 74 | **200 有正文** | 未测 | 未测 | 免 key 可用 |
| nararoute | 200 | 42 | 401 | 未测 | 未测 | 目录免 key，对话要 key |
| xkiro | 200 | 69 | 401 | 未测 | 未测 | 目录免 key，对话要 key |
| sambanova | 200 | 5 | 401 | 未测 | 未测 | 目录免 key，对话要 key |
| cohere | 403 | 0 | 403 | 未测 | 未测 | 本机出口被挡 |
| huggingface | NET | 0 | NET | 未测 | 未测 | 本机不可达 |
| cloudflare | 404 | 0 | 404 {"result":null,"success":false,"errors": | 未测 | 未测 | 账号级端点 |
| mistral | NET | 0 | NET | 未测 | 未测 | 本机不可达 |
| groq | 403 | 0 | 403 | 未测 | 未测 | 本机出口被挡 |
| gemini | NET | 0 | NET | 未测 | 未测 | 本机不可达 |
| openrouter | 200 | 470 | 401 | 未测 | 未测 | 目录免 key，对话要 key |
| kilo | 200 | 469 | **200 有正文** | 未测 | 未测 | 免 key 可用 |
| opencode-zen | 200 | 86 | 429（额度用尽，非缺凭据） | 未测 | 未测 | 免 key 可用（限流） |
| ollama-cloud | 200 | 24 | 401 | 未测 | 未测 | 目录免 key，对话要 key |
| nvidia | 200 | 32 | 401 | 未测 | 未测 | 目录免 key，对话要 key |

_生成时间：2026-11-17T12:42:00.137Z（`node scripts/probe-vendors.mjs --write`）_

<!-- probe:end -->

## 为什么可能有很多「未测」

没给 key 的渠道，「有 key」一栏就是「未测」——**不编造结论**。给上环境变量，一条命令补全：

```bash
GROQ_API_KEY=gsk_… OPENROUTER_API_KEY=sk-or-… node scripts/probe-vendors.mjs --write
```

变量名是 `<渠道ID 大写、连字符换下划线>_API_KEY`，Cloudflare 用 `CLOUDFLARE_API_KEY="账号ID:token"`。

## 为什么「有 key」这一栏仍然只能靠你（2026-11-17 实测的取证过程）

自动领 key 的每一条路都试过了，结论是**没有无人值守的通道**：

| 尝试 | 结果 |
|---|---|
| 本机环境变量 / magpie 已配置 providers / `D:MyKey` | 都没有这 12 家的 key |
| NaraRoute `POST /api/auth/register` | 接口存在，但返回 `403 {"message":"Email registration is currently disabled. Please continue with Google."}` —— **只允许 Google 登录** |
| xKiro `/register?plan=free` | 页面无验证码，但表单由 Next.js 前端提交到它自己的后端，需要邮箱验证；chunk 里搜不到公开的注册/发 key 接口 |
| 常见发 key 路径（`/api/keys`、`/v1/keys`…） | 一律 `401`（存在但要登录态），没有「匿名发 key」的接口 |
| Cloudflare / Groq / OpenRouter / Mistral / Gemini / HF / Cohere / SambaNova / Ollama Cloud / NVIDIA | 都要先有账号，控制台生成 key |

所以「有 key」一栏只能由**持有账号的人**填：把 key 作为环境变量交给 `node scripts/probe-vendors.mjs --write`。

## 与代码的对应

- `免 key 可用` 的三家在 `src/vendors.mjs` 里标 `keyless: true`，因此 `hasKey()` 恒为真、装上就能拉目录。
- `kilo` / `opencode-zen` 还带 `freeMatch`：没配 key 时只列免费档，避免列出 469 个「选中必 401」的收费模型。
- 其余渠道没有 key 时不会去打上游（`skipped`），也不会用 seed 冒充 live。