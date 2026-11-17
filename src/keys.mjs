// src/keys.mjs —— 一次粘贴、多家配齐
//
// 聚合之后只有**一份**凭据（auth.key 一个字符串），所以格式必须简单到能一眼看懂：
//
//     groq=gsk_xxx;openrouter=sk-or-yyy;cloudflare=账号ID:token
//
// 也接受 JSON（`{"groq":"gsk_xxx"}`）。不带 `=` 的单个值按 llm7 处理 ——
// 那家没有 key 也能用，用户随手贴个占位符不该报错。

import { VENDOR_IDS, VENDORS } from "./vendors.mjs"

/** 常见别名 → 站点 id（用户贴 key 时不会去查文档，容忍几种写法） */
const ALIASES = {
  "ollama": "ollama-cloud",
  "ollamacloud": "ollama-cloud",
  "opencode": "opencode-zen",
  "zen": "opencode-zen",
  "nvidia-nim": "nvidia",
  "nim": "nvidia",
  "google": "gemini",
  "hf": "huggingface",
  "samba": "sambanova",
  "nara": "nararoute",
  "mistralai": "mistral",
  "cf": "cloudflare",
}

function normalizeId(name) {
  const key = String(name || "").trim().toLowerCase()
  if (!key) return ""
  if (VENDORS[key]) return key
  if (ALIASES[key]) return ALIASES[key]
  // `groq API key` 这种带后缀的写法也认
  const first = key.split(/\s+/)[0]
  if (VENDORS[first]) return first
  if (ALIASES[first]) return ALIASES[first]
  return ""
}

/**
 * 解析一份 key 串。返回 `{ keys, account, unknown }`：
 *   keys     'vendoId' → key（空串表示这家没配）
 *   account  Cloudflare 之类账号级端点的账号段
 *   unknown  认不出的条目（原样回给用户看，不静默丢）
 */
export function parseKeys(raw) {
  const text = String(raw || "").trim()
  const keys = {}
  const unknown = []
  let account = ""

  if (!text) return { keys, account, unknown }

  // JSON 形态
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text)
      for (const [name, value] of Object.entries(parsed || {})) {
        const id = normalizeId(name)
        if (!id) {
          unknown.push(String(name))
          continue
        }
        keys[id] = String(value ?? "").trim()
      }
      account = cloudflareAccount(keys)
      return { keys, account, unknown }
    } catch {
      // 不是合法 JSON 就按行解析，交给下面处理
    }
  }

  const chunks = text.split(/[;\n]+/).map((chunk) => chunk.trim()).filter(Boolean)
  for (const chunk of chunks) {
    const eq = chunk.indexOf("=")
    if (eq === -1) {
      // 只有一个裸值：按 llm7 的 key 处理（那家免 key，不会因此报错）
      if (chunks.length === 1) keys.llm7 = chunk
      else unknown.push(chunk)
      continue
    }
    const id = normalizeId(chunk.slice(0, eq))
    if (!id) {
      unknown.push(chunk.slice(0, eq))
      continue
    }
    keys[id] = chunk.slice(eq + 1).trim()
  }

  account = cloudflareAccount(keys)
  return { keys, account, unknown }
}

/** Cloudflare 的 key 写成 `<account>:<token>`，账号段提出来单独用 */
function cloudflareAccount(keys) {
  const value = String(keys?.cloudflare || "")
  if (!value) return ""
  const index = value.indexOf(":")
  return index > 0 ? value.slice(0, index).trim() : ""
}

/** 这家配了 key 吗（免 key 的站点永远算配好） */
export function hasKey(parsed, vendorId) {
  const vendor = VENDORS[vendorId]
  if (!vendor) return false
  if (vendor.keyless) return true
  return Boolean(String(parsed?.keys?.[vendorId] || "").trim())
}

/** 真正发给上游的 key：Cloudflare 去掉账号段，其余原样 */
export function keyOf(parsed, vendorId) {
  const vendor = VENDORS[vendorId]
  const raw = String(parsed?.keys?.[vendorId] || "").trim()
  if (!raw) return ""
  if (vendor?.accountKey) {
    const index = raw.indexOf(":")
    return index > 0 ? raw.slice(index + 1).trim() : ""
  }
  return raw
}

/** 卡片上显示「配了哪几家」，避免用户以为一次粘贴没生效 */
export function summaryOf(parsed) {
  const ready = VENDOR_IDS.filter((id) => hasKey(parsed, id))
  // 认不出的名字必须说出来：静默忽略会让用户以为配上了，实际没生效
  const ignored = Array.isArray(parsed?.unknown) && parsed.unknown.length ? `；认不出的名字已忽略：${parsed.unknown.join(", ")}` : ""
  if (!ready.length) return `未配置任何 key${ignored}`
  return `${ready.length} 家已配置：${ready.join(", ")}${ignored}`
}

/** 给前端的账号名：不把 key 写进卡片，只用家数 + 首尾几位做区分 */
export function accountLabelOf(parsed) {
  const ready = VENDOR_IDS.filter((id) => hasKey(parsed, id) && !VENDORS[id].keyless)
  if (!ready.length) return "仅免 key 渠道"
  return `${ready.length} 家`
}
