// tests/mount.test.mjs —— 聚合入口的钩子契约
//
// 一张卡 15 家：这里验的是「聚合之后仍然只注册一个 provider」以及每个钩子的形状：
//   ① 入口只导出一个插件工厂（magpie 会把每个函数导出都当插件）
//   ② config 只注册 `freepool`，models 非空（铁律 1），每条条目的 api.url 指向自己的上游
//   ③ 登录是一条 api 型、**没有 authorize**（有它宿主就会丢掉输入框里的 key）
//   ④ loader 不给 baseURL（分流靠模型条目的 api.url），但给 fetch + UA
//   ⑤ usage 存在（读 xkiro），checkin 一律 inactive
//   ⑥ 未知模型前缀回 404（只搁置那个模型），缺某家 key 回 401 + kept（不标整张卡）
//
// 全部离线：不打上游、不写缓存。

import test from "node:test"
import assert from "node:assert/strict"

import * as entry from "../index.mjs"
import { FreepoolAuthPlugin } from "../index.mjs"
import { PROVIDER, VENDORS, VENDOR_IDS, VENDOR_LIST, seedModels, vendorOfModel } from "../src/vendors.mjs"

const plugin = async (ctx = {}) => FreepoolAuthPlugin(ctx)

/** 用假 fetch 跑一次 loader.fetch，返回它发出去的请求 */
function capture() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

test("入口只导出一个插件工厂，且以 Plugin 结尾", () => {
  const names = Object.entries(entry)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
  assert.deepEqual(names, ["FreepoolAuthPlugin"])
  assert.equal(FreepoolAuthPlugin.constructor.name, "AsyncFunction")
})

test("config 只注册 freepool，models 非空，且每条 api.url 指向自己那家", async () => {
  const hooks = await plugin({ client: {} })
  const cfg = {}
  await hooks.config(cfg)
  assert.deepEqual(Object.keys(cfg.provider), [PROVIDER])

  const declared = cfg.provider[PROVIDER]
  assert.equal(declared.npm, "@ai-sdk/openai-compatible")
  const models = declared.models
  assert.ok(Object.keys(models).length >= VENDOR_LIST.length, "至少每家一条 seed（铁律 1）")

  for (const [id, model] of Object.entries(models)) {
    const matched = vendorOfModel(id)
    assert.ok(matched, `${id} 必须是 <vendor>/<model> 形状`)
    // 宿主把 api.id 原样当请求里的 model 发出来（实测 2026-11-17），所以这里必须带前缀，
    // loader 出站前再切回上游 id —— 前缀是唯一确定的分流依据
    assert.equal(model.api.id, id, "api.id 与展示 id 一致（带渠道前缀）")
    assert.equal(model.api.url, matched.vendor.base, "api.url 必须指向这一家自己的上游")
    assert.equal(model.id, id)
    for (const key of ["text", "image", "audio", "video", "pdf"]) {
      assert.equal(typeof model.capabilities.input[key], "boolean", `${id}.capabilities.input.${key} 必须显式布尔`)
    }
    assert.deepEqual(model.modalities.output, ["text"])
  }
})

test("登录是一条 api 型，无 authorize / 无 prompts", async () => {
  const hooks = await plugin()
  assert.equal(hooks.auth.provider, PROVIDER)
  assert.equal(hooks.auth.methods.length, 1)
  assert.equal(hooks.auth.methods[0].type, "api")
  assert.equal(hooks.auth.methods[0].authorize, undefined)
  assert.equal(hooks.auth.methods[0].prompts, undefined)
  assert.match(hooks.auth.methods[0].placeholder, /=/, "placeholder 必须示范 <vendor>=<key>")
  assert.ok(hooks.auth.icon.startsWith("data:image/"))
})

test("loader 不给 baseURL（分流靠模型 api.url），但带出站 UA", async () => {
  const hooks = await plugin()
  const out = await hooks.auth.loader(async () => ({ type: "api", key: "llm7=abc" }), { id: PROVIDER })
  assert.equal(out.baseURL, undefined)
  assert.equal(out.apiKey, undefined)
  assert.match(out.headers["user-agent"], /^OpenAI\//)
  assert.equal(typeof out.fetch, "function")
})

test("插件选项 key_hint：placement 只认字符串 top，且默认开", async () => {
  const hooks = await plugin()
  const options = hooks.auth.options
  assert.ok(Array.isArray(options) && options.length >= 1)
  const opt = options.find((o) => o.key === "key_hint")
  assert.ok(opt, "key_hint 必须存在")
  assert.equal(opt.placement, "top")
  assert.equal(opt.default, true)
  assert.equal(typeof opt.label, "string")
  assert.ok(opt.description.length <= 300, "description ≤300")
  assert.ok(/LLM7/.test(opt.description) && /Kilo/.test(opt.description), "说明里要写清谁免 key")
})

test("选项开着才有「需 key」的家；关掉只剩当前真能调的渠道", async () => {
  const hooks = await plugin()
  const on = await hooks.provider.models({}, { auth: null, magpie: { option: () => true } })
  const off = await hooks.provider.models({}, { auth: null, magpie: { option: () => false } })
  const withMark = Object.entries(on).filter(([, m]) => String(m.name).includes("需 key"))
  const offMark = Object.entries(off).filter(([, m]) => String(m.name).includes("需 key"))
  assert.ok(withMark.length >= 12, "开着时缺 key 的 12 家都要摆出来（每家一条 seed）")
  assert.equal(offMark.length, 0, "关掉后模型名不带标记")
  assert.ok(Object.keys(on).length > Object.keys(off).length, "开着比关掉多出「还没解锁」的那批")

  // 免 key 的三家即使开着也不该被标
  for (const id of ["llm7", "kilo", "opencode-zen"]) {
    const hit = withMark.find(([modelId]) => modelId.startsWith(id + "/"))
    assert.equal(hit, undefined, `${id} 免 key，不该被标`)
  }
})

test("usage 存在（读 xkiro），checkin 是 inactive", async () => {
  const hooks = await plugin()
  assert.equal(typeof hooks.auth.usage, "function")
  const checkin = await hooks.auth.checkin(async () => ({ type: "api", key: "" }), { id: PROVIDER })
  assert.equal(checkin.outcome, "inactive")
})

test("provider.models 在没有任何 key 时退回 seed，而不是空表", async () => {
  const hooks = await plugin()
  const models = await hooks.provider.models({}, { auth: null })
  assert.ok(Object.keys(models).length > 0)
})

// ── 逐请求分流 ──────────────────────────────────────────────────────

test("按模型前缀选上游与 key，并把带前缀的 id 换回上游 id", async () => {
  const hooks = await plugin()
  const loader = await hooks.auth.loader(
    async () => ({ type: "api", key: "cloudflare=acct123:cf-token;groq=gsk_1;llm7=lm7" }),
    { id: PROVIDER },
  )
  const { calls, restore } = capture()
  try {
    await loader.fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "groq/llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] }),
      headers: { "content-type": "application/json" },
    })
    await loader.fetch("https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "cloudflare/@cf/moonshotai/kimi-k2.6" }),
    })
  } finally {
    restore()
  }

  assert.equal(calls.length, 2)
  assert.equal(calls[0].headers.authorization, "Bearer gsk_1", "groq 的请求用 groq 的 key")
  assert.equal(JSON.parse(calls[0].body).model, "llama-3.3-70b-versatile", "发给上游的 model 必须去掉前缀")
  assert.equal(calls[1].headers.authorization, "Bearer cf-token", "account:token 形态只把 token 段发上去")
  assert.equal(JSON.parse(calls[1].body).model, "@cf/moonshotai/kimi-k2.6", "上游 id 里的斜杠要保留")
})

test("前缀与 host 都认不出 → 404（宿主只搁置这个模型）", async () => {
  const hooks = await plugin()
  const loader = await hooks.auth.loader(async () => ({ type: "api", key: "llm7=x" }), { id: PROVIDER })
  const res = await loader.fetch("https://example.invalid/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "nope/whatever" }),
  })
  assert.equal(res.status, 404)
  const body = await res.json()
  assert.match(body.error.message, /未知的模型 id/)
})

test("前缀丢了但 host 认得出：仍按 host 那家发", async () => {
  const hooks = await plugin()
  const loader = await hooks.auth.loader(async () => ({ type: "api", key: "xkiro=xk_1" }), { id: PROVIDER })
  const { calls, restore } = capture()
  try {
    const res = await loader.fetch("https://api.xkiro.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "google/gemini-3.6-flash" }),
    })
    assert.equal(res.status, 200)
  } finally {
    restore()
  }
  assert.equal(calls[0].headers.authorization, "Bearer xk_1", "靠 host 认出是 xkiro")
  assert.equal(JSON.parse(calls[0].body).model, "google/gemini-3.6-flash")
})

test("缺某家的 key → 401 且 x-magpie-sign-in: kept（不把整张卡标失效）", async () => {
  const hooks = await plugin()
  const loader = await hooks.auth.loader(async () => ({ type: "api", key: "llm7=x" }), { id: PROVIDER })
  const res = await loader.fetch("https://api.cohere.ai/compatibility/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "cohere/command-a-plus-05-2026" }),
  })
  assert.equal(res.status, 401)
  assert.equal(res.headers.get("x-magpie-sign-in"), "kept")
  const body = await res.json()
  assert.match(body.error.message, /cohere/, "错误里要点名是哪一家缺 key")
  assert.match(body.error.message, /dashboard\.cohere\.com/, "并且给领取地址")
})

test("免 key 的家（llm7）不配 key 也能发出去", async () => {
  const hooks = await plugin()
  const loader = await hooks.auth.loader(async () => ({ type: "api", key: "" }), { id: PROVIDER })
  const { calls, restore } = capture()
  try {
    const res = await loader.fetch("https://api.llm7.io/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "llm7/DeepSeek-V4-Flash-0731" }),
    })
    assert.equal(res.status, 200)
  } finally {
    restore()
  }
  assert.equal(calls[0].headers.authorization, undefined, "没 key 就别发空的 Authorization")
})

test("种子目录覆盖 15 家，每家一条，id 都可路由", () => {
  const models = seedModels()
  const covered = new Set(Object.keys(models).map((id) => vendorOfModel(id).vendor.id))
  assert.equal(covered.size, VENDOR_LIST.length)
  assert.deepEqual([...covered].sort(), [...VENDOR_IDS].sort())
})

test("VENDORS 里每条都必备 base / keyUrl / parse；Cloudflare 带 accountKey", () => {
  for (const id of VENDOR_IDS) {
    const vendor = VENDORS[id]
    assert.match(vendor.base, /^https:\/\//, `${id}.base`)
    assert.match(vendor.keyUrl, /^https:\/\//, `${id}.keyUrl`)
    assert.equal(vendor.id, id)
    assert.equal(typeof vendor.parse, "string")
    assert.ok(Array.isArray(vendor.seed) && vendor.seed.length > 0, `${id} 要有 seed`)
  }
  assert.equal(VENDORS.cloudflare.accountKey, true)
  assert.match(VENDORS.cloudflare.base, /\{account\}/)
})
