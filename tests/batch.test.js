const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/lib/batch.js");
const { chunkSegments, splitLongText, planPieces, joinTranslations, groupDuplicateUnits, mapPool } = require("../src/lib/batch.js");

test("按字符数和条数分批，超长段单独成批", () => {
  const items = [
    { text: "a".repeat(1000) },
    { text: "b".repeat(1000) },
    { text: "c".repeat(100) },
  ];
  const batches = chunkSegments(items, { maxChars: 1500, maxItems: 8 });
  assert.equal(batches.length, 2);
  assert.equal(batches[0].length, 1);
  assert.equal(batches[1].length, 2);

  const tiny = chunkSegments(
    Array.from({ length: 5 }, (_, index) => ({ text: `item-${index}` })),
    { maxChars: 500, maxItems: 2 },
  );
  assert.deepEqual(tiny.map((batch) => batch.length), [2, 2, 1]);
});

test("切分长文本时不拆开占位符，拼回去仍是原文", () => {
  const marker = "⟪abC0⟫";
  const text = `${"A".repeat(50)}${marker}${"B".repeat(50)}`;
  const parts = splitLongText(text, 40);
  assert.equal(parts.join(""), text);
  assert.ok(parts.some((part) => part.includes(marker)));
  parts.forEach((part) => {
    const opens = part.split("⟪").length - 1;
    const closes = part.split("⟫").length - 1;
    assert.equal(opens, closes);
  });
});

test("分批译文按原段落顺序拼回", () => {
  const units = [
    { id: "h", text: `${"Hello ".repeat(30)}end.` },
    { id: "p", text: "Short line." },
  ];
  const plan = planPieces(units, { maxChars: 40, maxItems: 2 });
  assert.ok(plan.pieces.length > 2);
  assert.ok(plan.batches.length > 1);
  plan.batches.forEach((batch) => {
    assert.ok(batch.length <= 2);
  });
  const translated = plan.pieces.map((piece, index) => `[${index}]${piece.text}`);
  const joined = joinTranslations(plan.pieces, translated);
  assert.deepEqual(joined.map((item) => item.unitId), ["h", "p"]);
  assert.equal(joined[0].text.includes("Hello"), true);
  assert.equal(joined[1].text.endsWith("Short line."), true);
  assert.equal(
    joined[0].text.replace(/\[\d+\]/g, ""),
    units[0].text,
  );
});

test("相同文本只请求一次", () => {
  const elementA = { id: "a" };
  const elementB = { id: "b" };
  const groups = groupDuplicateUnits([
    { id: "u0", text: "Same", codes: ["kubectl"], element: elementA },
    { id: "u1", text: "Same", codes: ["kubectl"], element: elementB },
    { id: "u2", text: "Other", codes: [], element: { id: "c" } },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, "u0");
  assert.deepEqual(groups[0].elements, [elementA, elementB]);
});

test("并发数不超过上限", async () => {
  let active = 0;
  let maxActive = 0;
  const items = [0, 1, 2, 3, 4, 5];
  const results = await mapPool(items, 2, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return item * 2;
  });
  assert.equal(maxActive, 2);
  assert.deepEqual(results, [0, 2, 4, 6, 8, 10]);
});
