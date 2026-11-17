// src/catalog.mjs —— 15 家的目录合并、快照，以及两家上游的请求体清洗
//
// 聚合之后目录有两条铁律：
//   ① **只有配了 key（或免 key）的家才去拉** —— 没 key 还列出来，用户选了必然 401
//   ② **一家失败不拖累其他家** —— 用 allSettled 逐家收，成功的照常进表；
//      全失败才退回快照 / seed（返回空表等于告诉宿主「这家没模型」）

import { fileOf, readJson, writeJson } from "./store.mjs"
import { CLIENT_UA, VENDOR_LIST, VENDORS, entryOf, seedModels } from "./vendors.mjs"
import { hasKey, keyOf } from "./keys.mjs"

const LIST_TIMEOUT_MS = 15_000

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined)

/** 不像 chat 模型的 id：embedding / rerank / 语音 / 生图 —— 列出来选中必报错 */
const NOT_CHAT = /embed|rerank|tts|whisper|moderation/i
const IMAGE_LIKE = /(^|[-_/])(image|imagen|imagine|dall-e|flux|seedream|cogview|sdxl|stable-diffusion|wanx|kolors|banana)/i

/** 一条上游模型能不能进 magpie 的模型表（形状对但选不得的东西不列） */
function usable(id) {
  const value = String(id || "").trim()
  if (!value) return false
  if (NOT_CHAT.test(value)) return false
  if (IMAGE_LIKE.test(value)) return false
  return true
}

// ── 快照 ────────────────────────────────────────────────────────────

export function snapshotFile() {
  return fileOf("snapshot", { siteId: "freepool" })
}

export function readSnapshot() {
  const raw = readJson(snapshotFile(), null)
  const models = raw?.models && typeof raw.models === "object" ? raw.models : null
  if (!models) return null
  return Object.keys(models).length ? models : null
}

export function writeSnapshot(models) {
  try {
    writeJson(snapshotFile(), { at: new Date().toISOString(), models })
  } catch {
    // 快照写不进去不影响这次请求
  }
}

// ── 各家 /models 的解析 ──────────────────────────────────────────────

/** 上游常见的四种窗口写法：数字、对象包一层、limit 包一层 */
function contextFrom(item) {
  return (
    num(item?.context_length) ??
    num(item?.context_window) ??
    num(item?.context_window?.tokens) ??
    num(item?.limit?.context)
  )
}

/** 能力字段各家拼写不同：布尔在 capabilities 或顶层，或落在模态数组里 */
function visionFrom(item) {
  for (const flag of [item?.capabilities?.vision, item?.vision]) {
    if (typeof flag === "boolean") return flag
  }
  for (const list of [item?.modalities?.input, item?.architecture?.input_modalities]) {
    if (Array.isArray(list) && list.some((m) => /image/i.test(String(m)))) return true
  }
  return false
}

function parseOpenAI(raw) {
  const rows = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.models) ? raw.models : []
  return rows
    .map((item) => {

      const id = String(item?.id ?? item?.model ?? "").trim()
      if (!usable(id)) return null
      return {
        id,
        name: String(item?.display_name ?? item?.name ?? id),
        context: contextFrom(item),
        maxOutput: num(item?.max_output_tokens) ?? num(item?.max_completion_tokens) ?? num(item?.limit?.output),
        vision: visionFrom(item),
        reasoning: item?.capabilities?.reasoning === true || item?.reasoning === true,
      }
    })
    .filter(Boolean)
}

/** LLM7：条目要自报 model_type=chat / stream / tools_calling；缺字段的不列 */
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
        maxOutput: num(item?.max_output_tokens),
        vision: visionFrom(item),
        reasoning: item?.capabilities?.reasoning === true || item?.reasoning === true,
      }
    })
    .filter(Boolean)
}

const parseXkiro = parseOpenAI

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

/** Hugging Face：窗口只在所有 live 推理商给同一个数时才认 */
function parseHuggingface(raw) {
  const rows = Array.isArray(raw?.data) ? raw.data : []
  return rows
    .map((item) => {
      const id = String(item?.id ?? "").trim()
      if (!id) return null
      const live = Array.isArray(item?.providers) ? item.providers.filter((p) => p?.status === "live") : []
      const windows = live.map((p) => num(p?.context_length))
      const consensus = windows.length > 0 && windows.every((w) => w && w === windows[0]) ? windows[0] : undefined
      const inputs = Array.isArray(item?.architecture?.input_modalities) ? item.architecture.input_modalities : []
      return { id, name: String(item?.name ?? id), context: consensus, vision: inputs.includes("image"), reasoning: false }
    })
    .filter(Boolean)
}

/** Cloudflare：不是 /models，是 /ai/models/search?format=openrouter */
function parseCloudflare(raw) {
  const rows = Array.isArray(raw?.result) ? raw.result : Array.isArray(raw?.data) ? raw.data : []
  return rows
    .map((item) => {
      const id = String(item?.name ?? item?.id ?? "").trim()
      return id ? { id, name: String(item?.display_name ?? item?.description ?? id) } : null
    })
    .filter(Boolean)
}

const PARSERS = {
  openai: parseOpenAI,
  llm7: parseLlm7,
  xkiro: parseXkiro,
  cohere: parseCohere,
  huggingface: parseHuggingface,
  cloudflare: parseCloudflare,
}

/** 各家的目录地址 */
function listUrl(vendor, account) {
  if (vendor.parse === "cloudflare") {
    const root = vendor.root || vendor.base.split("/accounts/")[0]
    return `${root}/accounts/${encodeURIComponent(account || "missing-account")}/ai/models/search?format=openrouter`
  }
  return `${vendor.base.replace(/\/+$/, "")}/models`
}

/**
 * 拉一家的目录。失败一律抛，由调用方用 allSettled 兜。
 * 401/403 不抛 signIn：聚合卡里一家的 key 坏掉，不该把整张卡（其他 14 家）标成登录失效。
 */
export async function fetchVendorModels(vendor, key, account = "") {
  const headers = { accept: "application/json", "user-agent": CLIENT_UA }
  // 有的上游「带 key 反而拒绝」：nararoute 的 /models 只在完全匿名时放行（实测 2026-11-17）
  if (key && vendor.listAuth !== false) headers.authorization = `Bearer ${key}`

  const res = await fetch(listUrl(vendor, account), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? "（key 不对或没有权限）" : ""
    throw new Error(`${vendor.label} 返回 HTTP ${res.status}${hint}`)
  }

  const raw = await res.json().catch(() => null)
  if (!raw) throw new Error(`${vendor.label} 返回的不是 JSON`)

  let rows = (PARSERS[vendor.parse] || parseOpenAI)(raw).filter((row) => usable(row.id))
  // 免 key 渠道里付费档混在一起：没配 key 时只列实测能免凭据调用的那批
  if (vendor.keyless && !key && vendor.freeMatch) rows = rows.filter((row) => vendor.freeMatch.test(row.id))
  if (!rows.length) throw new Error(`${vendor.label} 没有可用的 chat 模型`)

  const out = {}
  for (const row of rows) {
    const entry = entryOf(vendor, row.id, {
      name: row.name,
      context: row.context,
      maxOutput: row.maxOutput,
      vision: row.vision,
      reasoning: row.reasoning,
      account,
    })
    out[entry.id] = entry
  }
  return out
}

/**
 * 聚合目录：只拉「配了 key 或免 key」的家，逐家收结果。
 *
 * @returns {{models: object, ok: string[], failed: {id:string,error:string}[], skipped: string[]}}
 */
export async function fetchAllModels(parsedKeys) {
  const targets = []
  const skipped = []
  for (const vendor of VENDOR_LIST) {
    if (hasKey(parsedKeys, vendor.id)) targets.push(vendor)
    else skipped.push(vendor.id)
  }

  const results = await Promise.allSettled(
    targets.map((vendor) => fetchVendorModels(vendor, keyOf(parsedKeys, vendor.id), parsedKeys.account)),
  )

  const models = {}
  const ok = []
  const failed = []
  results.forEach((result, index) => {
    const vendor = targets[index]
    if (result.status === "fulfilled") {
      ok.push(vendor.id)
      Object.assign(models, result.value)
      return
    }
    failed.push({ id: vendor.id, error: String(result.reason?.message || result.reason) })
  })

  return { models, ok, failed, skipped }
}

/** 目录钩子的统一出口：聚合 live → 快照 → seed，三层都不空 */
export async function modelsFor(parsedKeys) {
  try {
    const { models, ok } = await fetchAllModels(parsedKeys)
    if (ok.length) {
      writeSnapshot(models)
      return models
    }
  } catch {
    // 落到底下的快照 / seed
  }
  return readSnapshot() ?? seedModels(parsedKeys?.account)
}

// ── 两家上游的请求体清洗 ────────────────────────────────────────────

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

/** @returns {object|null} 改过就返回新对象，没改返回 null */
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

/** 供 index.mjs 的 loader 用：某家在某次请求里要不要清洗 body */
export function quirksOf(vendor) {
  return vendor?.sanitize ? REQUEST_QUIRKS[vendor.sanitize] : null
}

export { VENDORS }
