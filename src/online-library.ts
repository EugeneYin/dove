const STORAGE_KEY = "dove.onlineSources.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OnlineSource {
  id: string;
  name: string;
  url: string;
  owner: string;
  repo: string;
  ref: string | null;
  path: string;
}

export interface OnlineEntry {
  type: "dir" | "pdf";
  name: string;
  path: string;
  size: number;
  downloadUrl: string | null;
}

interface GitHubContent {
  type?: string;
  name?: string;
  path?: string;
  size?: number;
  download_url?: string | null;
}

interface UnghFile {
  path?: string;
  size?: number;
}

interface UnghIndex {
  ref: string;
  files: UnghFile[];
}

const rateLimitedSources = new Set<string>();
const unghIndexes = new Map<string, Promise<UnghIndex>>();

export function parseGitHubSource(input: string): OnlineSource {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("请输入 GitHub 仓库链接");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("GitHub 链接格式不正确");
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("只支持 github.com 的 HTTPS 链接");
  }

  let parts: string[];
  try {
    parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    throw new Error("GitHub 链接格式不正确");
  }
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/i, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw new Error("链接中缺少有效的仓库所有者或仓库名");
  }

  let ref: string | null = null;
  let path = "";
  if (parts.length > 2) {
    if (parts[2] !== "tree" || !parts[3]) {
      throw new Error("请使用仓库首页或仓库中的目录链接");
    }
    ref = parts[3];
    path = parts.slice(4).join("/");
  }

  const suffix = ref
    ? `/tree/${encodeURIComponent(ref)}${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}`
    : "";
  const normalizedUrl = `https://github.com/${owner}/${repo}${suffix}`;

  return {
    id: `${owner.toLowerCase()}/${repo.toLowerCase()}|${ref ?? ""}|${path}`,
    name: `${owner}/${repo}`,
    url: normalizedUrl,
    owner,
    repo,
    ref,
    path,
  };
}

export const DEFAULT_ONLINE_SOURCE = parseGitHubSource(
  "https://github.com/EugeneYin/awesome-english-ebooks",
);

export function loadAddedSources(storage: StorageLike): OnlineSource[] {
  let saved: unknown;
  try {
    saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];

  const sources: OnlineSource[] = [];
  const ids = new Set([DEFAULT_ONLINE_SOURCE.id]);
  for (const item of saved) {
    const input = typeof item === "string" ? item : (item as { url?: unknown })?.url;
    if (typeof input !== "string") continue;
    try {
      const source = parseGitHubSource(input);
      if (ids.has(source.id)) continue;
      ids.add(source.id);
      sources.push(source);
    } catch {
      // 单个旧条目损坏时忽略它，不影响其余已保存源。
    }
  }
  return sources;
}

export function saveAddedSources(storage: StorageLike, sources: OnlineSource[]): void {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify(sources.map((source) => ({ url: source.url }))),
  );
}

export function addSource(
  storage: StorageLike,
  current: OnlineSource[],
  input: string,
): OnlineSource[] {
  const source = parseGitHubSource(input);
  if ([DEFAULT_ONLINE_SOURCE, ...current].some((candidate) => candidate.id === source.id)) {
    throw new Error("这个源已经添加过了");
  }

  const next = [...current, source];
  saveAddedSources(storage, next);
  return next;
}

export function contentsApiUrl(source: OnlineSource, path = source.path): string {
  const encodedPath = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents${encodedPath}`,
  );
  if (source.ref) url.searchParams.set("ref", source.ref);
  return url.href;
}

function responseMessage(payload: unknown, status: number): string {
  return payload && typeof payload === "object" && "message" in payload
    ? String((payload as { message: unknown }).message)
    : `HTTP ${status}`;
}

function isRateLimitResponse(response: Response, message: string): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(message)))
  );
}

function unghRepoUrl(source: OnlineSource): string {
  return `https://ungh.cc/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
}

function unghTreeUrl(source: OnlineSource, ref: string): string {
  return `${unghRepoUrl(source)}/files/${encodeURIComponent(ref)}`;
}

function rawGitHubUrl(source: OnlineSource, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${[source.owner, source.repo, ref, ...path.split("/")]
    .map(encodeURIComponent)
    .join("/")}`;
}

async function loadUnghIndex(source: OnlineSource, fetcher: typeof fetch): Promise<UnghIndex> {
  const key = `${source.owner.toLowerCase()}/${source.repo.toLowerCase()}|${source.ref ?? ""}`;
  const cached = unghIndexes.get(key);
  if (cached) return cached;

  const request = (async () => {
    let ref = source.ref;
    if (!ref) {
      const response = await fetcher(unghRepoUrl(source));
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw new Error(responseMessage(payload, response.status));
      const defaultBranch =
        payload && typeof payload === "object" && "repo" in payload
          ? (payload as { repo?: { defaultBranch?: unknown } }).repo?.defaultBranch
          : null;
      if (typeof defaultBranch !== "string" || !defaultBranch) {
        throw new Error("备用目录服务没有返回默认分支");
      }
      ref = defaultBranch;
    }

    const response = await fetcher(unghTreeUrl(source, ref));
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) throw new Error(responseMessage(payload, response.status));
    const files =
      payload && typeof payload === "object" && "files" in payload
        ? (payload as { files?: unknown }).files
        : null;
    if (!Array.isArray(files)) throw new Error("备用目录服务返回了无效数据");
    return { ref, files: files as UnghFile[] };
  })();

  unghIndexes.set(key, request);
  try {
    return await request;
  } catch (error) {
    unghIndexes.delete(key);
    throw error;
  }
}

function sortOnlineEntries(entries: OnlineEntry[]): OnlineEntry[] {
  return entries.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
  );
}

async function fetchUnghDirectory(
  source: OnlineSource,
  path: string,
  fetcher: typeof fetch,
): Promise<OnlineEntry[]> {
  const index = await loadUnghIndex(source, fetcher);
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  const prefix = normalizedPath ? `${normalizedPath}/` : "";
  const entries = new Map<string, OnlineEntry>();

  for (const file of index.files) {
    if (typeof file.path !== "string" || !file.path.startsWith(prefix)) continue;
    const relative = file.path.slice(prefix.length);
    if (!relative) continue;
    const slash = relative.indexOf("/");
    if (slash >= 0) {
      const name = relative.slice(0, slash);
      if (name) {
        entries.set(`dir:${name}`, {
          type: "dir",
          name,
          path: `${prefix}${name}`,
          size: 0,
          downloadUrl: null,
        });
      }
      continue;
    }
    if (!/\.pdf$/i.test(relative)) continue;
    entries.set(`pdf:${relative}`, {
      type: "pdf",
      name: relative,
      path: file.path,
      size: typeof file.size === "number" ? file.size : 0,
      downloadUrl: rawGitHubUrl(source, index.ref, file.path),
    });
  }

  return sortOnlineEntries([...entries.values()]);
}

export async function fetchOnlineDirectory(
  source: OnlineSource,
  path = source.path,
  fetcher: typeof fetch = fetch,
): Promise<OnlineEntry[]> {
  if (rateLimitedSources.has(source.id)) {
    return fetchUnghDirectory(source, path, fetcher);
  }

  const response = await fetcher(contentsApiUrl(source, path), {
    headers: { accept: "application/vnd.github+json" },
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message = responseMessage(payload, response.status);
    if (isRateLimitResponse(response, message)) {
      rateLimitedSources.add(source.id);
      try {
        return await fetchUnghDirectory(source, path, fetcher);
      } catch (error) {
        throw new Error(`GitHub 访问频率受限，备用目录读取失败：${(error as Error).message}`);
      }
    }
    throw new Error(`GitHub 目录读取失败：${message}`);
  }
  if (!Array.isArray(payload)) throw new Error("该链接不是可浏览的 GitHub 目录");

  return sortOnlineEntries(
    payload
    .flatMap((item: GitHubContent): OnlineEntry[] => {
      if (!item.name || !item.path) return [];
      if (item.type === "dir") {
        return [{ type: "dir", name: item.name, path: item.path, size: 0, downloadUrl: null }];
      }
      if (item.type === "file" && /\.pdf$/i.test(item.name)) {
        return [
          {
            type: "pdf",
            name: item.name,
            path: item.path,
            size: item.size ?? 0,
            downloadUrl: item.download_url ?? null,
          },
        ];
      }
      return [];
    }),
  );
}

function stableLastModified(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function downloadOnlinePdf(
  source: OnlineSource,
  entry: OnlineEntry,
  fetcher: typeof fetch = fetch,
): Promise<File> {
  if (entry.type !== "pdf" || !entry.downloadUrl) throw new Error("这个 PDF 没有可用的下载地址");
  const response = await fetcher(entry.downloadUrl);
  if (!response.ok) throw new Error(`PDF 下载失败：HTTP ${response.status}`);
  return new File([await response.blob()], entry.name, {
    type: "application/pdf",
    lastModified: stableLastModified(`${source.id}|${entry.path}`),
  });
}

export function exportSources(sources: OnlineSource[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt,
      sources: sources.map(({ name, url }) => ({ name, url })),
    },
    null,
    2,
  );
}
