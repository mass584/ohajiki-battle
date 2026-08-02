#!/usr/bin/env node
// PWA 用のアイコン PNG を生成する。
//
// 「外部画像を持たない」方針（AGENT.md）はホーム画面アイコンでも変えない。
// ただし manifest の icons と apple-touch-icon は PNG しか受け付けない環境が
// あるので、ファビコンと同じ紋章を**その場でラスタライズして**書き出す。
// 出来た PNG は成果物であって素材ではない。作り直したければこれを走らせる。
//
//   node scripts/icons.mjs
//
// 依存は入れない（AGENT.md「ビルドツールは入れない」）。PNG は zlib だけで
// 手書きする。アンチエイリアスは 4x4 のスーパーサンプリングで足りる。

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = join(ROOT, 'icons');

// ---- 紋章（index.html のファビコンと同じ図形・同じ色） ----
// 32x32 の座標系で書いてあるものを、出力サイズへ相似拡大する。
const BG = [0x0c, 0x12, 0x0e];   // 盤面外の暗い地
const BOARD = [0x23, 0x30, 0x20]; // 盤の面
const RIM = [0x8f, 0xae, 0x74];   // 外壁の環
const HOLE = [0x00, 0x00, 0x00];  // 中央の穴
const P1 = [0x4a, 0xa8, 0xff];    // 1P
const P2 = [0xff, 0x5c, 0x5c];    // 2P

const SS = 4; // スーパーサンプリング

// 円の内側なら 1。ring は幅 w の環。いずれも 32 系の座標で判定する。
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRing = (x, y, cx, cy, r, w) => {
  const d = Math.hypot(x - cx, y - cy);
  return d <= r + w / 2 && d >= r - w / 2;
};

// 角丸の四角（size=32, 半径 7）。maskable では使わない（全面を地色で塗る）
const inRoundRect = (x, y, s, r) => {
  if (x < 0 || y < 0 || x > s || y > s) return false;
  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

// 32 系の 1 点の色を返す。scale は紋章の縮小率（maskable の安全域用）
function sample(x, y, { rounded, scale }) {
  // 紋章を中心基準で縮める。地色は縮めない（背景は必ず全面）
  const ex = (x - 16) / scale + 16;
  const ey = (y - 16) / scale + 16;

  if (inCircle(ex, ey, 10.9, 10.9, 3.4)) return P1;
  if (inCircle(ex, ey, 21.1, 21.1, 3.4)) return P2;
  if (inCircle(ex, ey, 16, 16, 3.9)) return HOLE;
  if (inRing(ex, ey, 16, 16, 11.5, 2.4)) return RIM;
  if (inCircle(ex, ey, 16, 16, 11.5)) return BOARD;
  if (!rounded) return BG;
  return inRoundRect(x, y, 32, 7) ? BG : null; // null = 透明
}

// RGBA のピクセル配列を作る
function render(size, opts) {
  const px = Buffer.alloc(size * size * 4);
  const step = 32 / size;
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi + (sx + 0.5) / SS) * step;
          const y = (py + (sy + 0.5) / SS) * step;
          const c = sample(x, y, opts);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const o = (py * size + pxi) * 4;
      // 透明部分と混ざって暗くならないよう、色は不透明サンプルだけで平均する
      const opaque = a / 255 || 1;
      px[o] = Math.round(r / opaque);
      px[o + 1] = Math.round(g / opaque);
      px[o + 2] = Math.round(b / opaque);
      px[o + 3] = Math.round(a / n);
    }
  }
  return px;
}

// ---- PNG（8bit truecolor / truecolor+alpha, フィルタなし） ----
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba, { alpha }) {
  const ch = alpha ? 4 : 3;
  // 各スキャンラインの先頭にフィルタ種別 0 を置く
  const raw = Buffer.alloc(size * (1 + size * ch));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * ch);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = row + 1 + x * ch;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
      if (alpha) raw[d + 3] = rgba[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;                 // bit depth
  ihdr[9] = alpha ? 6 : 2;     // color type
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 書き出し ----
// maskable は円や角丸に切り抜かれる前提なので、地色を全面に敷き、
// 紋章を 75% に縮めて安全域（中央 80% の円の内側）へ収める。
// 512px なら紋章の直径は 305px で、安全域の 410px に収まる。
// apple-touch-icon は iOS 側が角を丸めるので、こちらは角丸も透明も持たせない
// （透過を含む PNG を渡すと黒く合成される端末があるため alpha 無しで書く）。
const JOBS = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1, alpha: true },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1, alpha: true },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.75, alpha: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 1, alpha: false },
];

mkdirSync(OUTDIR, { recursive: true });
for (const j of JOBS) {
  const buf = png(j.size, render(j.size, { rounded: j.rounded, scale: j.scale }), { alpha: j.alpha });
  writeFileSync(join(OUTDIR, j.file), buf);
  console.log(`[icons] icons/${j.file} (${j.size}px, ${(buf.length / 1024).toFixed(1)} KB)`);
}
