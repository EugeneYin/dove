import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupIn, type DictFile, type Row } from "./dict.ts";

const row = (phonetic: string, translation: string, definition: string): Row => [
  phonetic,
  translation,
  definition,
];

const dict: DictFile = {
  w: {
    run: row("rʌn", "n. 跑，赛跑", "to move fast"),
    convey: row("kәn'vei", "vt. 传达，运输", "to carry"),
    constructor: row("kәn'strʌktә", "n. 建造者", "one who constructs"),
  },
  l: { ran: "run", conveys: "convey", missingbase: "nosuchword" },
};

test("直接命中", () => {
  const e = lookupIn(dict, "run");
  assert.equal(e?.word, "run");
  assert.equal(e?.phonetic, "rʌn");
  assert.equal(e?.lemmaOf, undefined);
});

test("大小写不敏感", () => {
  assert.equal(lookupIn(dict, "Run")?.word, "run");
  assert.equal(lookupIn(dict, "CONVEYS")?.word, "convey");
});

test("词形还原并标注原查询词", () => {
  const e = lookupIn(dict, "ran");
  assert.equal(e?.word, "run");
  assert.equal(e?.lemmaOf, "ran");
});

test("变形指向的原型不在词表时不误报", () => {
  assert.equal(lookupIn(dict, "missingbase"), null);
});

test("不会命中 Object.prototype 上的属性", () => {
  // 词表真的收录了 constructor，必须返回词条本身
  assert.equal(lookupIn(dict, "constructor")?.translation, "n. 建造者");
  // 未收录的原型属性必须报未找到，而不是返回函数
  assert.equal(lookupIn(dict, "toString"), null);
  assert.equal(lookupIn(dict, "hasOwnProperty"), null);
  assert.equal(lookupIn(dict, "__proto__"), null);
});

test("未收录返回 null", () => {
  assert.equal(lookupIn(dict, "zzzz"), null);
});
