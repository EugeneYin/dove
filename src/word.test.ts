import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWord, segmentAt, endsLineWithHyphen } from "./word.ts";

test("normalizeWord 去掉所有格和标点", () => {
  assert.equal(normalizeWord("learner’s"), "learner");
  assert.equal(normalizeWord("learner's"), "learner");
  assert.equal(normalizeWord("boys'"), "boys");
  assert.equal(normalizeWord("ubiquitous."), "ubiquitous");
  assert.equal(normalizeWord("“quoted”"), "quoted");
  assert.equal(normalizeWord("reading"), "reading");
  assert.equal(normalizeWord("123"), "");
});

test("segmentAt 命中光标所在的词", () => {
  const text = "vocabulary under-";
  assert.deepEqual(segmentAt(text, 0), { start: 0, end: 10 });
  assert.deepEqual(segmentAt(text, 5), { start: 0, end: 10 });
  assert.deepEqual(segmentAt(text, 13), { start: 11, end: 16 });
  // 光标停在词尾字符之后仍算命中该词
  assert.deepEqual(segmentAt(text, 16), { start: 11, end: 16 });
});

test("endsLineWithHyphen 只在行尾连字符时成立", () => {
  // 跨行断词：应当拼接
  assert.equal(endsLineWithHyphen("vocabulary under-", 16), true);
  assert.equal(endsLineWithHyphen("vocabulary under- ", 16), true);
  // 行内复合词：不能拼接
  assert.equal(endsLineWithHyphen("well-known", 4), false);
  // 普通词尾
  assert.equal(endsLineWithHyphen("reading", 7), false);
});
