/**
 * 离线词典。词表由 scripts/build-dict.mjs 从 ECDICT 裁剪生成。
 *
 * 数据被压成数组以减小体积：[音标, 中文释义, 英文释义]
 */

export type Row = [phonetic: string, translation: string, definition: string];

export interface DictFile {
  /** 单词 → 释义 */
  w: Record<string, Row>;
  /** 变形 → 原型，用于 running → run */
  l: Record<string, string>;
}

export interface Entry {
  /** 实际查到的词条（可能是原型） */
  word: string;
  phonetic: string;
  translation: string;
  definition: string;
  /** 查询词与词条不同时，说明做了词形还原 */
  lemmaOf?: string;
}

let data: DictFile | null = null;
let loading: Promise<void> | null = null;

async function fetchDict(): Promise<DictFile> {
  const res = await fetch("/dict.json.gz");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  // 词典文件是预压缩的，但部分服务器（含 Vite）会给 .gz 加上 Content-Encoding: gzip，
  // 浏览器便已透明解压。靠 gzip 魔数判断，两种情况都能正确处理。
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzipped) return JSON.parse(new TextDecoder().decode(bytes)) as DictFile;

  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json() as Promise<DictFile>;
}

export function loadDict(): Promise<void> {
  loading ??= fetchDict().then((d) => {
    data = d;
  });
  return loading;
}

function toEntry(key: string, row: Row, queried: string): Entry {
  const [phonetic, translation, definition] = row;
  return {
    word: key,
    phonetic,
    translation,
    definition,
    lemmaOf: key === queried ? undefined : queried,
  };
}

/** 词表含 constructor / toString 等键，必须用 hasOwn，否则会命中 Object.prototype */
function own<T>(obj: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

export function lookupIn(dict: DictFile, word: string): Entry | null {
  const q = word.toLowerCase();

  const direct = own(dict.w, q);
  if (direct) return toEntry(q, direct, q);

  // 词形还原：running → run、understood → understand
  const base = own(dict.l, q);
  const viaLemma = base ? own(dict.w, base) : undefined;
  if (base && viaLemma) return toEntry(base, viaLemma, q);

  return null;
}

export function lookup(word: string): Entry | null {
  return data ? lookupIn(data, word) : null;
}
