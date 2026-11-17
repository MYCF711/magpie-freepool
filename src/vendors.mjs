// src/vendors.mjs —— 一家一条的免费池渠道表（聚合成一个供应商）
//
// 与 MULTI-PROVIDER 那种「一家一张卡」相反：这里**只有一张卡**（provider id `freepool`），
// 里面装 15 家渠道的模型。模型 id 统一加前缀 `<vendor>/<上游 id>`，路由靠前缀认人。
//
// 为什么要聚合而不是一家一张卡：
//   · 一张卡 = 一次登录 = 一次粘贴就把所有能用的 key 配齐（这 15 家里只有 LLM7 免 key）
//   · 卡片数量从 15 张压到 1 张，用户不会在供应商列表里迷路
//   · provider id 是新的（`freepool`），和 magpie 内置预设（mistral / groq / google …）不撞 id；
//     即使模型重复，也是「同一个上游被两条路引用」，不是 key 冲突 —— 两边的 key 各存各的。

import { contextOf as lookupContext } from "./model-context.mjs"

export const SDK = "@ai-sdk/openai-compatible"

/**
 * 出站 UA。**必须显式设**：不设的话宿主会把 `magpie/<version>` 透传给上游，
 * 网关按 `<product>/<version>` 形态识别「第三方客户端」。这些家的正常客户端就是 OpenAI SDK。
 */
export const CLIENT_UA = "OpenAI/Python 1.109.1"

/** 聚合后的 provider id —— 发布过就不能改 */
export const PROVIDER = "freepool"
export const PROVIDER_NAME = "免费池 FreePool"

/**
 * key 的写法（一次粘贴，多家配齐）：
 *
 *     llm7=sk-xxx;groq=gsk_yyy;openrouter=sk-or-zzz
 *
 * 也收 JSON：`{"groq":"gsk_yyy"}`。不带 `=` 的单个值按 llm7 的 key 处理（那家免 key）。
 * **只有 LLM7 真正免 key**，其余 14 家要各自官网的免费 key。
 */
export const KEY_FORMAT = "groq=gsk_…;openrouter=sk-or-…"

/**
 * 站点表字段：
 *   base        上游 OpenAI 兼容基址（`{account}` 由 key 里的账号段替换）
 *   keyless     完全没有 key 也能调（实测：LLM7 的 chat 层也放行）
 *   listAuth    /models 要不要带 Authorization（nararoute 带了就 401，实测）
 *   parse       目录解析器名
 *   sanitize    请求体清洗器名
 *   quota       有额度接口
 *   freeMatch   没配 key 时只列这批 id（免 key 渠道里付费档混在一起的过滤）
 *   accountKey  key 要写成 `<account>:<token>`（Cloudflare 的 account id）
 */
export const VENDORS = {
  llm7: {
    id: "llm7",
    label: "LLM7",
    base: "https://api.llm7.io/v1",
    keyUrl: "https://token.llm7.io/",
    keyless: true,
    parse: "llm7",
    seed: ["DeepSeek-V4-Flash-0731"],
    note: "免费池：匿名也能用（限额更低）",
  },
  nararoute: {
    id: "nararoute",
    label: "NaraRoute",
    base: "https://router.bynara.id/v1",
    keyUrl: "https://router.bynara.id/",
    listAuth: false,
    parse: "openai",
    seed: ["agnes-2.5-flash"],
    note: "免费池；它的 /models 只在匿名时放行，插件已按此处理",
  },
  xkiro: {
    id: "xkiro",
    label: "xKiro",
    base: "https://api.xkiro.com/v1",
    keyUrl: "https://xkiro.com/",
    parse: "xkiro",
    quota: "xkiro",
    seed: ["google/gemini-3.6-flash"],
    note: "免费池：账户自带免费 token 窗口（卡片读 /usage）",
  },
  sambanova: {
    id: "sambanova",
    label: "SambaNova",
    base: "https://api.sambanova.ai/v1",
    keyUrl: "https://cloud.sambanova.ai/apis",
    parse: "openai",
    seed: ["GLM-5.3"],
    note: "免费试用额度",
  },
  cohere: {
    id: "cohere",
    label: "Cohere",
    base: "https://api.cohere.ai/compatibility/v1",
    keyUrl: "https://dashboard.cohere.com/api-keys",
    parse: "cohere",
    sanitize: "cohere",
    seed: ["command-a-plus-05-2026"],
    note: "Trial key 限速额度；兼容层不认的字段插件会在出站前删掉",
  },
  huggingface: {
    id: "huggingface",
    label: "Hugging Face",
    base: "https://router.huggingface.co/v1",
    keyUrl: "https://huggingface.co/settings/tokens",
    parse: "huggingface",
    seed: ["Qwen/Qwen3-Coder-480B-A35B-Instruct:fastest"],
    note: "每月少量推理额度",
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    base: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1",
    root: "https://api.cloudflare.com/client/v4",
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    parse: "cloudflare",
    accountKey: true,
    seed: ["@cf/moonshotai/kimi-k2.6"],
    note: "key 写成 `账号ID:API_TOKEN`；每天 10k Neurons 免费额度",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    base: "https://api.mistral.ai/v1",
    keyUrl: "https://console.mistral.ai/",
    parse: "openai",
    seed: ["devstral-small-latest"],
    note: "Experiment 免费层（限速）",
  },
  groq: {
    id: "groq",
    label: "Groq",
    base: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    parse: "openai",
    seed: ["llama-3.3-70b-versatile"],
    note: "免费层按模型给每日 token 上限",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey",
    parse: "openai",
    seed: ["gemini-3.1-flash-lite"],
    note: "AI Studio 免费层（限速）",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    base: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    parse: "openai",
    seed: ["openrouter/free"],
    note: "带 :free 的模型免费（有日限额）",
  },
  kilo: {
    id: "kilo",
    label: "Kilo Gateway",
    base: "https://api.kilo.ai/api/gateway",
    keyUrl: "https://kilo.ai",
    // 实测：kilo-auto/free 不带任何凭据也回 200 并给出正文（付费档才要登录）
    keyless: true,
    // 没配 key 时只列免费档：这个网关 469 个模型里绝大多数要登录，列出来选中必 401
    freeMatch: /^kilo-auto\//,
    parse: "openai",
    seed: ["kilo-auto/free"],
    note: "kilo-auto/free 走免费档",
  },
  "opencode-zen": {
    id: "opencode-zen",
    label: "OpenCode Zen",
    base: "https://opencode.ai/zen/v1",
    keyUrl: "https://opencode.ai/auth",
    // 实测：免费模型不带凭据也能调（返回 429 是「免费额度用尽」，不是缺凭据）
    keyless: true,
    freeMatch: /(-free$)|(^big-pickle$)/i,
    parse: "openai",
    seed: ["deepseek-v4.1-flash-free"],
    note: "Zen 的免费模型",
  },
  "ollama-cloud": {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    base: "https://ollama.com/v1",
    keyUrl: "https://ollama.com/settings/keys",
    parse: "openai",
    seed: ["qwen3-coder:480b"],
    note: "Free 计划的起始额度",
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA NIM",
    base: "https://integrate.api.nvidia.com/v1",
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    parse: "openai",
    seed: ["nvidia/nemotron-3-ultra-550b-a55b"],
    note: "build.nvidia.com 的免费额度",
  },
}

/** 顺序即模型列表里的分组顺序 */
export const VENDOR_LIST = [
  VENDORS.llm7,
  VENDORS.nararoute,
  VENDORS.xkiro,
  VENDORS.sambanova,
  VENDORS.cohere,
  VENDORS.huggingface,
  VENDORS.cloudflare,
  VENDORS.mistral,
  VENDORS.groq,
  VENDORS.gemini,
  VENDORS.openrouter,
  VENDORS.kilo,
  VENDORS["opencode-zen"],
  VENDORS["ollama-cloud"],
  VENDORS.nvidia,
]

export const VENDOR_IDS = VENDOR_LIST.map((v) => v.id)

/** 模型 id 的前缀分隔符：`llm7/DeepSeek-V4-Flash-0731` */
export const MODEL_PREFIX_SEP = "/"

/** 从模型 id 里认出是哪一家；认不出返回 null（路由据此回 404，只搁置这一个模型） */
export function vendorOfModel(modelId) {
  const id = String(modelId ?? "")
  const index = id.indexOf(MODEL_PREFIX_SEP)
  if (index <= 0) return null
  const vendor = VENDORS[id.slice(0, index)]
  if (!vendor) return null
  return { vendor, upstreamId: id.slice(index + 1) }
}

/** 聚合后的模型 id */
export function modelIdOf(vendor, upstreamId) {
  return `${vendor.id}${MODEL_PREFIX_SEP}${upstreamId}`
}

/**
 * 靠请求 URL 反查渠道 —— 前缀那一层万一丢了（宿主改行为、别的客户端直连），
 * 仍能从 host 认出是哪一家，不至于整卡失效。
 */
export function vendorOfUrl(url) {
  let host = ""
  try {
    host = new URL(String(url)).host.toLowerCase()
  } catch {
    return null
  }
  for (const vendor of VENDOR_LIST) {
    try {
      if (new URL(vendor.base.replace("{account}", "x")).host.toLowerCase() === host) return vendor
    } catch {
      continue
    }
  }
  return null
}

/** Cloudflare 这类账号级端点：把 {account} 换成 key 里的账号段 */
export function baseOf(vendor, account = "") {
  if (!vendor.base.includes("{account}")) return vendor.base
  return vendor.base.replace("{account}", encodeURIComponent(account || "missing-account"))
}

/**
 * 单条模型条目。**api.url 指向它自己的上游** —— 一张卡里 15 个 host，
 * 靠条目自带 url 分流，而不是靠 loader 的 baseURL（那个是整张卡一个值）。
 */
export function entryOf(vendor, upstreamId, { name, context, maxOutput, vision = false, reasoning = false, account = "" } = {}) {
  const id = modelIdOf(vendor, upstreamId)
  const knownContext = Number.isFinite(context) && context > 0 ? context : lookupContext(upstreamId)
  const limit = knownContext
    ? { context: knownContext, output: Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : 64_000 }
    : undefined
  return {
    id,
    name: name ? `${vendor.label} · ${name}` : `${vendor.label} · ${upstreamId}`,
    // ⚠ api.id 必须是**带前缀**的那个 id：宿主是把 api.id 原样当请求里的 model 发出来的
    // （实测：写成裸 id 时会收到裸 id，渠道前缀就丢了）。loader 在出站前会把它切回上游 id。
    api: { id, url: baseOf(vendor, account), npm: SDK },
    status: "active",
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    ...(limit ? { limit } : {}),
    modalities: { input: vision ? ["text", "image"] : ["text"], output: ["text"] },
    capabilities: {
      temperature: true,
      reasoning: !!reasoning,
      toolcall: true,
      attachment: !!vision,
      // 五个模态键必须显式布尔：省略 image ≠ text
      input: { text: true, image: !!vision, audio: false, video: false, pdf: false },
      output: { text: true },
    },
  }
}

/** 兜底目录：每家一条 seed，只在「一次都没成功拉到过」时使用 */
/** 一家的 seed（未配 key 的渠道要不要出现在列表里，由 models 钩子按选项决定） */
export function seedModelsOf(vendor, account = "") {
  const out = {}
  for (const upstreamId of vendor.seed || []) {
    // 需要 key 的渠道在名字里写清楚：用户一眼能看出哪几家还不能用
    const name = vendor.keyless ? undefined : `${upstreamId} · 需 key`
    const entry = entryOf(vendor, upstreamId, { name, account })
    out[entry.id] = entry
  }
  return out
}

export function seedModels(account = "") {
  const out = {}
  for (const vendor of VENDOR_LIST) Object.assign(out, seedModelsOf(vendor, account))
  return out
}
