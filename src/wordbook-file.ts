import {
  parseWordbookFile,
  serializeWordbookFile,
  type WordbookEntry,
  type WordbookStorage,
} from "./wordbook";

const FILE_NAME = "dove-wordbook.json";
const DOWNLOAD_MODE_KEY = "dove.wordbook.file.download";
const HANDLE_DB = "dove-wordbook";
const HANDLE_STORE = "settings";
const HANDLE_KEY = "file";

interface MarkerStorage extends WordbookStorage {
  removeItem?(key: string): void;
}

interface WritableFile {
  write(contents: string): Promise<void>;
  close(): Promise<void>;
}

interface WordbookFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFile>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}

interface SavePickerOptions {
  suggestedName: string;
  startIn?: "documents" | "downloads";
  excludeAcceptAllOption: boolean;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}

type SavePicker = (options: SavePickerOptions) => Promise<WordbookFileHandle>;

let activeHandle: WordbookFileHandle | null = null;
let downloadMode = false;

function savePicker(): SavePicker | undefined {
  return (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
}

export function supportsWordbookFilePicker(): boolean {
  return Boolean(savePicker());
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开单词本文件设置"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法读取单词本文件设置"));
  });
}

async function loadStoredHandle(): Promise<WordbookFileHandle | null> {
  try {
    const db = await openHandleDb();
    try {
      const store = db.transaction(HANDLE_STORE, "readonly").objectStore(HANDLE_STORE);
      return (await requestResult(store.get(HANDLE_KEY))) as WordbookFileHandle | null;
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn("无法恢复单词本文件：", error);
    return null;
  }
}

async function storeHandle(handle: WordbookFileHandle): Promise<void> {
  try {
    const db = await openHandleDb();
    try {
      const store = db.transaction(HANDLE_STORE, "readwrite").objectStore(HANDLE_STORE);
      await requestResult(store.put(handle, HANDLE_KEY));
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn("无法记住单词本文件：", error);
  }
}

async function readEntries(handle: WordbookFileHandle, fallback: WordbookEntry[]) {
  const file = await handle.getFile();
  if (file.size === 0) return fallback;
  const entries = parseWordbookFile(await file.text());
  if (!entries) throw new Error("选择的文件不是有效的 Dove 单词本 JSON 文件");
  return entries;
}

async function writeEntries(handle: WordbookFileHandle, entries: WordbookEntry[]) {
  const writable = await handle.createWritable();
  await writable.write(serializeWordbookFile(entries));
  await writable.close();
}

function downloadEntries(entries: WordbookEntry[]) {
  const url = URL.createObjectURL(
    new Blob([serializeWordbookFile(entries)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = FILE_NAME;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function restoreWordbookFile(
  fallback: WordbookEntry[],
  storage: MarkerStorage,
): Promise<WordbookEntry[] | null> {
  if (storage.getItem(DOWNLOAD_MODE_KEY) === "1") {
    downloadMode = true;
    return fallback;
  }

  const handle = await loadStoredHandle();
  if (!handle) return null;
  const permission = await handle.queryPermission?.({ mode: "readwrite" });
  if (permission && permission !== "granted") return null;

  const entries = await readEntries(handle, fallback);
  activeHandle = handle;
  return entries;
}

async function pickFile(picker: SavePicker): Promise<WordbookFileHandle> {
  const base = {
    suggestedName: FILE_NAME,
    excludeAcceptAllOption: true,
    types: [{ description: "Dove 单词本", accept: { "application/json": [".json"] } }],
  };

  try {
    return await picker({ ...base, startIn: "documents" });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return picker({ ...base, startIn: "downloads" });
}

export async function chooseWordbookFile(
  current: WordbookEntry[],
  storage: MarkerStorage,
): Promise<WordbookEntry[]> {
  const picker = savePicker();
  if (!picker) {
    downloadEntries(current);
    downloadMode = true;
    try {
      storage.setItem(DOWNLOAD_MODE_KEY, "1");
    } catch {
      // 下载已成功触发；隐私模式不允许记录降级方式时，下次再提示即可。
    }
    return current;
  }

  const handle = await pickFile(picker);
  const entries = await readEntries(handle, current);
  await writeEntries(handle, entries);
  activeHandle = handle;
  downloadMode = false;
  try {
    storage.removeItem?.(DOWNLOAD_MODE_KEY);
  } catch {
    // 不影响已经选好的文件。
  }
  await storeHandle(handle);
  return entries;
}

export async function saveWordbookFile(entries: WordbookEntry[]): Promise<void> {
  if (activeHandle) {
    await writeEntries(activeHandle, entries);
    return;
  }
  if (downloadMode) {
    downloadEntries(entries);
    return;
  }
  throw new Error("尚未指定单词本文件");
}
