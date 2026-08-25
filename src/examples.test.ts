import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOnlineExamples } from "./examples.ts";

test("按词义顺序返回最多两条不重复例句", () => {
  const result = parseOnlineExamples({
    entries: [
      {
        senses: [
          { examples: [" Air conveys sound. ", "Air conveys sound."] },
          { examples: ["She conveyed the news calmly.", "A third example."] },
        ],
      },
    ],
    source: { url: "https://en.wiktionary.org/wiki/convey" },
  });

  assert.deepEqual(result, {
    sentences: ["Air conveys sound.", "She conveyed the news calmly."],
    sourceUrl: "https://en.wiktionary.org/wiki/convey",
  });
});

test("支持子词义并忽略不可信来源链接", () => {
  const result = parseOnlineExamples({
    entries: [{ senses: [{ subsenses: [{ examples: ["A nested example."] }] }] }],
    source: { url: "javascript:alert(1)" },
  });

  assert.deepEqual(result, { sentences: ["A nested example."], sourceUrl: null });
});

test("响应格式不完整时返回空结果", () => {
  assert.deepEqual(parseOnlineExamples(null), { sentences: [], sourceUrl: null });
  assert.deepEqual(parseOnlineExamples({ entries: "invalid" }), {
    sentences: [],
    sourceUrl: null,
  });
});
