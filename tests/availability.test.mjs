// tests/availability.test.mjs —— 证据表与代码不能各说各话
//
// docs/availability.md 里的表格是 `node scripts/probe-vendors.mjs --write` 生成的**实测**结果。
// 这个测试不联网，只做两件事：
//   ① 15 家每一家都必须在表里出现（漏一行 = 有人加了渠道没探过）
//   ② 表里写「免 key 可用」的，代码里必须 keyless: true；反过来 keyless 的也必须被标成可用
//      —— 两边不一致，说明要么表过期了，要么 keyless 标错了（后果是用户装上用不了）

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { VENDOR_IDS, VENDORS } from "../src/vendors.mjs"

const doc = readFileSync(new URL("../docs/availability.md", import.meta.url), "utf8")
const block = doc.split("<!-- probe:start -->")[1]?.split("<!-- probe:end -->")[0] ?? ""

/** 把 markdown 表格解析成 { 渠道: { 结论, 无凭据chat } } */
function rows() {
  const out = {}
  for (const line of block.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim())
    if (cells.length < 9) continue
    const id = cells[1]
    if (!VENDORS[id]) continue
    out[id] = { list: cells[2], count: cells[3], kChat: cells[4], wList: cells[5], wChat: cells[6], verdict: cells[7] }
  }
  return out
}

test("证据表覆盖全部渠道，一个都不少", () => {
  const parsed = rows()
  for (const id of VENDOR_IDS) assert.ok(parsed[id], `docs/availability.md 缺少 ${id}（跑 node scripts/probe-vendors.mjs --write）`)
})

test("表里「免 key 可用」与代码的 keyless 标记一一对应", () => {
  const parsed = rows()
  for (const id of VENDOR_IDS) {
    const row = parsed[id]
    const claimsKeyless = /^免 key 可用/.test(row.verdict)
    assert.equal(
      claimsKeyless,
      !!VENDORS[id].keyless,
      `${id}: 表里说「${row.verdict}」，代码 keyless=${!!VENDORS[id].keyless} —— 两边必须一致`,
    )
  }
})

test("免 key 的渠道必须有免 key 的对话证据（或有明文解释）", () => {
  const parsed = rows()
  for (const id of VENDOR_IDS.filter((x) => VENDORS[x].keyless)) {
    const chat = parsed[id].kChat
    // 只有两种证据能支撑 keyless：真回了正文（200），或「免额度用尽」（429 —— 说明凭据不是门槛）
    assert.ok(
      chat.startsWith("**200") || chat.includes("429"),
      `${id} 标了 keyless，但无凭据 chat 证据是「${chat}」（需要 200 或 429）`,
    )
  }
})
