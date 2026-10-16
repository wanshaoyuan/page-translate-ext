(function (root, factory) {
  const api = factory(root);
  root.PT = Object.assign(root.PT || {}, api);
  if (typeof module !== "undefined" && module.exports && typeof process !== "undefined") {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const ICON = `
    <svg class="icon" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M15 24V15H24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M40 15H49V24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"></path>
      <path d="M49 40V49H40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"></path>
      <path d="M24 49H15V40" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"></path>
      <path fill="currentColor" d="M23.2 17.2l1.45 3.7 3.85 1.05-3.85 1.15-1.45 3.75-1.45-3.75-3.8-1.15 3.8-1.05z"></path>
      <path fill="currentColor" d="M30.2 14.4l.6 1.55 1.6.45-1.6.5-.6 1.55-.6-1.55-1.55-.5 1.55-.45z"></path>
      <text x="41" y="46" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="23" font-weight="700" fill="currentColor">A</text>
    </svg>
  `;

  const FAB_CSS = `
    :host {
      all: initial;
      position: fixed !important;
      z-index: 2147483647 !important;
      right: -25px !important;
      transform: translateY(-50%) !important;
      width: max-content !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      pointer-events: auto !important;
      transition: right 0.22s ease !important;
    }
    :host(:hover),
    :host(:focus-within),
    :host([data-mode="translating"]),
    :host([data-dragging="1"]) {
      right: 14px !important;
    }
    :host([data-dragging="1"]) { transition: none !important; }
    .slot {
      display: flex;
      align-items: center;
      flex-direction: row;
      user-select: none;
      touch-action: none;
      font-family: "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
    }
    .capsule {
      position: relative;
      z-index: 0;
      box-sizing: border-box;
      height: 36px;
      max-width: 18px;
      margin: 0 -22px 0 0;
      padding: 0;
      overflow: hidden;
      border-radius: 999px;
      background: #3a3a3c;
      color: #fff;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28);
      display: flex;
      align-items: center;
      white-space: nowrap;
      opacity: 1;
      transition: max-width 0.22s ease, padding 0.22s ease;
    }
    :host(:hover) .capsule,
    :host(:focus-within) .capsule,
    :host([data-mode="translating"]) .capsule,
    :host([data-dragging="1"]) .capsule {
      max-width: 240px;
      padding: 0 30px 0 14px;
    }
    .label {
      font-size: 13px;
      line-height: 1;
      letter-spacing: 0.01em;
      opacity: 0;
      transition: opacity 0.18s ease;
    }
    :host(:hover) .label,
    :host(:focus-within) .label,
    :host([data-mode="translating"]) .label,
    :host([data-dragging="1"]) .label { opacity: 1; }
    .fab {
      position: relative;
      z-index: 1;
      width: 50px;
      height: 50px;
      flex: 0 0 50px;
      border: 0;
      border-radius: 50%;
      padding: 0;
      background: #C8607A;
      color: #fff;
      box-shadow: 0 8px 18px rgba(200, 96, 122, 0.38);
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .fab:focus-visible {
      outline: 3px solid #fff;
      outline-offset: 2px;
    }
    :host([data-mode="translated"]) .fab {
      background: #fff;
      color: #C8607A;
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.16), inset 0 0 0 2px #C8607A;
    }
    :host([data-mode="error"]) .fab {
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.2), inset 0 0 0 3px #fff;
    }
    .icon { width: 30px; height: 30px; display: block; }
    .ring {
      display: none;
      position: absolute;
      inset: 3px;
      width: 44px;
      height: 44px;
      transform: rotate(-90deg);
    }
    .pct {
      display: none;
      position: relative;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    :host([data-mode="translating"]) .icon { visibility: hidden; position: absolute; }
    :host([data-mode="translating"]) .ring,
    :host([data-mode="translating"]) .pct { display: block; }
    @media (prefers-reduced-motion: reduce) {
      :host, .capsule, .label { transition: none !important; }
    }
  `;

  const TOAST_CSS = `
    :host {
      all: initial;
      position: fixed !important;
      z-index: 2147483647 !important;
      top: 14px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      width: max-content !important;
      max-width: min(560px, calc(100vw - 28px)) !important;
      pointer-events: auto !important;
    }
    :host([hidden]) { display: none !important; }
    .card {
      display: flex;
      align-items: center;
      gap: 10px;
      box-sizing: border-box;
      padding: 10px 12px 10px 14px;
      border-radius: 999px;
      background: #231c1a;
      color: #fff;
      box-shadow: 0 10px 30px rgba(28, 18, 16, 0.28);
      font-family: "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    .msg { display: block; }
    button {
      border: 0;
      border-radius: 999px;
      padding: 6px 10px;
      background: #C8607A;
      color: #fff;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    button.ghost { background: transparent; color: #f0d5dc; }
  `;

  function clampTop(ratio, viewportHeight) {
    const height = viewportHeight || 800;
    const min = 36 / height;
    const max = 1 - 36 / height;
    const number = Number(ratio);
    if (!Number.isFinite(number)) return 0.42;
    return Math.min(max, Math.max(min, number));
  }

  function describeFab(state) {
    const mode = state?.mode || "idle";
    if (mode === "translating") {
      const done = state.done || 0;
      const total = state.total || 0;
      const prefix = state.demo ? "演示 · " : "";
      return {
        label: `${prefix}正在翻译 ${done}/${total}`,
        aria: `正在翻译，已完成 ${done} 段，共 ${total} 段`,
      };
    }
    if (mode === "translated") {
      return { label: "还原原文", aria: "已显示双语对照，点击还原原文" };
    }
    if (mode === "error") {
      return { label: "翻译失败", aria: "翻译失败，点击清除已插入的译文" };
    }
    return { label: "翻译此页", aria: "把此页译成双语对照" };
  }

  function mountFab(doc, options) {
    const host = doc.createElement("fy-fab");
    host.setAttribute("data-fy-ui", "1");
    host.setAttribute("data-mode", "idle");
    host.setAttribute("translate", "no");
    const ratio = clampTop(options?.top ?? 0.42, doc.defaultView?.innerHeight);
    host.style.setProperty("top", `${ratio * 100}%`, "important");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${FAB_CSS}</style><div class="slot"><div class="capsule"><span class="label">翻译此页</span></div><button type="button" class="fab" aria-pressed="false">${ICON}<svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"></circle><circle class="prog" cx="22" cy="22" r="19" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-dasharray="119.38" stroke-dashoffset="119.38"></circle></svg><span class="pct"></span></button></div>`;
    const button = shadow.querySelector("button");
    const label = shadow.querySelector(".label");
    const percent = shadow.querySelector(".pct");
    const prog = shadow.querySelector(".prog");
    const slot = shadow.querySelector(".slot");
    let moved = false;
    let suppressClick = false;
    let dragging = false;
    let startY = 0;
    let startCenter = 0;
    const circumference = 2 * Math.PI * 19;

    function currentRatio() {
      const view = doc.defaultView;
      const height = view?.innerHeight || 800;
      const rect = host.getBoundingClientRect();
      const center = rect.height ? rect.top + rect.height / 2 : (parseFloat(host.style.top) / 100) * height;
      return clampTop(center / height, height);
    }

    let pointerId = null;
    let captured = false;

    // 按下就 setPointerCapture，Chrome 会吞掉随后的 click，按钮看起来点了但翻译不会开始。
    // 只有真正拖动时才捕获指针；原地点击仍交给 button 的 click。
    slot.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      dragging = true;
      moved = false;
      captured = false;
      pointerId = event.pointerId;
      startY = event.clientY;
      const rect = host.getBoundingClientRect();
      startCenter = rect.height ? rect.top + rect.height / 2 : 0;
    });
    slot.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const dy = event.clientY - startY;
      if (!moved) {
        if (Math.abs(dy) <= 4) return;
        moved = true;
        host.setAttribute("data-dragging", "1");
        try {
          slot.setPointerCapture?.(event.pointerId);
          captured = true;
        } catch {
          captured = false;
        }
      }
      const view = doc.defaultView;
      const height = view?.innerHeight || 800;
      const ratio = clampTop((startCenter + dy) / height, height);
      host.style.setProperty("top", `${ratio * 100}%`, "important");
    });
    function endDrag(event) {
      if (!dragging) return;
      if (pointerId != null && event.pointerId != null && event.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      host.removeAttribute("data-dragging");
      if (captured) {
        try {
          slot.releasePointerCapture?.(event.pointerId);
        } catch {
          /* 捕获可能已经释放。 */
        }
      }
      captured = false;
      if (moved) {
        suppressClick = true;
        if (options?.onTopChange) options.onTopChange(currentRatio());
      }
      moved = false;
    }
    slot.addEventListener("pointerup", endDrag);
    slot.addEventListener("pointercancel", endDrag);
    button.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      options?.onToggle?.();
    });

    (doc.body || doc.documentElement).appendChild(host);

    function update(state) {
      const next = state || { mode: "idle" };
      host.setAttribute("data-mode", next.mode || "idle");
      const copy = describeFab(next);
      label.textContent = copy.label;
      button.setAttribute("aria-label", copy.aria);
      button.setAttribute("aria-pressed", next.mode === "translated" ? "true" : "false");
      const total = next.total || 0;
      const pct = total ? Math.max(0, Math.min(1, (next.done || 0) / total)) : 0;
      percent.textContent = next.mode === "translating" ? String(Math.round(pct * 100)) : "";
      prog.style.strokeDasharray = String(circumference);
      prog.style.strokeDashoffset = String(circumference * (1 - pct));
    }

    update({ mode: "idle" });
    return {
      host,
      update,
      setTop(next) {
        const value = clampTop(next, doc.defaultView?.innerHeight);
        host.style.setProperty("top", `${value * 100}%`, "important");
      },
      destroy() {
        host.remove();
      },
    };
  }

  function mountToast(doc, options) {
    const host = doc.createElement("fy-toast");
    host.setAttribute("data-fy-ui", "1");
    host.setAttribute("translate", "no");
    host.hidden = true;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${TOAST_CSS}</style><div class="card" role="status" aria-live="polite"><span class="msg"></span><button type="button" class="settings" hidden>打开设置</button><button type="button" class="ghost close">关闭</button></div>`;
    const message = shadow.querySelector(".msg");
    const settings = shadow.querySelector(".settings");
    const close = shadow.querySelector(".close");
    let timer = 0;
    settings.addEventListener("click", () => options?.onOpenSettings?.());
    close.addEventListener("click", () => hide());

    function hide() {
      clearTimeout(timer);
      host.hidden = true;
    }
    function show(text, extras) {
      clearTimeout(timer);
      message.textContent = text;
      settings.hidden = !extras?.settings;
      host.hidden = false;
      if (extras?.timeout) timer = setTimeout(hide, extras.timeout);
    }
    (doc.body || doc.documentElement).appendChild(host);
    return {
      host,
      showProgress(done, total, demo) {
        const prefix = demo ? "演示模式 · " : "";
        show(`${prefix}正在翻译 ${done}/${total} 段`, { timeout: 0 });
      },
      showMessage(text, extras) {
        show(text, extras);
      },
      hide,
      destroy() {
        clearTimeout(timer);
        host.remove();
      },
    };
  }

  return { clampTop, describeFab, mountFab, mountToast };
});
