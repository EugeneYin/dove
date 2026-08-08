/**
 * 从 ECDICT 生成裁剪版离线词典 public/dict.json。
 *
 * 收词标准：有词频排名（BNC 或 COCA）、或属柯林斯/牛津核心、或带考试标签。
 * ECDICT 的词频排名天然止于约 5.7 万词，这个集合正好覆盖阅读场景。
 *
 * 用法: node scripts/build-dict.mjs
 */
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { Readable } from "node:stream";

const CACHE = ".cache";
const SOURCES = {
  "ecdict.csv": "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
  "lemma.en.txt": "https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt",
};

async function ensureSources() {
  await mkdir(CACHE, { recursive: true });
  for (const [name, url] of Object.entries(SOURCES)) {
    const path = `${CACHE}/${name}`;
    if (existsSync(path)) continue;
    process.stdout.write(`下载 ${name} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 ${name}: HTTP ${res.status}`);
    await writeFile(path, Readable.fromWeb(res.body));
    console.log(" 完成");
  }
}

/** ECDICT 的 CSV 字段可能被引号包裹并含逗号；换行已转义为字面 \n */
function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') (cur += '"'), i++;
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") (out.push(cur), (cur = ""));
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** 去掉 ECDICT 释义里的 [网络] 等噪声行，并把转义换行还原 */
function cleanTranslation(raw) {
  return raw
    .split("\\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("[网络]"))
    .join("\n");
}

async function* rows(path) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let seenHeader = false;
  for await (const line of rl) {
    if (!seenHeader) (seenHeader = true), void 0;
    else if (line.trim()) yield parseLine(line);
  }
}

async function buildWords() {
  // 必须用 Map：词表含 constructor / toString 等键，普通对象会命中 Object.prototype
  const words = new Map();
  for await (const f of rows(`${CACHE}/ecdict.csv`)) {
    const [word, phonetic, definition, translation, , collins, oxford, tag, bnc, frq] = f;
    if (!/^[a-zA-Z][a-zA-Z'-]*$/.test(word)) continue;

    const ranked = +bnc > 0 || +frq > 0;
    if (!ranked && !+collins && !+oxford && !tag.trim()) continue;

    const zh = cleanTranslation(translation);
    if (!zh) continue;

    const key = word.toLowerCase();
    // 同一小写形式可能出现多次（如 China / china），保留信息更全的
    const row = [phonetic.trim(), zh, cleanTranslation(definition)];
    const prev = words.get(key);
    if (!prev || row.join().length > prev.join().length) words.set(key, row);
  }
  return words;
}

async function buildLemmas(words, path) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const lemmas = new Map();
  for await (const line of rl) {
    if (line.startsWith(";") || !line.includes("->")) continue;
    const [left, right] = line.split("->");
    const base = left.split("/")[0].trim().toLowerCase();
    if (!words.has(base)) continue;
    for (const form of right.split(",")) {
      const f = form.trim().toLowerCase();
      // 本身能直接查到的变形不必收，直接命中即可
      if (!f || f === base || words.has(f)) continue;
      lemmas.set(f, base);
    }
  }
  return lemmas;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

await ensureSources();
console.log("解析词条 ...");
const w = await buildWords();
console.log("构建词形还原表 ...");
const l = await buildLemmas(w, `${CACHE}/lemma.en.txt`);

const json = JSON.stringify({ w: Object.fromEntries(w), l: Object.fromEntries(l) });
await mkdir("public", { recursive: true });
// 预压缩：由客户端 DecompressionStream 解压，不依赖服务器是否开启 gzip
await writeFile("public/dict.json.gz", gzipSync(json, { level: 9 }));

console.log(`
收词           ${w.size} 条
变形映射       ${l.size} 条
原始           ${kb(json.length)}
dict.json.gz   ${kb((await stat("public/dict.json.gz")).size)}`);
