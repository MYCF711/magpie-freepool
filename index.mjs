// magpie 插件：免费池 FreePool（聚合版）
//
// **一张卡，15 家渠道**。模型 id 带前缀（`llm7/…`、`groq/…`），
// 每家条目的 `api.url` 指向它自己的上游，所以一张卡能同时打 15 个 host。
//
// ═══════════════════════════════════════════════════════════════════════
// 为什么聚合，而不是一家一张卡
// ═══════════════════════════════════════════════════════════════════════
//
// 这 15 家里只有 LLM7 完全免 key，其余 14 家都是「免费额度 + 各自官网领一把 key」。
// 做成 15 张卡 = 15 次登录；做成 1 张卡 = **一次粘贴**（`groq=…;openrouter=…;`）就把有的配齐。
//
// provider id 用的是新的 `freepool`，不和 magpie 内置预设（mistral / groq / google …）撞 id；
// 即使同一个上游被两条路引用，也是各自的 key 各存各的，不会互相覆盖。
//
// ═══════════════════════════════════════════════════════════════════════
// 三条铁律
// ═══════════════════════════════════════════════════════════════════════
//
// 1. `config.models` 必须有内容 —— 上次成功的快照，没有就用每家的 seed
// 2. 登录是 `api` 型、**没有 authorize** —— 宿主才会把输入框里的 key 串原样存下来
// 3. 一家的 key 坏了只影响这一家：回 401 + `X-Magpie-Sign-In: kept`，不把整张卡标成失效

import {
  CLIENT_UA,
  KEY_FORMAT,
  PROVIDER,
  PROVIDER_NAME,
  VENDORS,
  VENDOR_IDS,
  seedModels,
  vendorOfModel,
  vendorOfUrl,
} from "./src/vendors.mjs"
import { modelsFor, quirksOf, readSnapshot } from "./src/catalog.mjs"
import { accountLabelOf, hasKey, keyOf, parseKeys, summaryOf } from "./src/keys.mjs"
import { fetchUsage } from "./src/usage.mjs"
import { createUsageCache } from "./src/usage-cache.mjs"
import { rewriteRefusal } from "./src/status.mjs"
import { rawCredentialOf, uidOf } from "./src/credential.mjs"

/** 这些头由我们决定，一律不透传 */
const OWNED_HEADERS = new Set(["authorization", "x-api-key", "x-goog-api-key", "host", "content-length", "content-encoding", "user-agent"])

/** 目录里一家的 key 没配 / 坏了时，给用户一句能照做的话 */
function missingKeyHint(vendor) {
  return `没配 ${vendor.label} 的 key：去 ${vendor.keyUrl} 领一把，登录时写成 \`${vendor.id}=…\` 一起粘贴`
}

/** 只给这一个模型回 404 —— 宿主只搁置它，不换账号、不标失效 */
function modelNotFound(modelId) {
  return new Response(
    JSON.stringify({
      error: {
        type: "invalid_request_error",
        code: "model_not_found",
        message: `未知的模型 id：${modelId || "(空)"}。模型要写成 \`<渠道>/<模型>\`，例如 llm7/DeepSeek-V4-Flash-0731`,
      },
    }),
    { status: 404, headers: { "content-type": "application/json" } },
  )
}

/** 缺 key 回 401，但**显式声明不标账号**：同一张卡里别的渠道还是好的 */
function missingKeyResponse(vendor, modelId) {
  return new Response(
    JSON.stringify({
      error: { type: "invalid_request_error", code: "sign_in_required", message: missingKeyHint(vendor) },
    }),
    {
      status: 401,
      headers: { "content-type": "application/json", "x-magpie-sign-in": "kept" },
    },
  )
}

export const FreepoolAuthPlugin = async (_ctx = {}, _options = {}) => {
  // 额度卡片会被频繁刷新：成功 60 秒、失败 5 秒，同一串 key 的并发合并成一次
  const usageCache = createUsageCache({ ttlMs: 60_000, failTtlMs: 5_000 })

  return {
    // ═══ ① 声明 provider ═════════════════════════════════════════════
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[PROVIDER] ??= {
        name: PROVIDER_NAME,
        npm: "@ai-sdk/openai-compatible",
        // 卡片级的默认上游：真正逐请求的上游由每个模型的 api.url 决定
        api: VENDORS.llm7.base,
        models: readSnapshot() ?? seedModels(),
      }
    },

    auth: {
      provider: PROVIDER,
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMwZjc2NmUiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxNGI4YTYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI4IiBmaWxsPSJ1cmwoI2cpIi8+PGNpcmNsZSBjeD0iNDAiIGN5PSI0NCIgcj0iMTAiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuOTUiLz48Y2lyY2xlIGN4PSI4OCIgY3k9IjQ0IiByPSIxMCIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iMC41NSIvPjxjaXJjbGUgY3g9IjQwIiBjeT0iOTAiIHI9IjEwIiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjU1Ii8+PGNpcmNsZSBjeD0iODgiIGN5PSI5MCIgcj0iMTAiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuOTUiLz48cGF0aCBkPSJNNjQgNDB2NDgiIHN0cm9rZT0iI2ZmZmZmZiIgc3Ryb2tlLXdpZHRoPSI2IiBzdHJva2UtbGluZWNhcD0icm91bmQiIG9wYWNpdHk9IjAuMzUiLz48L3N2Zz4=",
      maxConcurrency: 4,
      refreshLead: 0,

      // ═══ ② 登录：一次粘贴，多家配齐 ═══════════════════════════════
      //
      // ⚠ 刻意不写 authorize、不写 prompts：宿主只把 prompts 的答案交给 authorize，
      //   输入框里的值进不到插件里；没有 authorize 时它直接存 `{ type: "api", key }`，
      //   而我们要的正是「原样存下这串 key」。
      methods: [
        {
          type: "api",
          label: "一次粘贴所有 key（只填你有的，LLM7 免 key 可留空）",
          placeholder: KEY_FORMAT,
        },
      ],

      // ═══ ③ 续期：这一串都是长期 API key，不续期 ═══════════════════
      async refresh() {
        return undefined
      },

      // ═══ ④ 请求接管：按模型前缀决定去哪个上游、用哪把 key ═════════
      async loader(getAuth) {
        return {
          // 不返回 baseURL：让每个模型的 api.url 决定上游（一张卡 15 个 host）
          headers: { "user-agent": CLIENT_UA },

          async fetch(input, init) {
            const parsed = parseKeys(rawCredentialOf(await getAuth()))

            const request = input instanceof Request ? input : null
            const url =
              typeof input === "string" ? input : input instanceof URL ? input.toString() : request?.url ?? ""

            let body = init?.body
            if (body === undefined && request) body = await request.text()

            // 从 body 里的 model 认渠道：这是整张卡分流的唯一依据
            let modelId = ""
            let payload = null
            if (typeof body === "string") {
              try {
                payload = JSON.parse(body)
                modelId = String(payload?.model ?? "")
              } catch {
                payload = null
              }
            } else if (body && typeof body === "object") {
              payload = body
              modelId = String(body.model ?? "")
            }

            // 前缀优先（唯一确定）；前缀丢了就靠 host 反查
            const matched = vendorOfModel(modelId)
            const byHost = matched ? null : vendorOfUrl(url)
            if (!matched && !byHost) return modelNotFound(modelId)

            const vendor = matched ? matched.vendor : byHost
            const upstreamId = matched ? matched.upstreamId : String(payload?.model ?? "")
            if (!hasKey(parsed, vendor.id)) return missingKeyResponse(vendor, modelId)

            const key = keyOf(parsed, vendor.id)

            const incoming = new Headers(init?.headers ?? request?.headers ?? {})
            const headers = { "content-type": "application/json", "user-agent": CLIENT_UA }
            if (key) headers.authorization = `Bearer ${key}`
            for (const [name, value] of incoming) {
              if (OWNED_HEADERS.has(name.toLowerCase())) continue
              headers[name] = value
            }

            // 上游不认的字段：只删不改值（目前只有 Cohere 兼容层需要）
            const quirk = quirksOf(vendor)
            if (quirk && payload) {
              const next = quirk({ ...payload, model: upstreamId })
              if (next) payload = next
            }
            // 把带前缀的 id 换回上游真正认的 id
            if (payload && payload.model !== upstreamId) payload = { ...payload, model: upstreamId }
            if (payload) body = JSON.stringify(payload)

            const res = await fetch(url, {
              method: init?.method ?? request?.method ?? "POST",
              headers,
              body,
              signal: init?.signal ?? request?.signal ?? AbortSignal.timeout(300_000),
            })

            return rewriteRefusal(res)
          },
        }
      },

      // ═══ ⑤ 额度：只有 xKiro 有可读接口，卡片就显示它 ═══════════════
      async usage(getAuth) {
        const auth = await getAuth()
        const parsed = parseKeys(rawCredentialOf(auth))
        const key = keyOf(parsed, "xkiro")
        if (!key) {
          return {
            error: `没配 xkiro 的 key，读不到额度（其余 ${VENDOR_IDS.length - 1} 家本来也没有额度接口）`,
            windows: [],
          }
        }

        const cacheKey = uidOf(auth)
        if (!cacheKey) return { error: "未登录", windows: [] }

        try {
          const result = await usageCache.readSWR(
            String(cacheKey),
            () => fetchUsage(VENDORS.xkiro, key),
            { timeoutMs: 12_000 },
          )
          return { ...result, user: summaryOf(parsed), plan: accountLabelOf(parsed) }
        } catch (error) {
          if (error?.signIn) throw error
          return { error: String(error?.message ?? error), windows: [] }
        }
      },

      // ═══ ⑥ 签到：这 15 家都没有每日签到 ═══════════════════════════
      async checkin() {
        return { outcome: "inactive", message: "免费池里的渠道都没有每日签到" }
      },
    },

    // ═══ ⑦ 模型目录：把配了 key 的家合并成一张表 ═══════════════════════
    provider: {
      id: PROVIDER,

      async models(provider, { auth } = {}) {
        const parsed = parseKeys(rawCredentialOf(auth))
        return modelsFor(parsed)
      },
    },
  }
}
