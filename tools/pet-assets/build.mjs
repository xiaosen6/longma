/**
 * 桌宠素材处理流水线：白底去背（边缘泛洪，不伤角色内部白色）→ 内容裁剪 →
 * 统一缩放到 128×128 画布、底部对齐 → 输出透明 PNG 到 renderer assets。
 *
 * Usage: node tools/pet-assets/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(THIS_DIR, '..', '..');
// sharp 是 apps/desktop 的依赖，pnpm 隔离在 .pnpm store——按目录名探测定位
function loadSharp() {
  const store = path.join(ROOT, 'node_modules', '.pnpm');
  const dir = fs.readdirSync(store).find((d) => d.startsWith('sharp@'));
  if (!dir) throw new Error('.pnpm store 里找不到 sharp，先 pnpm install');
  return createRequire(path.join(store, dir, 'node_modules', 'sharp', 'package.json'))('sharp');
}
const sharp = loadSharp();

const SRC = path.join(THIS_DIR, 'src');
const OUT = path.resolve(THIS_DIR, '..', '..', 'apps', 'desktop', 'src', 'renderer', 'src', 'assets', 'pet');

const CANVAS = 128;
// 近白判定：三通道都 ≥ 阈值且最大最小差小（低饱和），jpg 噪点容忍
const WHITE_LUMA = 235;
const WHITE_SPREAD = 18;

const STATES = [
  { in: 'idle.jpg', out: 'idle.png' },
  { in: 'working.jpg', out: 'working.png' },
  { in: 'attention.jpg', out: 'attention.png' },
  { in: 'happy.jpg', out: 'happy.png' },
  { in: 'sleep.jpg', out: 'sleep.png' },
  { in: 'sleep-b.jpg', out: 'sleep-b.png' },
];

function isBackgroundish(r, g, b) {
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return r >= WHITE_LUMA && g >= WHITE_LUMA && b >= WHITE_LUMA && spread <= WHITE_SPREAD;
}

/** 从图像四边 BFS 泛洪，把与边缘连通的近白像素置透明（角色内部的白色不受影响）。 */
function floodFillTransparent(data, width, height) {
  const queue = [];
  const visited = new Uint8Array(width * height);
  const push = (x, y) => {
    const idx = y * width + x;
    if (visited[idx]) return;
    const o = idx * 4;
    if (!isBackgroundish(data[o], data[o + 1], data[o + 2])) return;
    visited[idx] = 1;
    data[o + 3] = 0;
    queue.push(idx);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (queue.length) {
    const idx = queue.pop();
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return data;
}

async function processOne(entry) {
  const src = path.join(SRC, entry.in);
  if (!fs.existsSync(src)) {
    console.log(`SKIP ${entry.in}（不存在）`);
    return;
  }
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  floodFillTransparent(data, info.width, info.height);
  // 裁剪到不透明内容的包围盒
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  // 缩放到画布内（保持比例），底部对齐
  const scale = Math.min((CANVAS - 8) / cropW, (CANVAS - 8) / cropH);
  const targetW = Math.max(1, Math.round(cropW * scale));
  const targetH = Math.max(1, Math.round(cropH * scale));
  const resized = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: minX, top: minY, width: cropW, height: cropH })
    .resize(targetW, targetH, { kernel: 'nearest' })
    .png()
    .toBuffer();
  const { data: resizedRaw } = await sharp(resized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const canvas = Buffer.alloc(CANVAS * CANVAS * 4, 0);
  const offsetX = Math.floor((CANVAS - targetW) / 2);
  const offsetY = CANVAS - targetH; // 底部对齐：状态切换不跳动
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcO = (y * targetW + x) * 4;
      const dstO = ((offsetY + y) * CANVAS + (offsetX + x)) * 4;
      canvas[dstO] = resizedRaw[srcO];
      canvas[dstO + 1] = resizedRaw[srcO + 1];
      canvas[dstO + 2] = resizedRaw[srcO + 2];
      canvas[dstO + 3] = resizedRaw[srcO + 3];
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  await sharp(canvas, { raw: { width: CANVAS, height: CANVAS, channels: 4 } }).png().toFile(path.join(OUT, entry.out));
  console.log(`OK ${entry.out}（${cropW}x${cropH} → ${targetW}x${targetH}，底对齐）`);
}

for (const entry of STATES) await processOne(entry);
console.log('全部完成 →', OUT);
