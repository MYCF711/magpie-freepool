// src/catalog.mjs —— 六家的模型目录、快照、以及两家的请求体清洗
//
// 三件事都在这儿，因为它们在真实故障里是同一个现场：目录拉不到、快照没写、
// 请求体被上游拒 400 —— 三者的表现都是「这个插件装了但没用」。

import { fileOf, readJson, writeJson } from "./store.mjs"
import { CLIENT_UA, SDK, entryOf, staticModels } from "./sites.mjs"

/** 目录请求超时：上游都是网关，10 秒还不回就别让用户在卡片前等着 */
const LIST_TIMEOUT_MS = 10_000

export function snapshotFile(site) {
  return fileOf("snapshot", { siteId: site.id })
}

/** 上次成功的目录。读不到就是「没有」，不抛（store 的三条规矩之一） */
export function readSnapshot(site) {
  const raw = readJson(snapshotFile(site), null)
  const models = raw?.models && typeof raw.models === "object" ? raw.models : null
  if (!models) return null
  // 快照是「原样回放」用的：把 api.url 重新绑到当前 base，改过 base 的旧快照也不会打到旧域名
  const out = {}
  for (const [id, entry] of Object.entries(models)) {
    if (!entry || typeof entry !== "object") continue
    out[id] = { ...entry, id, api: { id, url: site.base, npm: entry.api?.npm || SDK } }
  }
  return Object.keys(out).length ? out : null
}

export function writeSnapshot(site, models) {
  try {
    writeJson(snapshotFile(site), { base: site.base, at: new Date().toISOString(), models })
  } catch {
    // 快照写不进去不影响这次请求，下次再写
  }
}

// ── 各家 /models 的解析 ──────────────────────────────────────────────

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined)

/** 上游常见的四种窗口写法：数字、对象包一层、limit 包一层 */
function contextFrom(item) {
  return (
    num(item?.context_length) ??
    num(item?.context_window) ??
    num(item?.context_window?.tokens) ??
    num(item?.limit?.context)
  )
}

/** 能力字段各家拼写不同：布尔直接在 capabilities 里，或落在模态数组里 */
function visionFrom(item) {
  // 布尔在两处出现过：capabilities.vision（xKiro）与顶层 vision（NaraRoute）
  for (const flag of [item?.capabilities?.vision, item?.vision]) {
    if (typeof flag === "boolean") return flag
  }
  const arrays = [item?.modalities?.input, item?.architecture?.input_modalities]
  for (const list of arrays) {
    if (Array.isArray(list) && list.some((m) => /image/i.test(String(m)))) return true
  }
  return false
}

/** 通用 OpenAI 形状：data[].id + 上面那几种拼写 */
function parseOpenAI(raw) {
  const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.models) ? raw.models : []
  return rows
    .map((item) => {
      const id = String(item?.id ?? item?.model ?? "").trim()
      if (!id) return null
      return {
        id,
        name: String(item?.display_name ?? item?.name ?? id),
        context: contextFrom(item),
        maxOutput:
          num(item?.max_output_tokens) ?? num(item?.max_completion_tokens) ?? num(item?.limit?.output),
        vision: visionFrom(item),
        reasoning: item?.capabilities?.reasoning === true || item?.reasoning === true,
      }
    })
    .filter(Boolean)
}

/** LLM7：条目必须自报 model_type=chat / stream / tools_calling；缺字段的不列（不猜） */
function parseLlm7(raw) {
  const rows = Array.isArray(raw?.data) ? raw.data : []
  return rows
    .map((item) => {
      const id = String(item?.id ?? "").trim()
      if (!id) return null
      if (item?.model_type && String(item.model_type).toLowerCase() !== "chat") return null
      if (item?.stream === false) return null
      if (item?.tools_calling === false) return null
      return {
        id,
        name: String(item?.display_name ?? item?.name ?? id),
        context: contextFrom(item),
        maxOutput: num(item?.max_output_tokens) ?? num(item?.max_completion_tokens),
        vision: visionFrom(item),
        reasoning: item?.capabilities?.reasoning === true || item?.reasoning === true,
      }
    })
    .filter(Boolean)
}

/** xKiro：能力在 capabilities 里，窗口在 context_length / max_output_tokens */
function parseXkiro(raw) {
  return parseOpenAI(raw)
}

/** Cohere 兼容层：只有 id，没有能力字段 —— 不猜，全部按纯文本 */
function parseCohere(raw) {
  const rows = Array.isArray(raw?.data) ? raw.data : []
  return rows
    .map((item) => {
      const id = String(item?.id ?? "").trim()
      return id ? { id, name: String(item?.display_name ?? item?.name ?? id) } : null
    })
    .filter(Boolean)
}

/**
 * Hugging Face：上下文窗口**不按固定路径读**，而是看路由共识 ——
 * 只有当这条模型所有 live 的推理商给出的 context_length 完全一致时才认这个数。
 * 不一致说明它取决于具体后端，填任何一个都是猜。
 */
function parseHuggingface(raw) {
  const rows = Array.isArray(raw?.data) ? raw.data : []
  return rows
    .map((item) => {
      const id = String(item?.id ?? "").trim()
      if (!id) return null
      const live = Array.isArray(item?.providers) ? item.providers.filter((p) => p?.status === "live") : []
      const windows = live.map((p) => num(p?.context_length))
      const consensus =
        windows.length > 0 && windows.every((w) => w && w === windows[0]) ? windows[0] : undefined
      const inputs = Array.isArray(item?.architecture?.input_modalities) ? item.architecture.input_modalities : []
      return {
        id,
        name: String(item?.name ?? id),
        context: consensus,
        vision: inputs.includes("image"),
        reasoning: false,
      }
    })
    .filter(Boolean)
}

const PARSERS = {
  openai: parseOpenAI,
  llm7: parseLlm7,
  xkiro: parseXkiro,
  cohere: parseCohere,
  huggingface: parseHuggingface,
}

/**
 * 拉一次上游目录，转成 magpie 的模型表。
 *
 * 失败语义（三态，方向必须选对）：
 *   ① 整个接口失败 → 抛，调用方退回上次快照（**绝不返回空表**，那等于「这家没模型」）
 *   ② 接口成功但某条缺 id → 跳过那一条（不猜）
 *   ③ 401/403 → 抛带 signIn 的错误，让宿主标账号
 */
export async function fetchLiveModels(site, key) {
  const url = `${site.base.replace(/\/+$/, "")}/models`
  const headers = { accept: "application/json", "user-agent": CLIENT_UA }
  // 有的上游「带 key 反而拒绝」：nararoute 的 /models 只在完全匿名时放行（实测 2026-11-17，
  // 带任何 Authorization 都回 401）。这类站点在站点表里写 listAuth: false。
  if (key && site.listAuth !== false) headers.authorization = `Bearer ${key}`

  let res
  try {
    res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
  } catch (error) {
    throw new Error(`${site.name} 目录请求失败：${String(error?.message || error)}`)
  }

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(`${site.name} 拒绝了这把 key（HTTP ${res.status}）`), { signIn: "expired" })
  }
  if (!res.ok) {
    throw new Error(`${site.name} 目录请求返回 HTTP ${res.status}`)
  }

  const raw = await res.json().catch(() => null)
  if (!raw) throw new Error(`${site.name} 目录返回的不是 JSON`)

  const rows = (PARSERS[site.parse] || parseOpenAI)(raw)
  if (!rows.length) throw new Error(`${site.name} 目录里没有可用的 chat 模型`)

  const out = {}
  for (const row of rows) {
    out[row.id] = entryOf(site, row.id, {
      name: row.name,
      context: row.context,
      maxOutput: row.maxOutput,
      vision: row.vision,
      reasoning: row.reasoning,
    })
  }
  return out
}

/** 目录钩子的统一出口：live → 快照 → seed，三层都不空 */
export async function modelsFor(site, key) {
  try {
    const live = await fetchLiveModels(site, key)
    writeSnapshot(site, live)
    return live
  } catch (error) {
    // 登录被拒 → 交给宿主标账号，不要拿快照把「key 失效」盖成「看着还能用」
    if (error?.signIn) throw error
    // 目录暂时失败 → 上次快照优先，没有快照才退回 seed
    return readSnapshot(site) ?? staticModels(site)
  }
}

// ── 两家的请求体清洗 ────────────────────────────────────────────────
//
// 这些是「上游不认的字段」而不是「我们要改语义」，所以只删不改值。

/** Cohere 兼容层明确不认的 10 个 body 字段 + 每条 message 的 name */
const COHERE_UNSUPPORTED = [
  "audio",
  "logit_bias",
  "metadata",
  "modalities",
  "n",
  "parallel_tool_calls",
  "prediction",
  "service_tier",
  "store",
  "top_logprobs",
]

/** @returns {object|null} 改过就返回新对象，没改返回 null（调用方据此决定是否重算 content-length） */
export const REQUEST_QUIRKS = {
  cohere(body) {
    if (!body || typeof body !== "object") return null
    let changed = false
    const next = { ...body }
    for (const key of COHERE_UNSUPPORTED) {
      if (key in next) {
        delete next[key]
        changed = true
      }
    }
    if (Array.isArray(next.messages)) {
      const messages = next.messages.map((message) => {
        if (message && typeof message === "object" && "name" in message) {
          changed = true
          const { name: _drop, ...rest } = message
          return rest
        }
        return message
      })
      if (changed) next.messages = messages
    }
    return changed ? next : null
  },
}
