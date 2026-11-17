// src/sites.mjs —— 六家免费池渠道的站点表
//
// 一个包六个供应商：magpie 把每个具名导出都当独立插件，各自注册一个 provider，
// 于是 Six 张卡、六组登录态、六份模型目录（见 MULTI-PROVIDER.md）。
// 站点之间会变的东西只允许出现在这张表里；逻辑里不许出现 "if (site === ...)"。

import { contextOf as lookupContext } from "./model-context.mjs"

/** 七家全部是 OpenAI 兼容的 chat/completions 形状 */
export const SDK = "@ai-sdk/openai-compatible"

/**
 * 出站 UA。**必须显式设**：不设的话宿主会把 `magpie/<version>` 透传给上游，
 * 而上游按 `<product>/<version>` 形态识别「第三方客户端」。
 * 这几家都是 OpenAI 兼容网关，它们的正常客户端就是 OpenAI SDK，所以用它的 UA。
 */
export const CLIENT_UA = "OpenAI/Python 1.109.1"

/** 这些厂商的免费额度按「池」发，卡片上写清楚来源比写数字可靠 */
export const FREE_NOTE = {
  llm7: "免费池：无 key 也能用（限额更低），有 key 额度更高",
  nararoute: "免费池：注册即用的免费模型，额度按天重置",
  xkiro: "免费池：账户自带免费 token 窗口，卡片读的就是它",
  sambanova: "免费额度：控制台给的免费试用额度",
  cohere: "免费额度：Trial key 的每分钟/每月限速",
  huggingface: "免费额度：每月少量推理额度，超额按量计费",
}

/**
 * 站点表。字段说明：
 *   id         provider id —— **发布过就不能改**，登录态和用量历史都挂它
 *   name       卡片显示名 —— <中文> <English>，品牌写法照抄官方
 *   base       上游 OpenAI 兼容基址
 *   keyUrl     取 key 的地址（README 与错误文案里给用户指路）
 *   keyOptional 没有 key 也能用（留空即可）
 *   seed       未登录时的兜底模型（必须有内容，否则界面显示 0 models）
 *   listAuth   /models 要不要带 Authorization（nararoute 带了就 401，默认带）
 *   quota      有额度接口的站点（目前只有 xkiro）
 *   sanitize   请求体/消息体的清洗器名（见 src/catalog.mjs 的 REQUEST_QUIRKS）
 */
export const SITES = {
  llm7: {
    id: "llm7",
    name: "LLM7 免费池",
    base: "https://api.llm7.io/v1",
    keyUrl: "https://token.llm7.io/",
    keyOptional: true,
    // seed 用实测存在的真实 id（2026-11-17 拉到的 74 条里的第一条），不用别名
    seed: [["DeepSeek-V4-Flash-0731", "DeepSeek V4 Flash", 400_000]],
    parse: "llm7",
  },
  nararoute: {
    id: "nararoute",
    name: "NaraRoute 免费池",
    base: "https://router.bynara.id/v1",
    keyUrl: "https://router.bynara.id/",
    keyOptional: false,
    // 实测：这条路径**只在完全不带 Authorization 时**放行，带上任何 key（含假 key）都回 401。
    // 所以目录请求必须匿名发 —— 把 key 发上去等于自己把列表关掉。
    listAuth: false,
    seed: [["agnes-2.5-flash", "Agnes 2.5 Flash", 512_000]],
    parse: "openai",
  },
  xkiro: {
    id: "xkiro",
    name: "xKiro 免费池",
    base: "https://api.xkiro.com/v1",
    keyUrl: "https://xkiro.com/",
    keyOptional: false,
    seed: [["google/gemini-3.6-flash", "Gemini 3.6 Flash", 1_000_000]],
    parse: "xkiro",
    quota: "xkiro",
  },
  sambanova: {
    id: "sambanova",
    name: "SambaNova 免费额度",
    base: "https://api.sambanova.ai/v1",
    keyUrl: "https://cloud.sambanova.ai/apis",
    keyOptional: false,
    seed: [["GLM-5.3", "GLM 5.3", 131_072]],
    parse: "openai",
  },
  cohere: {
    id: "cohere",
    name: "Cohere 兼容层",
    base: "https://api.cohere.ai/compatibility/v1",
    keyUrl: "https://dashboard.cohere.com/api-keys",
    keyOptional: false,
    seed: [["command-a-plus-05-2026", "Command A+", 256_000]],
    parse: "cohere",
    sanitize: "cohere",
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face 推理",
    base: "https://router.huggingface.co/v1",
    keyUrl: "https://huggingface.co/settings/tokens",
    keyOptional: false,
    seed: [
      ["Qwen/Qwen3-Coder-480B-A35B-Instruct:fastest", "Qwen3 Coder 480B", 256_000],
    ],
    parse: "huggingface",
  },
}

/** 站点顺序即导出顺序，加一家就是加一行（别循环生成导出名） */
export const SITE_LIST = [
  SITES.llm7,
  SITES.nararoute,
  SITES.xkiro,
  SITES.sambanova,
  SITES.cohere,
  SITES.huggingface,
]

/**
 * 单条模型条目。与模板 defaultEntry 的区别只有一处：**api.url 按站点给**，
 * 因为一个包里有六个上游，条目不能共用一个 BASE。
 *
 * context 只从「上游自己说了」或「magpie 的模型库里有」两处取，查不到就不写 limit ——
 * 猜大了上游 400、猜小了 agent 提前压缩，两种都比「不知道」贵。
 */
export function entryOf(site, id, { name, context, maxOutput, vision = false, reasoning = false } = {}) {
  const knownContext = Number.isFinite(context) && context > 0 ? context : lookupContext(id)
  const limit = knownContext ? { context: knownContext, output: Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : 64_000 } : undefined
  return {
    id,
    name: name || id,
    api: { id, url: site.base, npm: SDK },
    status: "active",
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    ...(limit ? { limit } : {}),
    // config 路径读 modalities，provider.models 路径读 capabilities —— 两个都写
    modalities: { input: vision ? ["text", "image"] : ["text"], output: ["text"] },
    capabilities: {
      temperature: true,
      reasoning: !!reasoning,
      toolcall: true,
      attachment: !!vision,
      // 五个模态键必须显式布尔：省略 image ≠ text，宿主会拿 models.dev 的裸 id 投票补
      input: { text: true, image: !!vision, audio: false, video: false, pdf: false },
      output: { text: true },
    },
  }
}

/** 未登录 / 拉取失败时的兜底：来自站点表里的 seed，绝不编造不存在的模型 */
export function staticModels(site) {
  const out = {}
  for (const [id, name, context] of site.seed || []) {
    out[id] = entryOf(site, id, { name, context })
  }
  return out
}

// ── 卡片图标 ─────────────────────────────────────────────────────────
//
// **每个供应商一张**，不能共用一个：六张卡并排时用户靠图标区分站点（MULTI-PROVIDER 铁律 3）。
// 这些是 data URI —— magpie 只认 `https://` 或 `data:image/`，且上限 1 MB。
// 插件**自己**那张（插件列表里的行）是 package.json 的 `magpie.icon`，与这里不是同一个位置。
export const ICONS = {
  llm7:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMwZjc2NmUiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxNGI4YTYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI4IiBmaWxsPSJ1cmwoI2cpIi8+PHRleHQgeD0iNjQiIHk9Ijg2IiBmb250LWZhbWlseT0ic3lzdGVtLXVpLC1hcHBsZS1zeXN0ZW0sU2Vnb2UgVUksc2Fucy1zZXJpZiIgZm9udC1zaXplPSI2MiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TDwvdGV4dD48L3N2Zz4=",
  nararoute:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMxZDRlZDgiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM2MGE1ZmEiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI4IiBmaWxsPSJ1cmwoI2cpIi8+PHRleHQgeD0iNjQiIHk9Ijg2IiBmb250LWZhbWlseT0ic3lzdGVtLXVpLC1hcHBsZS1zeXN0ZW0sU2Vnb2UgVUksc2Fucy1zZXJpZiIgZm9udC1zaXplPSI2MiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TjwvdGV4dD48L3N2Zz4=",
  xkiro:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM3YzNhZWQiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNjMDg0ZmMiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI4IiBmaWxsPSJ1cmwoI2cpIi8+PHRleHQgeD0iNjQiIHk9Ijg2IiBmb250LWZhbWlseT0ic3lzdGVtLXVpLC1hcHBsZS1zeXN0ZW0sU2Vnb2UgVUksc2Fucy1zZXJpZiIgZm9udC1zaXplPSI2MiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+WDwvdGV4dD48L3N2Zz4=",
  sambanova:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNiNDUzMDkiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmYmJmMjQiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI4IiBmaWxsPSJ1cmwoI2cpIi8+PHRleHQgeD0iNjQiIHk9Ijg2IiBmb250LWZhbWlseT0ic3lzdGVtLXVpLC1hcHBsZS1zeXN0ZW0sU2Vnb2UgVUksc2Fucy1zZXJpZiIgZm9udC1zaXplPSI2MiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+UzwvdGV4dD48L3N2Zz4=",
  cohere:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNiZTEyM2MiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmYjcxODUiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI4IiBmaWxsPSJ1cmwoI2cpIi8+PHRleHQgeD0iNjQiIHk9Ijg2IiBmb250LWZhbWlseT0ic3lzdGVtLXVpLC1hcHBsZS1zeXN0ZW0sU2Vnb2UgVUksc2Fucy1zZXJpZiIgZm9udC1zaXplPSI2MiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+QzwvdGV4dD48L3N2Zz4=",
  huggingface:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMwZTc0OTAiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMzOGJkZjgiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI4IiBmaWxsPSJ1cmwoI2cpIi8+PHRleHQgeD0iNjQiIHk9Ijg2IiBmb250LWZhbWlseT0ic3lzdGVtLXVpLC1hcHBsZS1zeXN0ZW0sU2Vnb2UgVUksc2Fucy1zZXJpZiIgZm9udC1zaXplPSI2MiIgZm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0iI2ZmZmZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+SDwvdGV4dD48L3N2Zz4=",
}

/** 站点图标。缺图返回空串，让宿主回退默认图，而不是抛 */
export function iconOf(site) {
  return ICONS[site?.id] || ""
}
