/**
 * 从屏幕坐标取出 PDF 文本层里的英文单词。
 *
 * PDF.js 会在 canvas 之上铺一层透明的 <span>，每个 span 是一段文本运行（通常一行）。
 * 因此取词可以直接借用浏览器的 caret 命中能力，无需自己处理字符坐标。
 */

export interface WordHit {
  /** 清理后的单词，可直接用于查词典 */
  word: string;
  /** 单词在页面上的位置，用于画高亮框 */
  rects: DOMRect[];
}

interface Caret {
  node: Text;
  offset: number;
}

/** caretPositionFromPoint 是标准 API，caretRangeFromPoint 是 WebKit/Blink 旧接口，都要兼容 */
function caretAt(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;

  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  return { node: node as Text, offset };
}

const segmenter = new Intl.Segmenter("en", { granularity: "word" });

/**
 * 归一化成可查词典的形式。
 * Intl.Segmenter 会把 "learner’s" 整体当作一个词，所有格尾巴必须去掉。
 */
export function normalizeWord(raw: string): string {
  return raw.replace(/[’']s$/i, "").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
}

/** 找到 offset 落在的那个词，返回它在文本里的起止位置 */
export function segmentAt(text: string, offset: number): { start: number; end: number } | null {
  for (const seg of segmenter.segment(text)) {
    if (!seg.isWordLike) continue;
    const start = seg.index;
    const end = start + seg.segment.length;
    // 落在词内，或紧贴词尾（长按词末尾字符时 caret 会停在 end）
    if (offset >= start && offset <= end) return { start, end };
  }
  return null;
}

/**
 * 判断命中词是否是被行尾连字符断开的上半截。
 * 只有连字符位于整段文本末尾才算，"well-known" 这类行内复合词不能拼接。
 */
export function endsLineWithHyphen(text: string, wordEnd: number): boolean {
  return /^-\s*$/.test(text.slice(wordEnd));
}

/** 在文本层里找下一个非空文本节点，用于拼接跨行连字符断词 */
function nextTextNode(node: Text, root: Element): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  walker.currentNode = node;
  let next = walker.nextNode();
  while (next) {
    if (next.textContent?.trim()) return next as Text;
    next = walker.nextNode();
  }
  return null;
}

export function wordAtPoint(x: number, y: number, root: Element): WordHit | null {
  const caret = caretAt(x, y);
  if (!caret) return null;

  const { node, offset } = caret;
  if (!root.contains(node)) return null;

  const text = node.textContent ?? "";
  const hit = segmentAt(text, offset);
  if (!hit) return null;

  let { start, end } = hit;
  let word = text.slice(start, end);

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);

  // 跨行连字符断词：本行以 "-" 结尾且命中词就在行末，拼上下一行的首词
  if (endsLineWithHyphen(text, end)) {
    const next = nextTextNode(node, root);
    const nextText = next?.textContent ?? "";
    const head = segmentAt(nextText, 0);
    if (next && head && head.start === 0) {
      word += nextText.slice(head.start, head.end);
      range.setEnd(next, head.end);
    }
  }

  const rects = Array.from(range.getClientRects());
  range.detach();

  const cleaned = normalizeWord(word);
  if (!cleaned) return null;

  return { word: cleaned, rects };
}
