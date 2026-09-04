/**
 * 桌宠素材处理流水线（多帧版）：
 * 状态子目录（idle/thinking/working/attention/happy/sleep，每帧 01.jpg…）→
 * 白底去背（边缘泛洪）→ 全状态帧**联合包围盒**统一裁剪（保证帧间稳定不跳）→
 * 缩放到底对齐 128×128 画布 → resources/pet/frames/<theme>/<state>-<NN>.png
 *
 * Usage: node tools/pet-assets/build.mjs [theme=black-heels]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(THIS_DIR, '..', '..');
const THEME = process.argv[2] || 'black-heels';

function loadSharp() {
  const store = path.join(ROOT, 'node_modules', '.pnpm');
  const dir = fs.readdirSync(store).find((d) => d.startsWith('sharp@'));
  if (!dir) throw new Error('.pnpm store 里找不到 sharp，先 pnpm install');
  return createRequire(path.join(store, dir, 'node_modules', 'sharp', 'package.json'))('sharp');
}
const sharp = loadSharp();

const SRC_ROOT = path.join(THIS_DIR, 'src', THEME);
const OUT = path.resolve(THIS_DIR, '..', '..', 'apps', 'desktop', 'resources', 'pet', 'frames', THEME);

const CANVAS = 128;
const WHITE_LUMA = 235;
const WHITE_SPREAD = 18;
const STATES = ['idle', 'thinking', 'working', 'attention', 'happy', 'sleep'];

function isBackgroundish(r, g, b) {
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return r >= WHITE_LUMA && g >= WHITE_LUMA && b >= WHITE_LUMA && spread <= WHITE_SPREAD;
}

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

function contentBounds(data, width, height) {
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX: Math.max(maxX, minX), maxY: Math.max(maxY, minY) };
}

// ── 主流程：读全部帧 → 去背 → 联合包围盒 → 统一缩放落画布 ──
const frames = [];
for (const state of STATES) {
  const dir = path.join(SRC_ROOT, state);
  if (!fs.existsSync(dir)) { console.log(`SKIP 状态 ${state}（无目录）`); continue; }
  const files = fs.readdirSync(dir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
  for (const file of files) {
    const { data, info } = await sharp(path.join(dir, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    floodFillTransparent(data, info.width, info.height);
    frames.push({ state, file, data, width: info.width, height: info.height });
  }
}
if (frames.length === 0) { console.log('没有找到帧'); process.exit(1); }

// 联合包围盒（所有帧内容并集，帧间零跳动）
let uMinX = Infinity, uMinY = Infinity, uMaxX = 0, uMaxY = 0;
for (const fr of frames) {
  const b = contentBounds(fr.data, fr.width, fr.height);
  uMinX = Math.min(uMinX, b.minX);
  uMinY = Math.min(uMinY, b.minY);
  uMaxX = Math.max(uMaxX, b.maxX);
  uMaxY = Math.max(uMaxY, b.maxY);
}
const uW = uMaxX - uMinX + 1;
const uH = uMaxY - uMinY + 1;
const scale = Math.min((CANVAS - 8) / uW, (CANVAS - 8) / uH);
const targetW = Math.round(uW * scale);
const targetH = Math.round(uH * scale);
console.log(`联合包围盒 ${uW}x${uH} → ${targetW}x${targetH}（${frames.length} 帧）`);

fs.mkdirSync(OUT, { recursive: true });
for (const fr of frames) {
  const resized = await sharp(fr.data, { raw: { width: fr.width, height: fr.height, channels: 4 } })
    .extract({ left: uMinX, top: uMinY, width: uW, height: uH })
    .resize(targetW, targetH, { kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const canvas = Buffer.alloc(CANVAS * CANVAS * 4, 0);
  const offsetX = Math.floor((CANVAS - targetW) / 2);
  const offsetY = CANVAS - targetH;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcO = (y * targetW + x) * 4;
      const dstO = ((offsetY + y) * CANVAS + (offsetX + x)) * 4;
      canvas[dstO] = resized[srcO];
      canvas[dstO + 1] = resized[srcO + 1];
      canvas[dstO + 2] = resized[srcO + 2];
      canvas[dstO + 3] = resized[srcO + 3];
    }
  }
  const nn = path.basename(fr.file, path.extname(fr.file)).padStart(2, '0');
  await sharp(canvas, { raw: { width: CANVAS, height: CANVAS, channels: 4 } }).png().toFile(path.join(OUT, `${fr.state}-${nn}.png`));
}
console.log(`完成：${frames.length} 帧 → ${OUT}`);
