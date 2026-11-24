// 生成 tabBar 图标：81×81 双态 PNG（默认 #999999 / 选中 #2F5496），纯 Node（zlib）无第三方依赖。
// 背景：v1 遗留的 6 个图标 png 均为 0 字节空文件；S2 tabBar 改 3 栏（用药/记录/设置）时一并重绘。
// 用法：node scripts/gen-tab-icons.js  →  覆盖输出 src/images/{med,record,setting}{,-active}.png
// 形状：用药=斜置胶囊（中缝分隔）、记录=圆角文档+三条镂空线、设置=齿轮（8 齿+中孔）。
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 81;
const SS = 3; // 每像素 3×3 超采样，边缘抗锯齿

// ---------- PNG 编码（8bit RGBA、filter 0、无交错） ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 形状判定（坐标原点在图标中心，单位=像素） ----------
function inCapsule(x, y) {
  // 45° 斜置胶囊：半长 26、半宽 10、端部半圆；中部 ±2.2 留透明缝分成两半
  const a = Math.SQRT1_2;
  const rx = (x + y) * a;
  const ry = (y - x) * a; // 逆旋转 45°
  const halfW = 26;
  const halfH = 10;
  const gap = 2.2;
  const ax = Math.abs(rx);
  if (Math.abs(ry) > halfH || ax > halfW) return false;
  if (ax > halfW - halfH) {
    const dx = ax - (halfW - halfH);
    return dx * dx + ry * ry <= halfH * halfH; // 端部圆弧
  }
  return ax >= gap; // 中段留分隔缝
}

function inRecord(x, y) {
  // 文档：半宽 13、半高 22 圆角矩形（r=5），镂空三条横线
  const w = 13;
  const h = 22;
  const r = 5;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > w || ay > h) return false;
  if (ax > w - r && ay > h - r) {
    const dx = ax - (w - r);
    const dy = ay - (h - r);
    if (dx * dx + dy * dy > r * r) return false;
  }
  for (const ly of [-11, 0, 11]) {
    if (Math.abs(y - ly) <= 1.7 && ax <= 7.5) return false; // 镂空横线
  }
  return true;
}

function inGear(x, y) {
  // 齿轮：环体 r≤17、中心孔 r≥7.5、8 齿（45° 步进，齿宽 5，外缘 24）
  const d = Math.hypot(x, y);
  if (d > 24 || d < 7.5) return false;
  if (d <= 17) return true;
  const seg = Math.PI / 4;
  const am = ((Math.atan2(y, x) % seg) + seg) % seg; // 距下方 45° 整数倍的角位置
  const dev = Math.min(am, seg - am); // 距最近齿心角（0/45/90…）的角差
  return dev * d <= 2.5; // 弧长≈齿半宽
}

// ---------- 渲染 ----------
function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function render(shapeFn, rgb) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const c = SIZE / 2;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS - c;
          const y = py + (sy + 0.5) / SS - c;
          if (shapeFn(x, y)) hit++;
        }
      }
      const i = (py * SIZE + px) * 4;
      buf[i] = rgb[0];
      buf[i + 1] = rgb[1];
      buf[i + 2] = rgb[2];
      buf[i + 3] = Math.round((hit / (SS * SS)) * 255);
    }
  }
  return encodePng(SIZE, SIZE, buf);
}

const OUT_DIR = path.join(__dirname, '..', 'src', 'images');
const COLORS = { '': '#999999', '-active': '#2F5496' }; // tabBar color/selectedColor 同源
const SHAPES = { med: inCapsule, record: inRecord, setting: inGear };

for (const [name, shape] of Object.entries(SHAPES)) {
  for (const [suffix, hex] of Object.entries(COLORS)) {
    const file = path.join(OUT_DIR, `${name}${suffix}.png`);
    fs.writeFileSync(file, render(shape, hexRgb(hex)));
    console.log(`✅ ${file} (${fs.statSync(file).size} 字节)`);
  }
}
console.log('完成：6 个 tabBar 图标已生成');
