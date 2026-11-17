// magpie 插件：免费池 FreePool
//
// 一个包、六个供应商。magpie 把包里的**每个具名导出**都当独立插件调用，
// 每个插件 `config()` 里注册自己的 provider —— 于是六张卡、六组登录态、
// 六份模型目录，互不覆盖（MULTI-PROVIDER.md 的骨架）。
//
// ═══════════════════════════════════════════════════════════════════════
// 为什么是这六家
// ═══════════════════════════════════════════════════════════════════════
//
// 它们都是「有免费额度、而且 magpie 的内置预设里没有」的 OpenAI 兼容渠道。
// 已被内置覆盖的不做成插件条目 —— 装两个插件抢同一个 provider id 只会互相覆盖：
//
//   Mistral / Groq / Google Gemini / OpenRouter / Kilo / OpenCode Zen /
//   Ollama Cloud / NVIDIA NIM          → `magpie provider add <preset> <key>`
//   Cloudflare Workers AI              → `@magpie-community/opencode-cloudflare-workers-ai-auth`
//
// 三家纯本地（Ollama / LM Studio / llama.cpp）也不在列表里：它们不需要额度，
// 也不需要登录态，插件卡片对它们没有意义。
//
// ═══════════════════════════════════════════════════════════════════════
// 三条铁律（照抄模板，一条都没省）
// ═══════════════════════════════════════════════════════════════════════
//
// 1. `config.models` 必须有内容 —— 用上次快照，没有快照用站点表里的 seed
// 2. `authorize()` 立刻返回 —— 这里六个都是 api key 型，没有 authorize，没有等待
// 3. `refresh` 返回的是合并 —— 这六家都不发 refresh_token，所以 refresh 恒为 undefined

import { CLIENT_UA, SITES, iconOf, staticModels } from "./src/sites.mjs"
import { REQUEST_QUIRKS, modelsFor, readSnapshot } from "./src/catalog.mjs"
import { fetchUsage } from "./src/usage.mjs"
import { createUsageCache } from "./src/usage-cache.mjs"
import { rewriteRefusal } from "./src/status.mjs"
import { rawCredentialOf, uidOf } from "./src/credential.mjs"

/** 这些字段由我们自己决定，一律不透传进来那份 */
const OWNED_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "host",
  "content-length",
  "content-encoding",
  "user-agent",
])

/**
 * 一个站点进，一个完整插件出。
 *
 * ⚠ 导出名必须**一行一行写**（见文件末尾）：导出名是 magpie 认插件的唯一凭据，
 *   循环生成 `Object.fromEntries` 出来的名字静态分析看不见，装了几个也数不清。
 */
function makePlugin(site) {
  const PROVIDER = site.id
  // 额度卡片会被频繁刷新：成功 60 秒、失败 5 秒，同 key 并发合并。
  // key 用凭据身份，不能用 provider id —— 同渠道多账号会串额度。
  const usageCache = createUsageCache({ ttlMs: 60_000, failTtlMs: 5_000 })

  return async (_ctx = {}, _options = {}) => ({
    // ═══ ① 声明 provider ═════════════════════════════════════════════
    config: async (cfg) => {
      cfg.provider ??= {}
      cfg.provider[PROVIDER] ??= {
        name: site.name,
        npm: "@ai-sdk/openai-compatible",
        api: site.base,
        // 未登录时也要有内容：上次成功的目录优先，没有就用 seed（不编不存在的模型）
        models: readSnapshot(site) ?? staticModels(site),
      }
    },

    auth: {
      provider: PROVIDER,
      // 每个站点一张图：六张卡并排时用户靠它区分，共用一个图标等于让他们选错
      icon: iconOf(site),
      maxConcurrency: 2,
      refreshLead: 0,

      // ═══ ② 登录：这六家都是粘贴 API key ═══════════════════════════
      //
      // ⚠ 刻意**不写 authorize、不写 prompts**：magpie 只把 prompts 的答案传给
      //   authorize，而用户在 key 输入框里填的值根本进不到插件里；
      //   没有 authorize 时宿主直接存 `{ type: "api", key }`，这正是我们要的。
      methods: [
        {
          type: "api",
          label: site.keyOptional ? `粘贴 ${site.name} 的 key（可留空）` : `粘贴 ${site.name} 的 API key`,
          placeholder: site.keyOptional
            ? `留空也能用（限额更低）；要更高额度去 ${site.keyUrl} 领 key`
            : `在 ${site.keyUrl} 生成`,
        },
      ],

      // ═══ ③ 续期：API key 没有有效期，不续期 ═══════════════════════
      async refresh() {
        return undefined
      },

      // ═══ ④ 请求接管 ═══════════════════════════════════════════════
      async loader(getAuth) {
        const auth = await getAuth()
        const key = rawCredentialOf(auth)
        if (!key && !site.keyOptional) return {}

        return {
          baseURL: site.base,
          apiKey: key,
          headers: {
            // 显式 UA：不设的话宿主把 `magpie/<version>` 透传上去，网关会当成第三方客户端
            "user-agent": CLIENT_UA,
          },

          async fetch(input, init) {
            // 每次重新读 auth —— 用户可能刚换了 key
            const fresh = rawCredentialOf(await getAuth())
            if (!fresh && !site.keyOptional) throw new Error(`${site.name} 未登录：先粘贴 API key`)

            const request = input instanceof Request ? input : null
            const url =
              typeof input === "string" ? input : input instanceof URL ? input.toString() : request?.url ?? ""

            const incoming = new Headers(init?.headers ?? request?.headers ?? {})
            const headers = {
              "content-type": "application/json",
              "user-agent": CLIENT_UA,
              accept: "text/event-stream",
            }
            if (fresh) headers.authorization = `Bearer ${fresh}`
            for (const [name, value] of incoming) {
              if (OWNED_HEADERS.has(name.toLowerCase())) continue
              headers[name] = value
            }

            let body = init?.body
            if (body === undefined && request) body = await request.text()

            // 上游不认的字段：只删不改值（目前只有 Cohere 兼容层需要）
            const quirk = site.sanitize ? REQUEST_QUIRKS[site.sanitize] : null
            if (quirk && typeof body === "string") {
              try {
                const parsed = JSON.parse(body)
                const next = quirk(parsed)
                if (next) body = JSON.stringify(next)
              } catch {
                // 不是 JSON 就原样发，让上游自己去报错
              }
            }

            const res = await fetch(url, {
              method: init?.method ?? request?.method ?? "POST",
              headers,
              body,
              signal: init?.signal ?? request?.signal ?? AbortSignal.timeout(300_000),
            })

            // 只分类 400/422 的明确余额/渠道/模型/限流错误；SSE 与其它响应原样返回
            return rewriteRefusal(res)
          },
        }
      },

      // ═══ ⑤ 额度：只有有接口的站点才注册这个钩子 ═══════════════════
      //
      // 没有额度接口的站点**不写 usage** —— magpie 就用 key 后四位显示这张卡，
      // 而不是画一个 100% 的假进度条（那还会让它在智能路由里排到队首）。
      ...(site.quota
        ? {
            async usage(getAuth) {
              const auth = await getAuth()
              const key = rawCredentialOf(auth)
              if (!key) return { error: `未登录 ${site.name}`, windows: [] }

              const cacheKey = uidOf(auth)
              if (!cacheKey) return { error: "未登录", windows: [] }

              try {
                return await usageCache.readSWR(
                  String(cacheKey),
                  () => fetchUsage(site, key, { uid: cacheKey }),
                  { timeoutMs: 12_000 },
                )
              } catch (error) {
                // 登录被拒 → 让宿主标账号；其它失败 → 卡片上显示原因
                if (error?.signIn) throw error
                return { error: String(error?.message ?? error), windows: [] }
              }
            },
          }
        : {}),

      // ═══ ⑥ 签到：这六家都没有每日签到 ═════════════════════════════
      //
      // 返回 `inactive` 而不是不实现：卡片上不画按钮，比点了才说「没有」好。
      async checkin() {
        return { outcome: "inactive", message: `${site.name} 没有每日签到` }
      },
    },

    // ═══ ⑦ 每账号的模型目录 ═══════════════════════════════════════════
    provider: {
      id: PROVIDER,

      async models(provider, { auth } = {}) {
        const key = rawCredentialOf(auth)
        if (!key && !site.keyOptional) return staticModels(site)
        return modelsFor(site, key)
      },
    },
  })
}

// ── 导出：一家一行 ──────────────────────────────────────────────────
//
// 导出名的数量 = 供应商的数量。加一家就是加一行，别循环生成。

export const Llm7AuthPlugin = makePlugin(SITES.llm7)
export const NararouteAuthPlugin = makePlugin(SITES.nararoute)
export const XkiroAuthPlugin = makePlugin(SITES.xkiro)
export const SambanovaAuthPlugin = makePlugin(SITES.sambanova)
export const CohereAuthPlugin = makePlugin(SITES.cohere)
export const HuggingfaceAuthPlugin = makePlugin(SITES.huggingface)
