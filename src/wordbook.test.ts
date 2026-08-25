import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadWordbook,
  saveWordbook,
  singleLineMeaning,
  WORDBOOK_STORAGE_KEY,
  type WordbookEntry,
} from "./wordbook.ts";

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const entry: WordbookEntry = {
  id: "word-1",
  word: "convey",
  phonetic: "kənˈveɪ",
  meaning: "vt. 传达；运输",
  createdAt: 1,
};

test("多行词性与含义合并成一行", () => {
  assert.equal(singleLineMeaning(" vt. 传达 \n\n n. 运输工具\r\n"), "vt. 传达；n. 运输工具");
});

test("保存后可恢复词条", () => {
  const storage = new MemoryStorage();
  saveWordbook(storage, [entry]);
  assert.deepEqual(loadWordbook(storage), [entry]);
});

test("损坏或结构不完整的数据不会破坏单词本", () => {
  const storage = new MemoryStorage();
  storage.setItem(WORDBOOK_STORAGE_KEY, "not-json");
  assert.deepEqual(loadWordbook(storage), []);

  storage.setItem(WORDBOOK_STORAGE_KEY, JSON.stringify([entry, { word: "missing-fields" }]));
  assert.deepEqual(loadWordbook(storage), [entry]);
});
