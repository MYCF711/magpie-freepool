// tests/freepool.test.mjs —— 语义锁：key 解析 / 目录合并 / 清洗 / 额度
//
// check.mjs 查形状，这里查「形状对、语义错」：
//   · key 串解析错 → 某家永远「没配 key」，用户以为插件不认他的 key
//   · 目录合并把一家的失败当成整体失败 → 15 家里挂 1 家，整张卡变空
//   · nararoute 的 /models 带上 Authorization 就 401（看起来是没模型）
//   · Cloudflare 的目录不是 /models 而是 /ai/models/search
//   · 额度窗口缺 used → 卡片「剩余额度未知」、路由里等于没有这个号

import test from "node:test"
import assert from "node:assert/strict"

import { REQUEST_QUIRKS, fetchAllModels, fetchVendorModels } from "../src/catalog.mjs"
import { hasKey, keyOf, parseKeys, summaryOf } from "../src/keys.mjs"
import { windowsOf } from "../src/usage.mjs"
import { VENDORS, vendorOfModel } from "../src/vendors.mjs"

async function withFetch(stub, fn) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })

// ── key 串解析 ──────────────────────────────────────────────────────

test("parseKeys：vendor=key 分号串，空段忽略，别名认得出", () => {
  const parsed = parseKeys("groq=gsk_1; hf=hf_x ;; google=g-key;samba=s-key")
  assert.equal(parsed.keys.groq, "gsk_1")
  assert.equal(parsed.keys.huggingface, "hf_x", "hf 是 huggingface 的别名")
  assert.equal(parsed.keys.gemini, "g-key", "google 是 gemini 的别名")
  assert.equal(parsed.keys.sambanova, "s-key")
  assert.deepEqual(parsed.unknown, [])
})

test("parseKeys：JSON 形态也收", () => {
  const parsed = parseKeys('{"xkiro":"xk_1","ollama":"ol_2"}')
  assert.equal(parsed.keys.xkiro, "xk_1")
  assert.equal(parsed.keys["ollama-cloud"], "ol_2", "ollama 映射到 ollama-cloud")
})

test("parseKeys：单个裸值按 llm7 处理（那家免 key，不该报错）", () => {
  const parsed = parseKeys("lm7-placeholder")
  assert.equal(parsed.keys.llm7, "lm7-placeholder")
})

test("parseKeys：认不出的家名进 unknown，不静默丢", () => {
  const parsed = parseKeys("acme=zz;groq=gsk_1")
  assert.deepEqual(parsed.unknown, ["acme"])
  assert.equal(parsed.keys.groq, "gsk_1")
})

test("parseKeys：Cloudflare 的 account:token 拆出账号段，token 单独发", () => {
  const parsed = parseKeys("cloudflare=acct123:cf-token")
  assert.equal(parsed.account, "acct123")
  assert.equal(keyOf(parsed, "cloudflare"), "cf-token", "账号段不能塞进 Authorization")
  assert.equal(hasKey(parsed, "cloudflare"), true)
})

test("hasKey：免 key 的家永远算配好，需要 key 的家没有就是没有", () => {
  const parsed = parseKeys("groq=gsk_1")
  assert.equal(hasKey(parsed, "llm7"), true, "LLM7 免 key")
  assert.equal(hasKey(parsed, "groq"), true)
  assert.equal(hasKey(parsed, "xkiro"), false)
})

test("summaryOf：卡片上说得清配了哪几家", () => {
  const parsed = parseKeys("groq=gsk_1;xkiro=xk_1")
  const text = summaryOf(parsed)
  assert.match(text, /3 家已配置/)
  assert.match(text, /llm7/)
  assert.match(text, /groq/)
  assert.match(text, /xkiro/)
})

// ── 模型前缀 ────────────────────────────────────────────────────────

test("vendorOfModel：前缀认家、保留上游 id 里的斜杠", () => {
  const a = vendorOfModel("xkiro/google/gemini-3.6-flash")
  assert.equal(a.vendor.id, "xkiro")
  assert.equal(a.upstreamId, "google/gemini-3.6-flash")

  const b = vendorOfModel("opencode-zen/gpt-5.3-codex")
  assert.equal(b.vendor.id, "opencode-zen")

  assert.equal(vendorOfModel("unknown/x"), null)
  assert.equal(vendorOfModel("noprefix"), null)
  assert.equal(vendorOfModel(""), null)
})

// ── 目录合并 ────────────────────────────────────────────────────────

test("fetchAllModels：一家的 key 坏了不影响其他家（逐家收结果）", async () => {
  const stub = async (url) => {
    if (String(url).includes("groq.com")) return json({ error: { message: "invalid key" } }, 401)
    if (String(url).includes("sambanova")) return json({ data: [{ id: "GLM-5.3", context_length: 131072 }] })
    return json({ data: [{ id: "x", model_type: "chat", stream: true, tools_calling: true }] })
  }
  const parsed = parseKeys("groq=gsk_bad;sambanova=sn_ok;llm7=lm")
  const result = await withFetch(stub, () => fetchAllModels(parsed))

  assert.deepEqual(result.failed.map((f) => f.id), ["groq"])
  assert.ok(result.ok.includes("sambanova"))
  assert.ok(result.ok.includes("llm7"))
  assert.ok(result.models["sambanova/GLM-5.3"], "成功的那家必须进表")
  assert.equal(result.models["groq/llama-3.3-70b-versatile"], undefined, "失败的家不能拿 seed 冒充 live")
  assert.ok(result.skipped.includes("xkiro"), "没配 key 的家直接跳过，不去打上游")
})

test("fetchVendorModels：nararoute 的目录请求不带 Authorization（带了就 401）", async () => {
  let seen = null
  const stub = async (url, init) => {
    seen = { url: String(url), headers: init?.headers ?? {} }
    return json({ data: [{ id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", context_window: 512000, vision: true }] })
  }
  const models = await withFetch(stub, () => fetchVendorModels(VENDORS.nararoute, "sk-should-not-be-sent"))
  assert.ok(seen.url.endsWith("/models"))
  assert.equal(seen.headers.authorization, undefined)
  assert.equal(models["nararoute/agnes-2.5-flash"].limit.context, 512000)
  assert.equal(models["nararoute/agnes-2.5-flash"].capabilities.input.image, true)
})

test("fetchVendorModels：Cloudflare 走 /ai/models/search，且路径里带账号段", async () => {
  let seen = ""
  const stub = async (url) => {
    seen = String(url)
    return json({ result: [{ name: "@cf/moonshotai/kimi-k2.6", description: "Kimi K2.6" }] })
  }
  const models = await withFetch(stub, () => fetchVendorModels(VENDORS.cloudflare, "cf-token", "acct123"))
  assert.match(seen, /\/accounts\/acct123\/ai\/models\/search\?format=openrouter/)
  assert.ok(models["cloudflare/@cf/moonshotai/kimi-k2.6"])
})

test("fetchVendorModels：llm7 过滤掉非 chat 条目，并读 context_window.tokens", async () => {
  const payload = {
    data: [
      {
        id: "DeepSeek-V4-Flash-0731",
        model_type: "chat",
        stream: true,
        tools_calling: true,
        context_window: { tokens: 400000 },
        reasoning: true,
      },
      { id: "some-embed", model_type: "embedding", stream: true, tools_calling: false },
    ],
  }
  const models = await withFetch(async () => json(payload), () => fetchVendorModels(VENDORS.llm7, ""))
  assert.deepEqual(Object.keys(models), ["llm7/DeepSeek-V4-Flash-0731"])
  assert.equal(models["llm7/DeepSeek-V4-Flash-0731"].limit.context, 400000)
})

test("fetchVendorModels：xkiro 的 capabilities.vision 是布尔，不能按字符串匹配", async () => {
  const payload = {
    data: [
      { id: "google/gemini-3.6-flash", display_name: "Gemini 3.6 Flash", context_length: 1000000, max_output_tokens: 65536, capabilities: { vision: true } },
      { id: "text-only", context_length: 128000, capabilities: { vision: false } },
    ],
  }
  const models = await withFetch(async () => json(payload), () => fetchVendorModels(VENDORS.xkiro, "k"))
  assert.equal(models["xkiro/google/gemini-3.6-flash"].capabilities.input.image, true)
  assert.equal(models["xkiro/google/gemini-3.6-flash"].limit.output, 65536)
  assert.equal(models["xkiro/text-only"].capabilities.input.image, false)
})

test("fetchVendorModels：Hugging Face 只认 live 推理商一致的窗口", async () => {
  const payload = {
    data: [
      { id: "agree", providers: [{ status: "live", context_length: 256000 }, { status: "live", context_length: 256000 }] },
      { id: "disagree", providers: [{ status: "live", context_length: 128000 }, { status: "live", context_length: 32000 }] },
    ],
  }
  const models = await withFetch(async () => json(payload), () => fetchVendorModels(VENDORS.huggingface, "hf_x"))
  assert.equal(models["huggingface/agree"].limit.context, 256000)
  assert.equal(models["huggingface/disagree"].limit, undefined)
})

// ── Cohere 请求体清洗 ───────────────────────────────────────────────

test("cohere：删掉上游不认的 10 个字段与 message.name，值一个不改", () => {
  const body = {
    model: "command-a-plus-05-2026",
    messages: [{ role: "user", content: "hi", name: "alice" }],
    stream: true,
    temperature: 0.2,
    n: 2,
    store: true,
    metadata: { trace: "x" },
    parallel_tool_calls: true,
    service_tier: "auto",
    prediction: { type: "content" },
    modalities: ["text"],
    top_logprobs: 3,
    logit_bias: {},
    audio: {},
  }
  const next = REQUEST_QUIRKS.cohere(body)
  for (const key of ["n", "store", "metadata", "parallel_tool_calls", "service_tier", "prediction", "modalities", "top_logprobs", "logit_bias", "audio"]) {
    assert.equal(key in next, false, `${key} 必须删掉`)
  }
  assert.equal("name" in next.messages[0], false)
  assert.equal(next.messages[0].content, "hi")
  assert.equal(next.temperature, 0.2)
})

test("cohere：没有可删字段时返回 null（调用方据此不重算 content-length）", () => {
  assert.equal(REQUEST_QUIRKS.cohere({ model: "m", messages: [{ role: "user", content: "hi" }] }), null)
  assert.equal(REQUEST_QUIRKS.cohere(null), null)
})

// ── 额度折算 ────────────────────────────────────────────────────────

test("windowsOf：used + limit 折成占比窗口", () => {
  const windows = windowsOf({
    windows: [{ name: "免费 token", used: 250, limit: 1000, resets_at: "2026-12-01T00:00:00Z" }],
  })
  assert.equal(windows.length, 1)
  assert.equal(windows[0].used, 25)
  assert.equal(typeof windows[0].resetsAt, "string")
})

test("windowsOf：free_tokens 只有 total + remaining 时自己算 used", () => {
  const windows = windowsOf({ free_tokens: { total: 2000, remaining: 1500 } })
  assert.equal(windows.length, 1)
  assert.equal(windows[0].used, 25)
})

test("windowsOf：只有 remaining 时走钱包型（给 balance，不给 used）", () => {
  const windows = windowsOf({ free_tokens: { remaining: 800 } })
  assert.equal(windows[0].used, undefined)
})

test("windowsOf：解析不出来就空窗口，不编数字", () => {
  assert.deepEqual(windowsOf({ object: "usage" }), [])
  assert.deepEqual(windowsOf({ windows: [{ name: "x" }] }), [])
  assert.deepEqual(windowsOf(null), [])
})
