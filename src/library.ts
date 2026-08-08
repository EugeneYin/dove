/**
 * 最近文档：把打开过的 PDF 连同读到的页码存在本地。
 *
 * 装成 App 之后这一层是必需的，不是锦上添花：主屏图标点开就是个空页面，
 * 每次都要重新去文件管理器里翻同一本书；而离线时（飞机上、地铁里）
 * 文件选择器能不能取到云端文件本身就没有保证。
 *
 * 存的是 File 对象本身——IndexedDB 可以直接结构化克隆它，不必转成 base64。
 */

const DB_NAME = "dove";
const STORE = "docs";

/** 最多保留几本 */
const KEEP = 10;
/** 以及最多占多少字节。教材扫描件动辄几十 MB，只按本数限制会把配额吃光，
 *  连带把 Service Worker 的离线缓存一起挤掉。 */
const MAX_BYTES = 400 * 1024 * 1024;

export interface DocRecord {
  id: string;
  name: string;
  size: number;
  file: File;
  /** 上次读到的页码 */
  page: number;
  openedAt: number;
}

/** 同一个文件重新选一次也该认得出来，故用「文件名 + 大小 + 修改时间」而非内容 hash——
 *  几十 MB 的文件算一次 hash 要好几秒，而这三项撞车的概率可以忽略。 */
function idOf(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("无法打开本地数据库"));
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("数据库操作失败"));
  });
}

async function docs(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(STORE, mode).objectStore(STORE);
}

/**
 * 本地存储在隐私模式等环境下可能整个不可用。那是个真实且常见的情况，
 * 但它不该连累查词——降级成「这次不记录」即可。
 */
async function tolerate<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (e) {
    console.warn("最近文档不可用：", e);
    return fallback;
  }
}

/** 按最近打开排序 */
export function recentDocs(): Promise<DocRecord[]> {
  return tolerate(async () => {
    const all = await promisify((await docs("readonly")).getAll() as IDBRequest<DocRecord[]>);
    return all.sort((a, b) => b.openedAt - a.openedAt);
  }, []);
}

export function getDoc(id: string): Promise<DocRecord | undefined> {
  return tolerate(
    async () => promisify((await docs("readonly")).get(id) as IDBRequest<DocRecord | undefined>),
    undefined,
  );
}

export function forgetDoc(id: string): Promise<void> {
  return tolerate(async () => {
    await promisify((await docs("readwrite")).delete(id));
  }, undefined);
}

/**
 * 记下这个文件，返回它的 id 与上次读到的页码。
 * 同一本书再次打开时保留原来的页码，不会退回第 1 页。
 */
export function rememberDoc(file: File): Promise<{ id: string; page: number }> {
  const id = idOf(file);
  return tolerate(async () => {
    void requestPersistence();

    const previous = await getDoc(id);
    const page = previous?.page ?? 1;
    const record: DocRecord = { id, name: file.name, size: file.size, file, page, openedAt: Date.now() };

    await promisify((await docs("readwrite")).put(record));
    await evict();
    return { id, page };
  }, { id, page: 1 });
}

export function rememberPage(id: string, page: number): Promise<void> {
  return tolerate(async () => {
    const record = await getDoc(id);
    if (!record || record.page === page) return;
    record.page = page;
    await promisify((await docs("readwrite")).put(record));
  }, undefined);
}

/** 超出本数或总体积上限时，从最久没打开的开始删 */
async function evict() {
  const all = await recentDocs();
  let bytes = 0;
  const doomed: string[] = [];

  all.forEach((record, index) => {
    bytes += record.size;
    if (index >= KEEP || bytes > MAX_BYTES) doomed.push(record.id);
  });
  if (!doomed.length) return;

  const store = await docs("readwrite");
  for (const id of doomed) store.delete(id);
}

/**
 * 默认存储是「尽力而为」的，系统紧张时会连同 Service Worker 的离线缓存一起清掉，
 * 那正好是离线可用这件事最不能丢的部分。装成 App 或常用之后浏览器通常会直接批准。
 */
async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // 不支持就算了，只是少一层保障
  }
}
