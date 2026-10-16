(function (root, factory) {
  const api = factory(root);
  root.PT = Object.assign(root.PT || {}, api);
  if (typeof module !== "undefined" && module.exports && typeof process !== "undefined") {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "BUTTON",
    "PRE",
    "SVG",
    "CANVAS",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "VIDEO",
    "AUDIO",
    "MAP",
    "TEMPLATE",
    "MATH",
    "HEAD",
  ]);

  const BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DD",
    "DETAILS",
    "DIV",
    "DL",
    "DT",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "SECTION",
    "TABLE",
    "TBODY",
    "THEAD",
    "TFOOT",
    "TR",
    "TD",
    "TH",
    "UL",
    "SUMMARY",
    "CAPTION",
    "PRE",
    "CENTER",
  ]);

  const INLINE_TAGS = new Set([
    "A",
    "ABBR",
    "B",
    "BDI",
    "BDO",
    "BR",
    "CITE",
    "CODE",
    "DATA",
    "DFN",
    "EM",
    "I",
    "KBD",
    "MARK",
    "Q",
    "S",
    "SAMP",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TIME",
    "U",
    "VAR",
    "WBR",
    "LABEL",
  ]);

  const HOST_STYLE = {
    display: "block",
    margin: "0.42em 0 0.12em",
    padding: "0",
    border: "none",
    float: "none",
    clear: "none",
    position: "static",
    inset: "auto",
    width: "100%",
    maxWidth: "100%",
    minWidth: "0",
    height: "auto",
    background: "transparent",
    boxShadow: "none",
    transform: "none",
    opacity: "1",
    visibility: "visible",
    whiteSpace: "normal",
    textAlign: "start",
    textIndent: "0",
    textTransform: "none",
    letterSpacing: "normal",
    lineHeight: "inherit",
    font: "inherit",
    color: "inherit",
    userSelect: "text",
    cursor: "auto",
    flex: "1 0 100%",
    alignSelf: "stretch",
    "grid-column": "1 / -1",
  };

  const TRANSLATION_CSS = `
    :host { all: initial; }
    .line {
      display: block;
      box-sizing: border-box;
      margin: 0;
      padding: 0.08em 0 0.08em 0.72em;
      border-left: 3px solid #C8607A;
      color: inherit;
    }
    .body {
      display: block;
      opacity: 0.74;
      font: inherit;
      font-size: 0.95em;
      line-height: 1.7;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      cursor: text;
      user-select: text;
    }
    code.keep {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      opacity: 1;
      background: color-mix(in srgb, currentColor 10%, transparent);
      border-radius: 4px;
      padding: 0 0.28em;
    }
  `;

  function tagOf(el) {
    return String(el?.tagName || "").toUpperCase();
  }

  function isBlockDisplay(value) {
    const display = String(value || "").trim().split(/\s+/)[0];
    return (
      display === "block" ||
      display === "flex" ||
      display === "grid" ||
      display === "list-item" ||
      display === "table" ||
      display === "table-row" ||
      display === "table-cell" ||
      display === "flow-root" ||
      display === "table-caption"
    );
  }

  function computedStyle(el) {
    const view = el?.ownerDocument?.defaultView;
    if (!view || typeof view.getComputedStyle !== "function") return null;
    try {
      return view.getComputedStyle(el);
    } catch {
      return null;
    }
  }

  function isBlockElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = tagOf(el);
    if (INLINE_TAGS.has(tag)) return false;
    if (BLOCK_TAGS.has(tag)) return true;
    return isBlockDisplay(computedStyle(el)?.display);
  }

  function isVisuallyHidden(el) {
    let current = el;
    while (current && current.nodeType === 1) {
      if (current === el && current.getAttribute("aria-hidden") === "true") return true;
      if (current.hidden || current.getAttribute("hidden") != null) return true;
      const style = computedStyle(current);
      if (style && (style.display === "none" || style.visibility === "hidden")) return true;
      if (tagOf(current) === "BODY" || tagOf(current) === "HTML") break;
      current = current.parentElement;
    }
    return false;
  }

  function shouldSkipElement(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.hasAttribute("data-fy-ui") || el.hasAttribute("data-fy-translation")) return true;
    const tag = tagOf(el);
    if (SKIP_TAGS.has(tag)) return true;
    if (typeof el.closest === "function" && el.closest("pre, script, style, textarea, noscript, svg, canvas, iframe")) {
      return true;
    }
    if (el.getAttribute("translate") === "no") return true;
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") return true;
    if (typeof el.closest === "function" && el.closest("[contenteditable='true']")) return true;
    const details = typeof el.closest === "function" ? el.closest("details") : null;
    if (details && !details.open && tag !== "SUMMARY" && !(typeof el.closest === "function" && el.closest("summary"))) {
      return true;
    }
    return false;
  }

  function extractInlineText(el, nonce) {
    const PT = root.PT;
    const codes = [];
    let text = "";
    function walk(node) {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          text += child.textContent || "";
          return;
        }
        if (child.nodeType !== 1) return;
        if (child.hasAttribute?.("data-fy-translation") || child.hasAttribute?.("data-fy-ui")) return;
        const tag = tagOf(child);
        if (tag === "BR") {
          text += " ";
          return;
        }
        if (tag === "CODE" || tag === "KBD" || tag === "SAMP") {
          const id = codes.length;
          codes.push(child.textContent || "");
          text += PT.slot(nonce, "C", id);
          return;
        }
        if (SKIP_TAGS.has(tag) || child.getAttribute?.("translate") === "no") return;
        if (isBlockElement(child)) return;
        walk(child);
      });
    }
    walk(el);
    return { text: text.replace(/\s+/g, " ").trim(), codes };
  }

  function collectUnits(rootEl, options) {
    const PT = root.PT;
    const nonce = options?.nonce || "page";
    const terms = options?.terms || [];
    const targetLanguage = options?.targetLanguage || "";
    const units = [];
    let seq = 0;

    function walk(el) {
      if (shouldSkipElement(el) || isVisuallyHidden(el)) return;
      const extracted = extractInlineText(el, nonce);
      if (PT.shouldTranslateText(extracted.text, terms, targetLanguage)) {
        units.push({
          id: `u${seq}`,
          element: el,
          text: extracted.text,
          codes: extracted.codes,
        });
        seq += 1;
      }
      [...el.children].forEach((child) => {
        if (shouldSkipElement(child) || !isBlockElement(child)) return;
        walk(child);
      });
    }

    if (rootEl) walk(rootEl);
    return units;
  }

  function applyHostStyle(el) {
    Object.entries(HOST_STYLE).forEach(([key, value]) => {
      const prop = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      el.style.setProperty(prop, value, "important");
    });
  }

  function fillTranslation(container, text, codes, nonce, doc) {
    const PT = root.PT;
    const source = String(text ?? "");
    const pattern = new RegExp(`⟪${PT.escapeRegExp(nonce)}C(\\d+)⟫`, "g");
    let last = 0;
    let match = pattern.exec(source);
    while (match) {
      if (match.index > last) {
        container.appendChild(doc.createTextNode(source.slice(last, match.index)));
      }
      const code = doc.createElement("code");
      code.className = "keep";
      code.textContent = codes?.[Number(match[1])] ?? "";
      container.appendChild(code);
      last = match.index + match[0].length;
      match = pattern.exec(source);
    }
    if (last < source.length) container.appendChild(doc.createTextNode(source.slice(last)));
  }

  function placeTranslation(element, host) {
    const anchor = [...element.children].find(
      (child) => child !== host && !child.hasAttribute("data-fy-translation") && isBlockElement(child),
    );
    if (anchor) element.insertBefore(host, anchor);
    else element.appendChild(host);
  }

  function mountTranslation(element, text, codes, nonce) {
    if (!element || !String(text || "").trim()) return null;
    [...element.children]
      .filter((child) => child.hasAttribute?.("data-fy-translation"))
      .forEach((child) => child.remove());
    const doc = element.ownerDocument;
    const host = doc.createElement("fy-trans");
    host.setAttribute("data-fy-translation", "1");
    host.setAttribute("translate", "no");
    host.setAttribute("contenteditable", "false");
    applyHostStyle(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = TRANSLATION_CSS;
    const line = doc.createElement("div");
    line.className = "line";
    const body = doc.createElement("div");
    body.className = "body";
    body.dir = "auto";
    fillTranslation(body, text, codes, nonce, doc);
    line.appendChild(body);
    shadow.append(style, line);
    element.setAttribute("data-fy-source", "1");
    placeTranslation(element, host);
    return host;
  }

  function clearTranslations(scope) {
    const rootEl = scope?.querySelectorAll ? scope : scope?.document || root.document;
    if (!rootEl?.querySelectorAll) return;
    rootEl.querySelectorAll("[data-fy-translation]").forEach((node) => node.remove());
    rootEl.querySelectorAll("[data-fy-source]").forEach((node) => node.removeAttribute("data-fy-source"));
  }

  return {
    SKIP_TAGS,
    isBlockElement,
    shouldSkipElement,
    extractInlineText,
    collectUnits,
    mountTranslation,
    clearTranslations,
    fillTranslation,
  };
});
