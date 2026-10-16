(function (root, factory) {
  const api = factory();
  root.PT = Object.assign(root.PT || {}, api);
  if (typeof module !== "undefined" && module.exports && typeof process !== "undefined") {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 占位符丢失时的兜底。只替换「这次本来被保护、但模型没把占位符还回来」的那些词，
  // 并且从后往前替换，避免把同一段里正常的「代理」先改掉。
  const MISREADS = {
    claude: ["克劳德", "克勞德", "克洛德"],
    "claude code": ["克劳德代码"],
    agent: ["智能体", "智能體", "代理人", "代理"],
    agents: ["智能体们", "智能體們", "代理们", "代理們"],
    prompt: ["提示词", "提示詞", "提示语", "提示語"],
    prompts: ["提示词", "提示詞"],
    token: ["词元", "詞元", "令牌"],
    tokens: ["词元", "詞元", "令牌"],
    embedding: ["嵌入向量", "词嵌入", "詞嵌入"],
    embeddings: ["嵌入向量"],
    "fine-tuning": ["微调", "微調", "精调"],
    "fine-tune": ["微调", "微調"],
    finetuning: ["微调", "微調"],
    transformer: ["变形金刚", "變形金剛", "变换器", "變換器"],
    transformers: ["变形金刚", "變形金剛"],
    "context window": ["上下文窗口", "语境窗口", "語境窗口"],
    "context windows": ["上下文窗口"],
    kubernetes: ["库伯内特斯", "庫伯內特斯"],
    k8s: ["库伯内特斯"],
    docker: ["码头工人", "碼頭工人"],
    github: ["吉特哈布"],
    copilot: ["副驾驶", "副駕駛"],
    "github copilot": ["吉特哈布副驾驶"],
    cursor: ["光标", "游标", "鼠標指針"],
    deepseek: ["深度求索"],
    gpt: ["吉皮蒂"],
    chatgpt: ["聊天生成预训练变换器"],
    openai: ["开放人工智能"],
    anthropic: ["安思罗皮克"],
    llm: ["大语言模型", "大語言模型"],
    rag: ["检索增强生成", "檢索增強生成"],
    mcp: ["模型上下文协议", "模型上下文協議"],
    sdk: ["软件开发工具包", "軟件開發工具包"],
    cli: ["命令行界面", "命令列界面"],
  };

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function slot(nonce, kind, index) {
    return `⟪${nonce}${kind}${index}⟫`;
  }

  function compileTerms(terms) {
    const unique = [];
    const seen = new Set();
    (terms || []).forEach((item, index) => {
      const term = String(item || "").trim();
      if (term.length < 2) return;
      const key = term.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      unique.push({ term, index });
    });
    if (!unique.length) return null;
    unique.sort((a, b) => b.term.length - a.term.length || a.index - b.index);
    const body = unique.map((item) => escapeRegExp(item.term)).join("|");
    // ASCII 边界：中文紧挨术语时仍能命中；JavaScript 里的 Java、GitHub 里的 Git 不会被截断。
    return new RegExp(`(?<![A-Za-z0-9_])(?:${body})(?![A-Za-z0-9_])`, "giu");
  }

  function protectTerms(text, terms, nonce) {
    const source = String(text ?? "");
    const matcher = compileTerms(terms);
    if (!matcher) return { text: source, replacements: [] };
    const replacements = [];
    const parts = source.split(/(⟪[^⟫]*⟫)/);
    const out = parts
      .map((part) => {
        if (part.startsWith("⟪") && part.endsWith("⟫")) return part;
        matcher.lastIndex = 0;
        return part.replace(matcher, (match) => {
          const id = replacements.length;
          replacements.push(match);
          return slot(nonce, "T", id);
        });
      })
      .join("");
    return { text: out, replacements };
  }

  function normalizeTermSlots(text, nonce) {
    const n = escapeRegExp(nonce);
    const patterns = [
      `⟪\\s*${n}\\s*T\\s*(\\d+)\\s*⟫`,
      `\\{\\{\\s*${n}\\s*T\\s*(\\d+)\\s*\\}\\}`,
      `\\[\\[\\s*${n}\\s*T\\s*(\\d+)\\s*\\]\\]`,
      `【\\s*${n}\\s*T\\s*(\\d+)\\s*】`,
      `<\\s*${n}\\s*T\\s*(\\d+)\\s*>`,
      `＜\\s*${n}\\s*T\\s*(\\d+)\\s*＞`,
    ];
    let out = String(text ?? "");
    patterns.forEach((pattern) => {
      out = out.replace(new RegExp(pattern, "gi"), slot(nonce, "T", "$1"));
    });
    return out;
  }

  function replaceFromEnd(text, bad, replacement, maxCount) {
    if (!bad || maxCount <= 0 || !text) return { text, count: 0 };
    const matches = [...String(text).matchAll(new RegExp(escapeRegExp(bad), "g"))];
    if (!matches.length) return { text, count: 0 };
    const chosen = matches.slice(-Math.min(maxCount, matches.length));
    let out = text;
    let count = 0;
    for (let i = chosen.length - 1; i >= 0; i -= 1) {
      const match = chosen[i];
      out = out.slice(0, match.index) + replacement + out.slice(match.index + match[0].length);
      count += 1;
    }
    return { text: out, count };
  }

  function correctMissing(text, missingOriginals) {
    const remaining = new Map();
    missingOriginals.forEach((original) => {
      if (!original) return;
      remaining.set(original, (remaining.get(original) || 0) + 1);
    });
    const jobs = [];
    remaining.forEach((_count, original) => {
      const bads = MISREADS[original.toLowerCase()] || [];
      bads.forEach((bad) => jobs.push({ bad, original }));
    });
    jobs.sort((a, b) => b.bad.length - a.bad.length);
    let out = text;
    jobs.forEach((job) => {
      const left = remaining.get(job.original) || 0;
      if (left <= 0) return;
      const result = replaceFromEnd(out, job.bad, job.original, left);
      out = result.text;
      remaining.set(job.original, left - result.count);
    });
    return out;
  }

  function finalizeTranslation(modelOutput, replacements, nonce) {
    const normalized = normalizeTermSlots(modelOutput, nonce);
    const seen = new Set();
    const pattern = new RegExp(`⟪${escapeRegExp(nonce)}T(\\d+)⟫`, "g");
    const restored = normalized.replace(pattern, (match, index) => {
      const id = Number(index);
      if (replacements[id] == null) return match;
      seen.add(id);
      return replacements[id];
    });
    const missing = [];
    replacements.forEach((original, index) => {
      if (!seen.has(index)) missing.push(original);
    });
    if (!missing.length) return restored;
    return correctMissing(restored, missing);
  }

  function reprotectInOrder(text, replacements, nonce) {
    let out = String(text ?? "");
    replacements.forEach((original, index) => {
      if (!original) return;
      const matcher = new RegExp(
        `(?<![A-Za-z0-9_])(?:${escapeRegExp(original)})(?![A-Za-z0-9_])`,
        "iu",
      );
      out = out.replace(matcher, () => slot(nonce, "T", index));
    });
    return out;
  }

  function hasTranslatableProse(text, terms) {
    const source = String(text || "").trim();
    if (!source) return false;
    const protectedText = protectTerms(source, terms || [], "z").text;
    const rest = protectedText
      .replace(/⟪zT\d+⟫/g, "")
      .replace(/⟪[a-z0-9]*C\d+⟫/g, "")
      .trim();
    if (rest.length < 2) return false;
    return /[\p{L}]/u.test(rest);
  }

  function shouldTranslateText(text, terms, targetLanguage) {
    if (!hasTranslatableProse(text, terms)) return false;
    const han = (String(text).match(/\p{Script=Han}/gu) || []).length;
    const latin = (String(text).match(/[A-Za-z]/g) || []).length;
    const target = targetLanguage || "";
    if (/中文/.test(target) && han >= 8 && latin < 3) return false;
    if (/English|Français|Deutsch|Español/.test(target) && latin >= 12 && han < 2) return false;
    return true;
  }

  return {
    MISREADS,
    escapeRegExp,
    slot,
    protectTerms,
    normalizeTermSlots,
    correctMissing,
    finalizeTranslation,
    reprotectInOrder,
    hasTranslatableProse,
    shouldTranslateText,
  };
});
