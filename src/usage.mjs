// src/usage.mjs —— 额度读取。目前只有 xKiro 有可读的额度接口，其余五家没有。
//
// 为什么不全写：没有接口就写不出来，编一个数字比不显示更糟 ——
// 额度窗口同时是 magpie **画卡片**和**智能路由排序**的输入，
// 编出来的 `used` 会让这个号在路由里被排到不该在的位置（HOOKS 三 / 坑 24）。
// 所以：没有接口的站点**不注册 usage 钩子**，卡片上就是没有进度条，而不是 100%。

import { uidOf } from "./credential.mjs"
import { usage as buildUsage, usageWindow } from "./quota.mjs"

const QUOTA_TIMEOUT_MS = 10_000

/** 从几种常见拼写里取第一个有限数字 */
function pickNumber(obj, names) {
  for (const name of names) {
    const value = obj?.[name]
    const n = Number(value)
    if (value != null && String(value).trim() !== "" && Number.isFinite(n)) return n
  }
  return undefined
}

function pickString(obj, names) {
  for (const name of names) {
    const value = obj?.[name]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

/**
 * 把一家上游的额度响应折成 magpie 的窗口。
 *
 * 只认三件能验证的事：
 *   ① `windows[]` 里同时有 used 与 limit 的 → 占比型窗口
 *   ② `free_tokens` 里同时有 remaining 与 total 的 → 数量型窗口
 *   ③ 全部解析不出来 → 返回空 windows（卡片上没有条，但不撒谎）
 */
export function windowsOf(payload) {
  const windows = []

  const rows = Array.isArray(payload?.windows) ? payload.windows : []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const name = pickString(row, ["name", "label", "kind", "period"]) || "额度"
    const used = pickNumber(row, ["used", "used_tokens", "consumed", "usage"])
    const limit = pickNumber(row, ["limit", "total", "limit_tokens", "quota", "max"])
    const resetsAt = row.resets_at ?? row.reset_at ?? row.resetsAt ?? row.runs_out_at
    const unit = pickString(row, ["unit"]) || "tokens"

    if (used !== undefined && limit !== undefined && limit > 0) {
      windows.push(usageWindow({ name, amount: used, limit, unit, resetsAt }))
      continue
    }
    const balance = pickNumber(row, ["remaining", "left", "balance", "remaining_tokens"])
    if (balance !== undefined) {
      windows.push(usageWindow({ name, balance, unit }))
      continue
    }
    const display = pickString(row, ["display", "text", "message"])
    if (display) windows.push(usageWindow({ name, textOnly: true, display }))
  }

  const free = payload?.free_tokens
  if (free && typeof free === "object") {
    const total = pickNumber(free, ["total", "limit", "quota", "granted"])
    const remaining = pickNumber(free, ["remaining", "left", "balance", "available"])
    const used = pickNumber(free, ["used", "consumed", "spent"])
    if (total !== undefined && total > 0) {
      const amount = used ?? (remaining !== undefined ? total - remaining : undefined)
      if (amount !== undefined) {
        windows.push(usageWindow({ name: "免费 token", amount, limit: total, unit: "tokens" }))
      }
    } else if (remaining !== undefined) {
      windows.push(usageWindow({ name: "免费 token", balance: remaining, unit: "tokens" }))
    }
  }

  return windows
}

/**
 * 读一家上游的额度。返回 magpie `usage` 钩子要的形状。
 *
 * 401/403 → 抛带 signIn 的错误（宿主标账号），其它失败 → 返回 error 文案（卡片显示原因），
 * **不要**抛：抛出去宿主只记成「读取失败」，用户看不到到底是 key 不对还是上游挂了。
 */
export async function fetchUsage(site, key, { uid } = {}) {
  if (!key) return { error: `${site.name} 需要先填 key 才能读额度`, windows: [] }
  const url = `${site.base.replace(/\/+$/, "")}/usage`

  let res
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${key}`, "user-agent": "OpenAI/Python 1.109.1" },
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
    })
  } catch (error) {
    return { error: `额度读取失败：${String(error?.message || error)}`, windows: [] }
  }

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(`${site.name} 拒绝了这把 key（HTTP ${res.status}）`), { signIn: "expired" })
  }
  if (!res.ok) return { error: `${site.name} 额度接口返回 HTTP ${res.status}`, windows: [] }

  const payload = await res.json().catch(() => null)
  if (!payload || typeof payload !== "object") {
    return { error: `${site.name} 额度接口返回的不是 JSON`, windows: [] }
  }

  const windows = windowsOf(payload)
  return buildUsage({
    user: pickString(payload, ["account", "user", "email", "name"]) || String(uid || ""),
    windows,
  })
}
