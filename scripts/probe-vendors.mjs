#!/usr/bin/env node
// scripts/probe-vendors.mjs —— 逐家实测「免 key / 有 key」两种可用性，并回写证据表
//
//   node scripts/probe-vendors.mjs            # 只探免 key（无凭据），打印表格
//   node scripts/probe-vendors.mjs --write    # 同上，并把 docs/availability.md 的表格块替换掉
//   GROQ_API_KEY=gsk_… OPENROUTER_API_KEY=sk-or-… node scripts/probe-vendors.mjs --write
//
// 有 key 的渠道用环境变量喂：<VENDORID 大写、连字符换下划线>_API_KEY，
// 例如 OPENCODE_ZEN_API_KEY、OLLAMA_CLOUD_API_KEY、CLOUDFLARE_API_KEY="账号ID:token"。
// 没给 key 的渠道，「有 key」一栏就写「未测」—— 不猜、不编。
//
// 为什么要有这个脚本：docs/availability.md 是**证据**，手写会过期。每次自检轮跑一遍 --write，
// 表里的每一行都来自刚刚发出的请求。

import { readFileSync, writeFileSync } from "node:fs"
import { VENDOR_LIST } from "../src/vendors.mjs"

const START = "<!-- probe:start -->"
const END = "<!-- probe:end -->"
const DOC = new URL("../docs/availability.md", import.meta.url)
const TIMEOUT = 30_000

function envKey(vendor) {
  const name = vendor.id.toUpperCase().replace(/-/g, "_") + "_API_KEY"
  return String(process.env[name] || "").trim()
}

function listUrl(vendor) {
  if (vendor.parse === "cloudflare") {
    const root = vendor.root || vendor.base.split("/accounts/")[0]
    return `${root}/accounts/probe/ai/models/search?format=openrouter`
  }
  return `${vendor.base}/models`
}

async function probeList(vendor, key) {
  const headers = { "user-agent": "OpenAI/Python 1.109.1", accept: "application/json" }
  if (key && vendor.listAuth !== false) headers.authorization = `Bearer ${key}`
  try {
    const res = await fetch(listUrl(vendor), { headers, signal: AbortSignal.timeout(TIMEOUT) })
    let count = 0
    try {
      const json = await res.json()
      count = (json?.data || json?.result || json?.models || []).length
    } catch {
      // 非 JSON（例如 403 的 HTML）就不数条数
    }
    return { code: String(res.status), count }
  } catch (error) {
    return { code: /Timeout/i.test(String(error?.name)) ? "TIMEOUT" : "NET", count: 0 }
  }
}

async function probeChatOnce(vendor, key) {
  const model = (vendor.seed || [])[0]
  if (!model) return "—"
  const base = vendor.base.replace("{account}", "probe")
  const headers = { "content-type": "application/json", "user-agent": "OpenAI/Python 1.109.1" }
  if (key && vendor.listAuth !== false) headers.authorization = `Bearer ${key}`
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 4 }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const text = await res.text()
    if (res.status === 200) return `**200 有正文**`
    if (res.status === 429) return "429（额度用尽，非缺凭据）"
    if (res.status === 401 || res.status === 403) return String(res.status)
    return `${res.status} ${text.slice(0, 40).replace(/\|/g, "/")}`
    } catch (error) {
    return /Timeout/i.test(String(error?.name)) ? "TIMEOUT" : "NET"
  }
}

/** 对话探针：冷启动经常超过 30 秒（llm7 实测），失败一次重试一次再下结论 */
async function probeChat(vendor, key) {
  const first = await probeChatOnce(vendor, key)
  if (first !== "TIMEOUT" && first !== "NET") return first
  const second = await probeChatOnce(vendor, key)
  return second === first ? first : second
}

const verdict = (row) => {
  if (row.kChat.startsWith("**200")) return "免 key 可用"
  if (row.list === "200" && row.kChat === "429（额度用尽，非缺凭据）") return "免 key 可用（限流）"
  if (row.list === "200") return "目录免 key，对话要 key"
  if (row.list === "404") return "账号级端点"
  if (row.list === "403") return "本机出口被挡"
  if (row.list === "401") return "要凭据"
  return "本机不可达"
}

const rows = []
for (const vendor of VENDOR_LIST) {
  const key = envKey(vendor)
  const kList = await probeList(vendor, "")
  const kChat = await probeChat(vendor, "")
  const wList = key ? await probeList(vendor, key) : null
  const wChat = key ? await probeChat(vendor, key) : null
  rows.push({
    vendor: vendor.id,
    keyless: !!vendor.keyless,
    list: kList.code,
    count: kList.count,
    kChat,
    wList: wList ? wList.code : "未测",
    wChat: wChat ?? "未测",
  })
  console.error(`${vendor.id.padEnd(13)} 免key:${kList.code}/${kList.count} chat:${kChat}  有key:${wList ? wList.code : "未测"}`)
}

const table = [
  START,
  "",
  `| 渠道 | 免 key 目录 | 条数 | 无凭据 chat | 有 key 目录 | 有 key chat | 结论 |`,
  `|---|---|---|---|---|---|---|`,
  ...rows.map((r) => {
    const v = verdict(r)
    return `| ${r.vendor} | ${r.list} | ${r.count} | ${r.kChat} | ${r.wList} | ${r.wChat} | ${v} |`
  }),
  "",
  `_生成时间：${new Date().toISOString()}（\`node scripts/probe-vendors.mjs --write\`）_`,
  "",
  END,
].join("\n")

if (process.argv.includes("--write")) {
  const text = readFileSync(DOC, "utf8")
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 || end === -1) {
    console.error(`docs/availability.md 里找不到 ${START} / ${END} 标记，先补上再 --write`)
    process.exit(2)
  }
  writeFileSync(DOC, text.slice(0, start) + table + text.slice(end + END.length))
  console.log("已回写 docs/availability.md")
} else {
  console.log(table)
}
