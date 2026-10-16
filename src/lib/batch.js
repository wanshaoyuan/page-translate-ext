(function (root, factory) {
  const api = factory();
  root.PT = Object.assign(root.PT || {}, api);
  if (typeof module !== "undefined" && module.exports && typeof process !== "undefined") {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function chunkSegments(items, options) {
    const maxChars = options?.maxChars ?? 1600;
    const maxItems = options?.maxItems ?? 8;
    const batches = [];
    let batch = [];
    let chars = 0;
    (items || []).forEach((item) => {
      const size = String(item?.text || "").length;
      const overflows = batch.length > 0 && (batch.length >= maxItems || chars + size > maxChars);
      if (overflows) {
        batches.push(batch);
        batch = [];
        chars = 0;
      }
      batch.push(item);
      chars += size;
    });
    if (batch.length) batches.push(batch);
    return batches;
  }

  function splitLongText(text, maxChars) {
    const source = String(text ?? "");
    if (!source) return [""];
    if (source.length <= maxChars) return [source];
    const parts = [];
    let start = 0;
    while (start < source.length) {
      if (source.length - start <= maxChars) {
        parts.push(source.slice(start));
        break;
      }
      let limit = start + maxChars;
      const window = source.slice(start, limit);
      const open = window.lastIndexOf("⟪");
      const close = window.lastIndexOf("⟫");
      if (open !== -1 && open > close) {
        if (open > 0) {
          limit = start + open;
        } else {
          const closeAbs = source.indexOf("⟫", start);
          limit = closeAbs === -1 ? Math.min(source.length, start + maxChars) : closeAbs + 1;
          parts.push(source.slice(start, limit));
          start = limit;
          continue;
        }
      }
      const slice = source.slice(start, limit);
      const tokens = ["。", "！", "？", "\n", "；", ". ", "! ", "? ", "; "];
      let best = -1;
      tokens.forEach((token) => {
        const index = slice.lastIndexOf(token);
        if (index >= 0) best = Math.max(best, index + token.length);
      });
      if (best >= Math.floor(slice.length * 0.4)) limit = start + best;
      if (limit <= start) limit = Math.min(source.length, start + maxChars);
      parts.push(source.slice(start, limit));
      start = limit;
    }
    const out = parts.filter((part) => part.length);
    return out.length ? out : [source];
  }

  function planPieces(units, options) {
    const maxChars = options?.maxChars ?? 1600;
    const maxItems = options?.maxItems ?? 8;
    const pieces = [];
    (units || []).forEach((unit) => {
      const parts = splitLongText(unit.text || "", maxChars);
      parts.forEach((part, index) => {
        pieces.push({
          pieceIndex: pieces.length,
          unitId: unit.id,
          part: index,
          partCount: parts.length,
          text: part,
        });
      });
    });
    return {
      pieces,
      batches: chunkSegments(pieces, { maxChars, maxItems }),
    };
  }

  function joinTranslations(pieces, translated) {
    const groups = new Map();
    pieces.forEach((piece, index) => {
      if (!groups.has(piece.unitId)) groups.set(piece.unitId, []);
      groups.get(piece.unitId)[piece.part] = translated[index] ?? "";
    });
    return [...groups.entries()].map(([unitId, parts]) => ({
      unitId,
      text: parts.map((part) => part ?? "").join(""),
    }));
  }

  function groupDuplicateUnits(units) {
    const map = new Map();
    const out = [];
    (units || []).forEach((unit) => {
      const key = `${unit.text}\u0000${(unit.codes || []).join("\u0000")}`;
      let group = map.get(key);
      if (!group) {
        group = {
          id: unit.id,
          text: unit.text,
          codes: unit.codes || [],
          elements: [],
        };
        map.set(key, group);
        out.push(group);
      }
      if (unit.element) group.elements.push(unit.element);
    });
    return out;
  }

  async function mapPool(items, limit, fn) {
    const list = items || [];
    const results = new Array(list.length);
    if (!list.length) return results;
    let cursor = 0;
    let firstError = null;
    const workers = Math.min(Math.max(1, limit || 1), list.length);
    async function worker() {
      while (firstError == null) {
        const index = cursor;
        cursor += 1;
        if (index >= list.length) return;
        try {
          results[index] = await fn(list[index], index);
        } catch (error) {
          if (!firstError) firstError = error;
          return;
        }
      }
    }
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (firstError) throw firstError;
    return results;
  }

  return {
    chunkSegments,
    splitLongText,
    planPieces,
    joinTranslations,
    groupDuplicateUnits,
    mapPool,
  };
});
