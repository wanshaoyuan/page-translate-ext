(function () {
  "use strict";

  const nonce = "demo";
  let mode = "idle";
  const settings = PT.normalizeSettings({
    demoMode: true,
    terms: PT.DEFAULT_TERMS,
    targetLanguage: "简体中文",
  });
  const toast = PT.mountToast(document, { onOpenSettings() {} });
  const fab = PT.mountFab(document, {
    top: 0.58,
    onToggle() {
      toggle();
    },
  });

  function paint(next) {
    mode = next.mode;
    fab.update(next);
  }

  async function toggle() {
    if (mode !== "idle") {
      PT.clearTranslations(document);
      toast.hide();
      paint({ mode: "idle" });
      return;
    }
    const units = PT.collectUnits(document.body, {
      nonce,
      terms: settings.terms,
      targetLanguage: settings.targetLanguage,
    });
    const groups = PT.groupDuplicateUnits(units);
    const total = groups.reduce((sum, group) => sum + group.elements.length, 0);
    paint({ mode: "translating", done: 0, total, demo: true });
    toast.showProgress(0, total, true);
    let done = 0;
    try {
      await PT.translateTexts(
        groups.map((group) => ({ id: group.id, text: group.text, codes: group.codes })),
        settings,
        {
          nonce,
          fetchImpl: async () => {
            throw new Error("演示模式不应访问网络");
          },
          async onUnit(unit) {
            const group = groups.find((item) => item.id === unit.unitId);
            if (!group) return;
            group.elements.forEach((element) => PT.mountTranslation(element, unit.text, group.codes, nonce));
            done += group.elements.length;
            paint({ mode: "translating", done, total, demo: true });
            toast.showProgress(done, total, true);
          },
        },
      );
      paint({ mode: done ? "translated" : "idle", demo: true });
      toast.showMessage(done ? `已对照 ${done} 段，原文仍保留在上方。` : "没有得到译文。", { timeout: 2400 });
    } catch (error) {
      paint({ mode: "error" });
      toast.showMessage(error.userMessage || error.message || "演示翻译失败。", { timeout: 6000 });
    }
  }
})();
