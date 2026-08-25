const ENDPOINT = "https://freedictionaryapi.com/api/v1/entries/en";

interface RawSense {
  examples?: unknown;
  subsenses?: unknown;
}

interface RawEntry {
  senses?: unknown;
}

export interface OnlineExamples {
  sentences: string[];
  sourceUrl: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function collectSenseExamples(value: unknown, found: string[]) {
  if (!isObject(value)) return;
  const sense = value as RawSense;
  if (Array.isArray(sense.examples)) {
    for (const example of sense.examples) {
      if (typeof example !== "string") continue;
      const sentence = example.trim();
      if (sentence && !found.includes(sentence)) found.push(sentence);
      if (found.length === 2) return;
    }
  }
  if (!Array.isArray(sense.subsenses)) return;
  for (const subsense of sense.subsenses) {
    collectSenseExamples(subsense, found);
    if (found.length === 2) return;
  }
}

/** 从 FreeDictionaryAPI 响应中按词义顺序取最多两条例句。 */
export function parseOnlineExamples(value: unknown): OnlineExamples {
  if (!isObject(value)) return { sentences: [], sourceUrl: null };

  const found: string[] = [];
  if (Array.isArray(value.entries)) {
    for (const candidate of value.entries) {
      if (!isObject(candidate)) continue;
      const entry = candidate as RawEntry;
      if (!Array.isArray(entry.senses)) continue;
      for (const sense of entry.senses) {
        collectSenseExamples(sense, found);
        if (found.length === 2) break;
      }
      if (found.length === 2) break;
    }
  }

  const source = isObject(value.source) ? value.source.url : null;
  const sourceUrl =
    typeof source === "string" && source.startsWith("https://en.wiktionary.org/") ? source : null;
  return { sentences: found, sourceUrl };
}

export async function fetchOnlineExamples(
  word: string,
  signal?: AbortSignal,
): Promise<OnlineExamples> {
  const response = await fetch(`${ENDPOINT}/${encodeURIComponent(word)}`, { signal });
  if (response.status === 404) return { sentences: [], sourceUrl: null };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseOnlineExamples(await response.json());
}
