export interface WordbookEntry {
  id: string;
  word: string;
  phonetic: string;
  meaning: string;
  createdAt: number;
}

export interface WordbookStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WORDBOOK_STORAGE_KEY = "dove.wordbook.v1";

export function singleLineMeaning(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("；");
}

export function loadWordbook(storage: WordbookStorage): WordbookEntry[] {
  try {
    const parsed = JSON.parse(storage.getItem(WORDBOOK_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

export function saveWordbook(storage: WordbookStorage, entries: WordbookEntry[]): void {
  storage.setItem(WORDBOOK_STORAGE_KEY, JSON.stringify(entries));
}

export function serializeWordbookFile(entries: WordbookEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/** 文件是用户可编辑的数据源；只要有一个损坏词条就拒绝整份文件，避免静默丢数据。 */
export function parseWordbookFile(value: string): WordbookEntry[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every(isEntry) ? parsed : null;
  } catch {
    return null;
  }
}

const comparableWord = (word: string) => word.trim().toLowerCase();

export function findWordbookEntry(
  entries: WordbookEntry[],
  word: string,
): WordbookEntry | undefined {
  const target = comparableWord(word);
  return entries.find((entry) => comparableWord(entry.word) === target);
}

export function removeWordbookWord(entries: WordbookEntry[], word: string): WordbookEntry[] {
  const target = comparableWord(word);
  return entries.filter((entry) => comparableWord(entry.word) !== target);
}

function isEntry(value: unknown): value is WordbookEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.word === "string" &&
    typeof entry.phonetic === "string" &&
    typeof entry.meaning === "string" &&
    typeof entry.createdAt === "number"
  );
}
