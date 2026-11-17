// tests/freepool.test.mjs —— 语义锁：解析 / 清洗 / 降级 / 额度折算
//
// check.mjs 查的是形状（导出了什么、字段齐不齐）；这里查的是**形状对、语义错**的那几处，
// 而且每一处都是「写错了不报错」的类型：
//   · nararoute 的 /models 带上 Authorization 就 401（看起来是「没模型」，其实是自己把列表关了）
//   · 能力字段各家拼写不同，读了布尔却按字符串匹配 → 所有模型都被当成不能看图
//   · 目录失败返回空表 → 宿主以为这家没模型；正确做法是退回快照 / seed
//   · 额度窗口缺 used → 窗口变 text-only，卡片显示「剩余额度未知」，路由里等于没有这个号
//
// 全部离线：fetch 被替换成桩，不打任何上游、不写任何缓存。

import test from "node:test"
import assert from "node:assert/strict"

import { REQUEST_QUIRKS, fetchLiveModels, modelsFor } from "../src/catalog.mjs"
import { windowsOf } from "../src/usage.mjs"
import { SITES } from "../src/sites.mjs"

/** 换掉全局 fetch 跑一段，结束时恢复 */
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

// ── 目录解析 ────────────────────────────────────────────────────────

test("llm7：非 chat / 不支持流式的条目被剔除，窗口从 context_window.tokens 取", async () => {
  const payload = {
    object: "list",
    data: [
      {
        id: "DeepSeek-V4-Flash-0731",
        model_type: "chat",
        stream: true,
        tools_calling: true,
        context_window: { tokens: 400000, chars: null },
        modalities: { input: ["text"], output: ["text"] },
        reasoning: true,
      },
      { id: "some-embed", model_type: "embedding", stream: true, tools_calling: false },
      { id: "no-stream", model_type: "chat", stream: false, tools_calling: true },
    ],
  }
  const models = await withFetch(async () => json(payload), () => fetchLiveModels(SITES.llm7, "sk-x"))
  assert.deepEqual(Object.keys(models), ["DeepSeek-V4-Flash-0731"])
  assert.equal(models["DeepSeek-V4-Flash-0731"].limit.context, 400000)
  assert.equal(models["DeepSeek-V4-Flash-0731"].capabilities.reasoning, true)
})

test("nararoute：目录请求**不带** Authorization（带了就被 401）", async () => {
  let seen = null
  const stub = async (url, init) => {
    seen = { url: String(url), headers: init?.headers ?? {} }
    return json({ data: [{ id: "agnes-2.5-flash", name: "Agnes 2.5 Flash", context_window: 512000, vision: true }] })
  }
  const models = await withFetch(stub, () => fetchLiveModels(SITES.nararoute, "sk-should-not-be-sent"))
  assert.ok(seen.url.endsWith("/models"))
  assert.equal(seen.headers.authorization, undefined, "nararoute 的 /models 只在匿名时放行")
  assert.equal(models["agnes-2.5-flash"].limit.context, 512000)
  assert.equal(models["agnes-2.5-flash"].capabilities.input.image, true)
})

test("需要 key 的站点在拉目录时确实带上了 key", async () => {
  let seen = null
  const stub = async (url, init) => {
    seen = init?.headers ?? {}
    return json({ data: [{ id: "gpt-oss-120b" }] })
  }
  await withFetch(stub, () => fetchLiveModels(SITES.sambanova, "sk-abc"))
  assert.equal(seen.authorization, "Bearer sk-abc")
})

test("xkiro：capabilities.vision 是布尔，不能按字符串匹配（否则全都当成不能看图）", async () => {
  const payload = {
    data: [
      {
        id: "google/gemini-3.6-flash",
        display_name: "Gemini 3.6 Flash",
        context_length: 1000000,
        max_output_tokens: 65536,
        capabilities: { vision: true, tools: true, reasoning: true },
      },
      { id: "text-only", context_length: 128000, capabilities: { vision: false } },
    ],
  }
  const models = await withFetch(async () => json(payload), () => fetchLiveModels(SITES.xkiro, "sk-x"))
  assert.equal(models["google/gemini-3.6-flash"].capabilities.input.image, true)
  assert.equal(models["google/gemini-3.6-flash"].name, "Gemini 3.6 Flash")
  assert.equal(models["google/gemini-3.6-flash"].limit.context, 1000000)
  assert.equal(models["google/gemini-3.6-flash"].limit.output, 65536)
  assert.equal(models["text-only"].capabilities.input.image, false)
})

test("huggingface：只有所有 live 推理商窗口一致时才认这个数，否则不写 limit", async () => {
  const payload = {
    data: [
      {
        id: "agree",
        providers: [
          { status: "live", context_length: 256000 },
          { status: "live", context_length: 256000 },
          { status: "staging", context_length: 8000 },
        ],
      },
      {
        id: "disagree",
        providers: [
          { status: "live", context_length: 128000 },
          { status: "live", context_length: 32000 },
        ],
      },
    ],
  }
  const models = await withFetch(async () => json(payload), () => fetchLiveModels(SITES.huggingface, "hf_x"))
  assert.equal(models.agree.limit?.context, 256000)
  assert.equal(models.disagree.limit, undefined, "窗口不一致就是不知道，不能拿其中一个去猜")
})

test("401 → 抛带 signIn 的错误（宿主据此标账号），不是返回空表", async () => {
  await withFetch(
    async () => json({ error: { message: "Invalid or disabled ClientApiKey." } }, 401),
    async () => {
      await assert.rejects(
        () => fetchLiveModels(SITES.xkiro, "sk-bad"),
        (error) => error.signIn === "expired",
      )
    },
  )
})

test("目录整个失败 → 退回 seed，而不是返回空表", async () => {
  const models = await withFetch(
    async () => {
      throw new Error("network down")
    },
    () => modelsFor(SITES.sambanova, "sk-x"),
  )
  assert.ok(Object.keys(models).length > 0, "空表会让宿主以为这家没有模型")
  for (const [id, model] of Object.entries(models)) {
    assert.equal(model.id, id)
    assert.equal(model.api.url, SITES.sambanova.base)
  }
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
  assert.equal(next.messages[0].content, "hi", "只删字段，不改值")
  assert.equal(next.temperature, 0.2)
  assert.equal(next.stream, true)
})

test("cohere：没有可删的字段时返回 null（调用方据此不重算 content-length）", () => {
  assert.equal(REQUEST_QUIRKS.cohere({ model: "m", messages: [{ role: "user", content: "hi" }] }), null)
  assert.equal(REQUEST_QUIRKS.cohere(null), null)
})

// ── 额度折算 ────────────────────────────────────────────────────────

test("windowsOf：used + limit 折成占比窗口（缺 used 就会变成 text-only，路由不计入）", () => {
  const windows = windowsOf({
    object: "usage",
    windows: [{ name: "免费 token", used: 250, limit: 1000, resets_at: "2026-12-01T00:00:00Z" }],
  })
  assert.equal(windows.length, 1)
  assert.equal(windows[0].name, "免费 token")
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
  assert.equal(windows.length, 1)
  assert.equal(windows[0].used, undefined)
})

test("windowsOf：什么都解析不出来 → 空窗口，不编数字", () => {
  assert.deepEqual(windowsOf({ object: "usage" }), [])
  assert.deepEqual(windowsOf({ windows: [{ name: "x" }] }), [])
  assert.deepEqual(windowsOf(null), [])
})

test("windowsOf：只有 display 的行走 text-only（没有 used），不冒充占比", () => {
  const windows = windowsOf({ windows: [{ name: "公告", display: "本月无额度调整" }] })
  assert.equal(windows.length, 1)
  assert.equal(windows[0].used, undefined, "没有数字就不给 used —— 编一个会让路由把它当成满额")
  assert.equal(windows[0].display, "本月无额度调整")
})
