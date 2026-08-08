// 生成 PWA 图标。装到主屏后图标就是这个应用的全部门面，必须自带、不能靠 emoji：
// emoji 字形随系统而变，且 maskable 图标要求背景铺满、主体留在安全区内。
//
// 用 Path2D 接收 SVG 路径，输出与平台无关且可复现——不依赖任何字体。
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BG = "#26364d";
const FG = "#ffffff";

// 100×100 坐标系里的飞鸽。用几何体拼装而不是一整条手绘曲线：
// 单条曲线在小尺寸下喙和翅膀会糊成一团，分件拼装每部分的轮廓都立得住。
// 尾巴的起点要伸进身体椭圆里，否则会是一块飘着的三角
const TAIL = "M 40 60 L 2 46 L 7 71 Z";
const WING = `
  M 46 46
  C 41 33 44 16 56 4
  C 54 22 58 36 68 44
  C 61 49 52 50 46 46
  Z
`;
const BEAK = "M 84 30 L 99 36 L 84 43 Z";

/** @param {import("@napi-rs/canvas").SKRSContext2D} ctx */
function drawDove(ctx, size, inset) {
  const scale = (size * (1 - inset * 2)) / 100;
  ctx.save();
  ctx.translate(size * inset, size * inset);
  ctx.scale(scale, scale);
  ctx.lineJoin = "round";

  ctx.fillStyle = FG;
  ctx.fill(new Path2D(TAIL));
  ctx.fill(new Path2D(BEAK));

  // 身体：略微上仰的椭圆，接上头部的圆
  ctx.beginPath();
  ctx.ellipse(50, 52, 30, 15, (-14 * Math.PI) / 180, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(76, 36, 12, 0, Math.PI * 2);
  ctx.fill();

  // 翅膀压在身体上，先用背景色描粗一圈留出缺口，否则两块白融成一片
  const wing = new Path2D(WING);
  ctx.strokeStyle = BG;
  ctx.lineWidth = 5;
  ctx.stroke(wing);
  ctx.fillStyle = FG;
  ctx.fill(wing);

  // 眼睛留背景色，小尺寸下是「这是只鸟」最强的提示
  ctx.fillStyle = BG;
  ctx.beginPath();
  ctx.arc(80, 33, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * @param size    输出边长
 * @param radius  背景圆角占边长的比例，maskable 用 0（系统自己裁形状）
 * @param inset   鸽子四周留白占边长的比例
 */
function icon(size, radius, inset) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  const r = size * radius;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  ctx.fill();

  drawDove(ctx, size, inset);
  return canvas.encode("png");
}

// maskable 图标会被系统裁成圆形等形状，主体必须落在中间 80% 的安全区内，
// 故留白比普通图标大得多。
const ICONS = [
  ["icon-192.png", 192, 0.22, 0.14],
  ["icon-512.png", 512, 0.22, 0.14],
  ["icon-maskable-512.png", 512, 0, 0.26],
  ["apple-touch-icon.png", 180, 0, 0.14],
];

const outDir = join("public", "icons");
await mkdir(outDir, { recursive: true });
for (const [name, size, radius, inset] of ICONS) {
  await writeFile(join(outDir, name), await icon(size, radius, inset));
}
console.log(`已生成 ${ICONS.length} 个图标`);
