# 渠道可用性实测（免 key / 有 key 两栏）

> 本文件是**证据表**，不是承诺。每次自检轮会重跑一遍并把结果写回这里。
> 探针：`GET <base>/models`（不带任何凭据），`code` 为 HTTP 状态；`models` 为条数。
> 判定口径：**200 = 免 key 可读目录**；401/403 = 活着但要凭据（403 也可能是本机出口被挡）；
> NET/TIMEOUT = 本机网络不可达；404 = 路径需要账号段（Cloudflare）。

最后一次实测：**2026-11-17 20:1x（Asia/Shanghai）**

| 渠道 | 免 key 目录 | 条数 | 无凭据 chat | 有 key | 结论 |
|---|---|---|---|---|---|
| llm7 | 200 | 74 | **200 真有正文** | 未测（无 key） | 免 key 可用 |
| kilo | 200 | 469 | **200 真有正文**（`kilo-auto/free`） | 未测 | 免 key 可用（只列 `kilo-auto/*`） |
| opencode-zen | 200 | 86 | 429 `FreeUsageLimitError`（= 免费额度用尽，**不是**缺凭据） | 未测 | 免 key 可用（只列 `*-free`） |
| nararoute | 200 | 42 | 401 | 未测 | 目录免 key，**对话要 key** |
| xkiro | 200 | 69 | 401 | 未测 | 目录免 key，对话要 key；有 `/usage` |
| sambanova | 200 | 5 | 401 | 未测 | 目录免 key，对话要 key |
| openrouter | 200 | 470 | 未测 | 未测 | 目录免 key（免费模型需 key） |
| ollama-cloud | 200 | 24 | 未测 | 未测 | 目录免 key，对话要 key |
| nvidia | 200 | 32 | 未测 | 未测 | 目录免 key，对话要 key |
| cloudflare | 404 | 0 | 401 | 未测 | 账号级端点：`账号ID:token` |
| cohere | 403 | 0 | — | 未测 | **本机出口被边缘层挡**（HTML 403） |
| groq | 403 | 0 | — | 未测 | 本机被挡（换 OpenAI UA 仍 403） |
| huggingface | NET | 0 | — | 未测 | 本机连不上 `router.huggingface.co` |
| mistral | TIMEOUT | 0 | — | 未测 | 本机不可达 |
| gemini | NET | 0 | — | 未测 | 本机不可达 |

## 为什么「有 key」一栏全是「未测」

本机没有这 12 家的 key，**不编造结论**。拿到任一家的 key 后，一条命令就能补：

```bash
curl -sS -H "Authorization: Bearer <key>" <base>/models | head -c 200
```

## 与代码的对应

- `免 key 可用` 的三家在 `src/vendors.mjs` 里标 `keyless: true`，因此 `hasKey()` 恒为真、装上就能拉目录。
- `kilo` / `opencode-zen` 还带 `freeMatch`：没配 key 时只列免费档，避免列出 469 个「选中必 401」的收费模型。
- 其余渠道没有 key 时不会去打上游（`skipped`），也不会用 seed 冒充 live。