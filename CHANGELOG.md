# 更新记录

## 0.1.0 — 2026-11-17

首个版本：一个包，六个有免费额度、而 magpie 内置预设里没有的 OpenAI 兼容渠道。

- **六张卡、六组登录态**：`llm7`、`nararoute`、`xkiro`、`sambanova`、`cohere`、`huggingface`，
  各自注册一个 provider，互不覆盖（一个包多供应商的标准形态）。
- **登录 = 粘贴 API key**：不弹浏览器、不存 refresh_token、不做签到。
  `llm7` 与 `nararoute` 留空也能用（限额更低）。
- **模型目录按账号实时拉取**：每家的 `/models` 各自解析（LLM7 要求 `model_type=chat`；
  Hugging Face 只认「所有 live 推理商窗口一致」的上下文，不一致就不写窗口）。
  拉不到时退回上次成功快照，再退回站点表里的 seed，**绝不返回空表**。
- **额度**：只有 `xkiro` 有可读的额度接口，卡片读它；其余五家不注册 `usage` 钩子 ——
  与其画一个 100% 的假进度条（那会把这个号排到智能路由队首），不如不画。
- **请求体清洗**：Cohere 兼容层不认的 10 个字段与 message 里的 `name` 在出站前删掉，
  只删不改值。
- **出站 UA**：每个请求显式带 OpenAI 客户端 UA，避免宿主把 `magpie/<version>` 透传给网关。
