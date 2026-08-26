import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ONLINE_SOURCE,
  addSource,
  contentsApiUrl,
  exportSources,
  fetchOnlineDirectory,
  loadAddedSources,
  parseGitHubSource,
  type StorageLike,
} from "./online-library.ts";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("在线文档源", () => {
  it("解析仓库首页与 tree 目录链接", () => {
    assert.deepEqual(parseGitHubSource("github.com/example/books"), {
      id: "example/books||",
      name: "example/books",
      url: "https://github.com/example/books",
      owner: "example",
      repo: "books",
      ref: null,
      path: "",
    });

    const nested = parseGitHubSource("https://github.com/example/books/tree/main/PDF Files/2026");
    assert.equal(nested.ref, "main");
    assert.equal(nested.path, "PDF Files/2026");
    assert.equal(
      nested.url,
      "https://github.com/example/books/tree/main/PDF%20Files/2026",
    );
    assert.equal(
      contentsApiUrl(nested),
      "https://api.github.com/repos/example/books/contents/PDF%20Files/2026?ref=main",
    );
  });

  it("拒绝非 GitHub 链接和文件链接", () => {
    assert.throws(() => parseGitHubSource("https://example.com/books"), /只支持 github.com/);
    assert.throws(
      () => parseGitHubSource("https://github.com/example/books/blob/main/book.pdf"),
      /仓库首页或仓库中的目录链接/,
    );
  });

  it("保存新增源并忽略默认源和重复条目", () => {
    const storage = new MemoryStorage();
    const added = addSource(storage, [], "https://github.com/example/books");
    assert.equal(added.length, 1);
    assert.deepEqual(loadAddedSources(storage), added);
    assert.throws(
      () => addSource(storage, added, "https://github.com/EXAMPLE/books"),
      /已经添加/,
    );
    assert.throws(
      () => addSource(storage, added, DEFAULT_ONLINE_SOURCE.url),
      /已经添加/,
    );
  });

  it("目录接口只返回目录和 PDF，并把目录排在前面", async () => {
    let requested = "";
    const fetcher = (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(
        JSON.stringify([
          { type: "file", name: "README.md", path: "README.md", size: 12 },
          {
            type: "file",
            name: "Issue.PDF",
            path: "2026/Issue.PDF",
            size: 42,
            download_url: "https://raw.githubusercontent.com/example/books/main/Issue.PDF",
          },
          { type: "dir", name: "2026", path: "2026" },
          { type: "file", name: "Issue.epub", path: "2026/Issue.epub", size: 24 },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const source = parseGitHubSource("https://github.com/example/books");
    const entries = await fetchOnlineDirectory(source, "", fetcher);
    assert.equal(requested, "https://api.github.com/repos/example/books/contents");
    assert.deepEqual(
      entries.map(({ type, name }) => ({ type, name })),
      [
        { type: "dir", name: "2026" },
        { type: "pdf", name: "Issue.PDF" },
      ],
    );
  });

  it("导出包含默认源和用户源的可读 JSON", () => {
    const source = parseGitHubSource("https://github.com/example/books");
    const exported = JSON.parse(
      exportSources([DEFAULT_ONLINE_SOURCE, source], "2026-08-26T00:00:00.000Z"),
    );
    assert.equal(exported.schemaVersion, 1);
    assert.equal(exported.exportedAt, "2026-08-26T00:00:00.000Z");
    assert.deepEqual(
      exported.sources.map((item: { url: string }) => item.url),
      [DEFAULT_ONLINE_SOURCE.url, source.url],
    );
  });
});
