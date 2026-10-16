(function (root, factory) {
  const api = factory(root);
  root.PT = Object.assign(root.PT || {}, api);
  if (typeof module !== "undefined" && module.exports && typeof process !== "undefined") {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const MESSAGES = {
    NO_KEY: "请先在扩展设置页填写 DeepSeek API Key。右键点击工具栏图标，选择「选项」。",
    RATE_LIMIT: "请求过于频繁（HTTP 429），请稍等一会儿再翻译。",
    AUTH: "API Key 无效或没有权限，请在设置页检查 Key。",
    NETWORK: "网络错误，请检查网络连接，或确认 Base URL 可以访问。",
    TIMEOUT: "请求超时，请稍后重试。",
    BAD_RESPONSE: "模型返回的内容无法解析，请重试或更换模型。",
    LENGTH_MISMATCH: "模型返回的译文条数和原文不一致，请重试。",
    BAD_URL: "Base URL 格式不正确，请填写以 http:// 或 https:// 开头的地址。",
    CANCELLED: "已取消翻译。",
  };

  class TranslateError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "TranslateError";
      this.code = code;
      this.userMessage = message;
    }
  }

  function scrub(message, secret) {
    let out = String(message || "");
    if (secret && secret.length > 3) out = out.split(secret).join("***");
    return out;
  }

  function chatCompletionsUrl(baseUrl) {
    const base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (/\/chat\/completions$/i.test(base)) return base;
    return `${base}/chat/completions`;
  }

  function assertHttpUrl(baseUrl) {
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new TranslateError("BAD_URL", MESSAGES.BAD_URL);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TranslateError("BAD_URL", MESSAGES.BAD_URL);
    }
    return url;
  }

  function buildSystemPrompt(targetLanguage, terms) {
    const list = (terms || []).map((term) => String(term || "").trim()).filter(Boolean);
    let shown = list.join("、");
    if (shown.length > 3500) shown = `${shown.slice(0, 3500)}…`;
    return [
      `你是严谨的技术翻译器，只把内容翻译成${targetLanguage || "简体中文"}。`,
      "用户会给你一个 JSON 字符串数组。请只返回一个 JSON 对象：{\"translations\":[\"...\"]}。",
      "translations 的长度和顺序必须与输入数组完全一致。不要输出 Markdown、注释或多余文字。",
      "占位符形如 ⟪ab12T0⟫ 或 ⟪ab12C0⟫，必须原样保留，不要翻译、不要改写、不要增删。",
      "代码、命令、URL、路径、版本号保持原样。",
      shown ? `这些术语必须保留英文，不要音译或意译：${shown}。` : "保留原文中的英文技术术语。",
      "特别注意：Claude 不能译成「克劳德」，Agent 不能译成「代理」或「智能体」，Prompt 不能译成「提示词」，Token 不能译成「令牌」。",
      "译文自然流畅，保留换行。",
    ].join("\n");
  }

  function extractJson(content) {
    let source = String(content || "").trim();
    source = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(source);
    } catch {
      /* continue */
    }
    const arrayStart = source.indexOf("[");
    const arrayEnd = source.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(source.slice(arrayStart, arrayEnd + 1));
      } catch {
        /* continue */
      }
    }
    const objectStart = source.indexOf("{");
    const objectEnd = source.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd > objectStart) {
      try {
        return JSON.parse(source.slice(objectStart, objectEnd + 1));
      } catch {
        /* continue */
      }
    }
    throw new TranslateError("BAD_RESPONSE", MESSAGES.BAD_RESPONSE);
  }

  function parseTranslations(content, expected) {
    const data = extractJson(content);
    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.translations)) list = data.translations;
    else if (data && Array.isArray(data.results)) list = data.results;
    if (!list) throw new TranslateError("BAD_RESPONSE", MESSAGES.BAD_RESPONSE);
    if (list.length !== expected) throw new TranslateError("LENGTH_MISMATCH", MESSAGES.LENGTH_MISMATCH);
    return list.map((item) => (item == null ? "" : String(item)));
  }

  function httpMessage(status, body, secret) {
    if (status === 429) return MESSAGES.RATE_LIMIT;
    if (status === 401 || status === 403) return MESSAGES.AUTH;
    const detail = body?.error?.message || body?.message;
    const suffix = detail ? `（${scrub(String(detail), secret).slice(0, 160)}）` : "";
    return `翻译服务返回错误（HTTP ${status}）${suffix}`;
  }

  function isAbortError(error) {
    return error?.name === "AbortError" || error?.code === 20;
  }

  async function readBody(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

function retryDelayMs(response) {
  const raw = response.headers?.get?.("retry-after");
  if (raw == null || raw === "") return 1200;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds > 8) return null;
  return Math.round(Math.max(0, seconds) * 1000);
}

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new TranslateError("CANCELLED", MESSAGES.CANCELLED));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function fetchWithTimeout(fetchImpl, url, init, signal) {
    const timeout = AbortSignal.timeout(50000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fetchImpl(url, { ...init, signal: combined });
    } catch (error) {
      if (isAbortError(error) || signal?.aborted || timeout.aborted) {
        if (signal?.aborted) throw new TranslateError("CANCELLED", MESSAGES.CANCELLED);
        throw new TranslateError("TIMEOUT", MESSAGES.TIMEOUT);
      }
      throw new TranslateError("NETWORK", MESSAGES.NETWORK);
    }
  }

  async function requestTranslations(strings, settings, deps, options) {
    if (deps.signal?.aborted) throw new TranslateError("CANCELLED", MESSAGES.CANCELLED);
    assertHttpUrl(settings.baseUrl);
    const url = chatCompletionsUrl(settings.baseUrl);
    const payload = {
      model: settings.model || "deepseek-chat",
      temperature: 0.1,
      messages: [
        { role: "system", content: buildSystemPrompt(settings.targetLanguage, settings.terms) },
        { role: "user", content: JSON.stringify(strings) },
      ],
    };
    if (options.jsonMode) payload.response_format = { type: "json_object" };
    const response = await fetchWithTimeout(
      deps.fetchImpl,
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      deps.signal,
    );
    if (response.status === 400 && options.jsonMode) {
      return requestTranslations(strings, settings, deps, { jsonMode: false, allow429Retry: options.allow429Retry });
    }
    if (response.status === 429 && options.allow429Retry) {
      const wait = retryDelayMs(response);
      if (wait != null) {
        await delay(wait, deps.signal);
        return requestTranslations(strings, settings, deps, { jsonMode: options.jsonMode, allow429Retry: false });
      }
    }
    if (!response.ok) {
      const body = await readBody(response);
      const code = response.status === 429 ? "RATE_LIMIT" : response.status === 401 || response.status === 403 ? "AUTH" : "HTTP";
      throw new TranslateError(code, httpMessage(response.status, body, settings.apiKey));
    }
    const data = await readBody(response);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new TranslateError("BAD_RESPONSE", MESSAGES.BAD_RESPONSE);
    return parseTranslations(content, strings.length);
  }

  async function translateBatch(batch, settings, deps, codeMap) {
    const PT = root.PT;
    const nonce = deps.nonce;
    const protectedBatch = batch.map((piece) => PT.protectTerms(piece.text, settings.terms, nonce));
    const payload = protectedBatch.map((item) => item.text);
    let outputs;
    if (settings.demoMode) {
      outputs = payload.map((text, index) =>
        PT.mockTranslate(text, {
          replacements: protectedBatch[index].replacements,
          nonce,
          codes: codeMap.get(batch[index].unitId) || [],
          terms: settings.terms,
        }),
      );
    } else {
      outputs = await requestTranslations(payload, settings, deps, { jsonMode: true, allow429Retry: true });
    }
    if (outputs.length !== payload.length) {
      throw new TranslateError("LENGTH_MISMATCH", MESSAGES.LENGTH_MISMATCH);
    }
    return outputs.map((output, index) =>
      PT.finalizeTranslation(output, protectedBatch[index].replacements, nonce),
    );
  }

  async function translateTexts(items, settings, deps = {}) {
    const PT = root.PT;
    const list = (items || []).map((item, index) => ({
      id: item.id || `u${index}`,
      text: item.text || "",
      codes: item.codes || [],
    }));
    if (!settings?.demoMode && !String(settings?.apiKey || "").trim()) {
      throw new TranslateError("NO_KEY", MESSAGES.NO_KEY);
    }
    if (!/^[a-z0-9]{2,8}$/.test(deps?.nonce || "")) {
      throw new TranslateError("BAD_RESPONSE", "内部错误：占位符编号无效。");
    }
    const plan = PT.planPieces(list, {
      maxChars: deps.maxChars ?? 1600,
      maxItems: deps.maxItems ?? 8,
    });
    const pieceOut = new Array(plan.pieces.length);
    const codeMap = new Map(list.map((item) => [item.id, item.codes]));
    const concurrency = deps.concurrency ?? 3;
    const emitted = new Set();
    let finished = 0;
    if (deps.onProgress) await deps.onProgress(0, list.length);
    await PT.mapPool(plan.batches, concurrency, async (batch) => {
      if (deps.signal?.aborted) throw new TranslateError("CANCELLED", MESSAGES.CANCELLED);
      const translated = await translateBatch(batch, settings, deps, codeMap);
      if (deps.signal?.aborted) throw new TranslateError("CANCELLED", MESSAGES.CANCELLED);
      batch.forEach((piece, index) => {
        pieceOut[piece.pieceIndex] = translated[index];
      });
      const byUnit = new Map();
      plan.pieces.forEach((piece) => {
        if (!byUnit.has(piece.unitId)) byUnit.set(piece.unitId, []);
        byUnit.get(piece.unitId).push(piece);
      });
      const readyUnits = [];
      byUnit.forEach((pieces, unitId) => {
        if (emitted.has(unitId)) return;
        const touched = pieces.some((piece) => batch.includes(piece));
        const complete = pieces.every((piece) => pieceOut[piece.pieceIndex] != null);
        if (!touched || !complete) return;
        emitted.add(unitId);
        const text = pieces
          .slice()
          .sort((a, b) => a.part - b.part)
          .map((piece) => pieceOut[piece.pieceIndex])
          .join("");
        readyUnits.push({ unitId, text });
      });
      for (const unit of readyUnits) {
        finished += 1;
        if (deps.onUnit) await deps.onUnit(unit);
        if (deps.onProgress) await deps.onProgress(finished, list.length);
      }
    });
    return joinReady(plan.pieces, pieceOut);
  }

  function joinReady(pieces, translated) {
    return root.PT.joinTranslations(pieces, translated);
  }

  return {
    MESSAGES,
    TranslateError,
    scrub,
    chatCompletionsUrl,
    buildSystemPrompt,
    parseTranslations,
    translateTexts,
  };
});
