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
