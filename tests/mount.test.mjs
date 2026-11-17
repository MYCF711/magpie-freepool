// tests/mount.test.mjs —— 入口 / 钩子挂载契约（六供应商版）
//
// 一个包六个供应商：magpie 把**每个具名导出**都当插件工厂调用，所以这里逐个验：
//   ① 导出只有六个、都以 Plugin 结尾、都是 async 函数
//   ② 每个插件只注册自己的 provider，config.models 未登录也非空（铁律 1）
//   ③ 登录方式只有一条 api 型，且**没有 authorize**（没有它宿主才会原样存 `{type:"api",key}`）
//   ④ loader 给 baseURL / fetch；没有 key 且这家必须要 key 时返回 {}
//   ⑤ 只有 xkiro 注册 usage（其余五家没有额度接口 → 不画假进度条）
//   ⑥ checkin 一律 inactive（这六家都没有签到）
//   ⑦ 六张卡片的图标互不相同（同一屏并排，靠它区分站点）
//
// 全部离线：不打上游、不需要 magpie 进程、不写任何缓存。

import test from "node:test"
import assert from "node:assert/strict"

import * as entry from "../index.mjs"
import { SITES, SITE_LIST } from "../src/sites.mjs"

/** 与站点表一一对应的导出名（顺序即导出顺序） */
const EXPECTED = [
  ["Llm7AuthPlugin", "llm7"],
  ["NararouteAuthPlugin", "nararoute"],
  ["XkiroAuthPlugin", "xkiro"],
  ["SambanovaAuthPlugin", "sambanova"],
  ["CohereAuthPlugin", "cohere"],
  ["HuggingfaceAuthPlugin", "huggingface"],
]

test("导出：六个，全部以 Plugin 结尾，全部是 async 函数", () => {
  const names = Object.keys(entry).filter((key) => typeof entry[key] === "function")
  assert.deepEqual(names.sort(), EXPECTED.map(([name]) => name).sort())
  for (const name of names) {
    assert.match(name, /Plugin$/, `${name} 必须以 Plugin 结尾（magpie 只认具名导出）`)
    assert.equal(entry[name].constructor.name, "AsyncFunction", `${name} 必须是 async 工厂`)
  }
})

test("导出数 = 站点数（加一家必须加一行导出）", () => {
  assert.equal(EXPECTED.length, SITE_LIST.length)
})

for (const [exportName, id] of EXPECTED) {
  test(`${id}：只注册自己，config.models 非空且条目形状完整`, async () => {
    const plugin = await entry[exportName]({ client: {} })
    const cfg = {}
    await plugin.config(cfg)
    assert.deepEqual(Object.keys(cfg.provider), [id], "一个插件只能注册自己的 provider")

    const declared = cfg.provider[id]
    assert.equal(declared.name, SITES[id].name)
    assert.equal(declared.api, SITES[id].base)
    assert.equal(declared.npm, "@ai-sdk/openai-compatible")

    const models = declared.models
    assert.ok(models && Object.keys(models).length > 0, "config.models 不能为空（铁律 1）")

    for (const [modelId, model] of Object.entries(models)) {
      assert.equal(model.id, modelId)
      assert.equal(model.api.url, SITES[id].base, "条目 api.url 必须指向本家上游")
      assert.equal(model.api.npm, "@ai-sdk/openai-compatible")
      // config 路径读 modalities，provider.models 路径读 capabilities —— 两个都要写
      assert.ok(Array.isArray(model.modalities.input))
      assert.deepEqual(model.modalities.output, ["text"])
      for (const key of ["text", "image", "audio", "video", "pdf"]) {
        assert.equal(typeof model.capabilities.input[key], "boolean", `${modelId}.capabilities.input.${key} 必须显式布尔`)
      }
      assert.equal(typeof model.capabilities.output.text, "boolean")
    }
  })

  test(`${id}：登录是一条 api 型，且没有 authorize / prompts`, async () => {
    const plugin = await entry[exportName]({ client: {} })
    const methods = plugin.auth.methods
    assert.equal(methods.length, 1)
    assert.equal(methods[0].type, "api")
    // 有 authorize 时宿主会把**输入框的值丢掉**只传 prompts 的答案；没有 authorize 才原样存 key
    assert.equal(methods[0].authorize, undefined)
    assert.equal(methods[0].prompts, undefined)
    assert.ok(methods[0].label.length > 0)
    assert.ok(methods[0].placeholder.includes("http"), "placeholder 必须给领取地址")
    assert.equal(plugin.auth.provider, id)
    assert.ok(plugin.auth.icon.startsWith("data:image/"), "图标必须内嵌")
  })

  test(`${id}：loader 指向本家上游，并显式带出站 UA`, async () => {
    const plugin = await entry[exportName]({ client: {} })
    const out = await plugin.auth.loader(async () => ({ type: "api", key: "sk-test" }), { id })
    assert.equal(out.baseURL, SITES[id].base)
    assert.equal(out.apiKey, "sk-test")
    assert.equal(typeof out.fetch, "function")
    assert.match(out.headers["user-agent"], /^OpenAI\//, "出站 UA 必须显式给，不能透传 magpie/<version>")
  })

  test(`${id}：没有 key 时的行为按 keyOptional 分叉`, async () => {
    const plugin = await entry[exportName]({ client: {} })
    const out = await plugin.auth.loader(async () => ({ type: "api", key: "" }), { id })
    if (SITES[id].keyOptional) {
      assert.equal(out.baseURL, SITES[id].base, "免 key 的站点留空也能用")
    } else {
      assert.deepEqual(out, {}, "要 key 的站点没 key 时不接管请求")
    }
  })

  test(`${id}：checkin 报 inactive，而不是 failed`, async () => {
    const plugin = await entry[exportName]({ client: {} })
    const result = await plugin.auth.checkin(async () => ({ type: "api", key: "k" }), { id })
    assert.equal(result.outcome, "inactive")
  })

  test(`${id}：provider.models 未登录时退回 seed，且 api.url 仍是本家`, async () => {
    const plugin = await entry[exportName]({ client: {} })
    const models = await plugin.provider.models({}, { auth: null })
    assert.ok(Object.keys(models).length > 0)
    for (const [modelId, model] of Object.entries(models)) {
      assert.equal(model.id, modelId)
      assert.equal(model.api.url, SITES[id].base)
    }
  })
}

test("只有 xkiro 有 usage 钩子；其余五家不注册（没有接口就不画假进度条）", async () => {
  for (const [exportName, id] of EXPECTED) {
    const plugin = await entry[exportName]({ client: {} })
    if (id === "xkiro") {
      assert.equal(typeof plugin.auth.usage, "function", "xkiro 有 /usage 接口")
    } else {
      assert.equal(plugin.auth.usage, undefined, `${id} 没有额度接口，不该有 usage 钩子`)
    }
  }
})

test("六张卡片的图标互不相同", async () => {
  const icons = []
  for (const [exportName] of EXPECTED) {
    const plugin = await entry[exportName]({ client: {} })
    icons.push(plugin.auth.icon)
  }
  assert.equal(new Set(icons).size, icons.length, "图标重复 = 用户分不清是哪一家")
})

test("没有任何插件注册 chat.headers（这六家都不需要额外的会话头）", async () => {
  for (const [exportName] of EXPECTED) {
    const plugin = await entry[exportName]({ client: {} })
    assert.equal(plugin["chat.headers"], undefined)
  }
})
