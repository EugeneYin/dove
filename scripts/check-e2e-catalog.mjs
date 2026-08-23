import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile("e2e/test-cases.json", "utf8"));
const source = await readFile(catalog.suite.testFile, "utf8");

const catalogIds = catalog.suite.cases.map((testCase) => testCase.id);
const sourceIds = [...source.matchAll(/test\.step\(["'`](PWA-\d{3})\b/g)].map(
  (match) => match[1],
);

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

const problems = [];
const duplicateCatalogIds = duplicates(catalogIds);
const duplicateSourceIds = duplicates(sourceIds);
if (duplicateCatalogIds.length) problems.push(`目录中存在重复编号: ${duplicateCatalogIds.join(", ")}`);
if (duplicateSourceIds.length) problems.push(`测试中存在重复编号: ${duplicateSourceIds.join(", ")}`);

const missingInSource = catalogIds.filter((id) => !sourceIds.includes(id));
const missingInCatalog = sourceIds.filter((id) => !catalogIds.includes(id));
if (missingInSource.length) problems.push(`目录有登记但测试未实现: ${missingInSource.join(", ")}`);
if (missingInCatalog.length) problems.push(`测试已实现但目录未登记: ${missingInCatalog.join(", ")}`);

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log(
  `E2E 用例目录有效：${catalog.suite.id} · 基线 v${catalog.baselineAppVersion} · ${catalogIds.length} 个用例`,
);
