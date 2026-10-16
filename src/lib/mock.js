(function (root, factory) {
  const api = factory(root);
  root.PT = Object.assign(root.PT || {}, api);
  if (typeof module !== "undefined" && module.exports && typeof process !== "undefined") {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const PHRASES = new Map([
    ["Claude Agents on Kubernetes", "Kubernetes 上的 Claude Agents"],
    [
      "A field guide to running Claude Agents with RAG, MCP, and a sane Context window.",
      "一份实践指南：运行 Claude Agents，并用好 RAG、MCP 和合理的 Context window。",
    ],
    ["Why the Agent keeps its name", "为什么 Agent 这个词要留在英文里"],
    [
      "Claude is an Agent, not a metaphor. Treat Agent, Prompt, and Token as technical terms. An LLM should not rename them.",
      "Claude 是 Agent，不是比喻。请把 Agent、Prompt 和 Token 当作技术术语。LLM 不应该给它们改名。",
    ],
    ["Wire it to the cluster", "把它接到集群上"],
    [
      "The service runs on Kubernetes. Package the runtime with Docker, call the API through the official SDK, and keep the CLI nearby for debugging.",
      "服务跑在 Kubernetes 上。用 Docker 打包运行时，通过官方 SDK 调用 API，并把 CLI 留在手边方便排错。",
    ],
    [
      "Apply it with kubectl apply -f agent.yaml and wait for the cluster.",
      "用 kubectl apply -f agent.yaml 应用清单，然后等待集群就绪。",
    ],
    [
      "The container image is published to GitHub. Engineers review it in Cursor, sometimes with GitHub Copilot open beside the editor.",
      "容器镜像发布在 GitHub 上。工程师在 Cursor 里复查，有时会把 GitHub Copilot 开在编辑器旁边。",
    ],
    ["Retrieval and tools", "检索和工具"],
    [
      "RAG pulls passages into the Context window before the model answers. MCP lets the Agent call tools without stuffing every schema into the Prompt.",
      "模型回答之前，RAG 会把相关段落放进 Context window。MCP 让 Agent 能够调用工具，而不必把每份 schema 都塞进 Prompt。",
    ],
    [
      "Embeddings are stored beside the corpus. Fine-tuning is optional; start with a strong Prompt and a measured Token budget.",
      "Embeddings 存在语料旁边。Fine-tuning 是可选的；先写好 Prompt，并给 Token 预算封顶。",
    ],
    ["The toolchain", "工具链"],
    [
      "Read the Transformer paper when the result surprises you. DeepSeek, GPT, and Claude can sit in the same paragraph, and none of them should be transliterated.",
      "结果出乎意料时，去读 Transformer 论文。DeepSeek、GPT 和 Claude 可以出现在同一段里，它们都不应该被音译。",
    ],
    ["Keep API keys out of the image.", "不要把 API 密钥打进镜像。"],
    ["Pin the SDK version.", "固定 SDK 版本。"],
    ["Watch Token spikes when the Context window fills up.", "Context window 被塞满时，留意 Token 的尖峰。"],
    ["Why Agent", "为什么是 Agent"],
    ["Cluster", "集群"],
    ["Tools", "工具"],
    ["Filter articles", "筛选文章"],
    ["Hello, Claude Agent.", "你好，Claude Agent。"],
    ["Field Notes", "技术札记"],
    ["Engineering notes", "工程笔记"],
  ]);

  const WORD_RULES = [
    [/\bdoes not\b/gi, "并不"],
    [/\bdon't\b/gi, "不要"],
    [/\bit's\b/gi, "这是"],
    [/\bshould not\b/gi, "不应该"],
    [/\bwithout\b/gi, "无需"],
    [/\bbefore\b/gi, "在此之前"],
    [/\bafter\b/gi, "之后"],
    [/\bwith\b/gi, "借助"],
    [/\bfrom\b/gi, "从"],
    [/\binto\b/gi, "进入"],
    [/\bfor\b/gi, "用于"],
    [/\band\b/gi, "和"],
    [/\bor\b/gi, "或"],
    [/\bthis\b/gi, "这个"],
    [/\bthat\b/gi, "那个"],
    [/\bwhen\b/gi, "当"],
    [/\bshould\b/gi, "应该"],
    [/\bcan\b/gi, "可以"],
    [/\bwill\b/gi, "会"],
    [/\bare\b/gi, "是"],
    [/\bis\b/gi, "是"],
    [/\bnot\b/gi, "不"],
    [/\bthe\b/gi, ""],
    [/\ban\b/gi, ""],
    [/\ba\b/gi, ""],
  ];

  function normalizeSpaces(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function genericWordMock(text) {
    let out = text;
    WORD_RULES.forEach(([pattern, replacement]) => {
      out = out.replace(pattern, replacement);
    });
    out = out.replace(/[ ]{2,}/g, " ").trim();
    if (out === normalizeSpaces(text)) return `（演示译文）${out}`;
    return out;
  }

  function restoreCodeSlots(text, codes, nonce) {
    if (!codes?.length) return text;
    const PT = root.PT;
    return String(text).replace(new RegExp(`⟪${PT.escapeRegExp(nonce)}C(\\d+)⟫`, "g"), (match, index) => {
      const code = codes[Number(index)];
      return code == null ? match : code;
    });
  }

  function hideCodes(text, codes, nonce) {
    const PT = root.PT;
    let marked = text;
    const ordered = (codes || [])
      .map((code, index) => ({ code, index }))
      .filter((item) => item.code)
      .sort((a, b) => b.code.length - a.code.length);
    ordered.forEach((item) => {
      marked = marked.split(item.code).join(PT.slot(nonce, "C", item.index));
    });
    return marked;
  }

  function mockTranslate(protectedText, ctx) {
    const PT = root.PT;
    const nonce = ctx.nonce;
    const codes = ctx.codes || [];
    const withTerms = PT.finalizeTranslation(protectedText, ctx.replacements || [], nonce);
    const plain = normalizeSpaces(restoreCodeSlots(withTerms, codes, nonce));
    const translated = PHRASES.get(plain) || genericWordMock(plain);
    const hidden = hideCodes(translated, codes, nonce);
    return PT.reprotectInOrder(hidden, ctx.replacements || [], nonce);
  }

  return { PHRASES, genericWordMock, mockTranslate, normalizeSpaces };
});
