/**
 * Generates the application icon set without any external image dependency.
 * Produces: src-tauri/icons/{32x32,128x128,128x128@2x}.png, icon.png, icon.ico
 * and public/logo.png (used inside the app).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- minimal PNG encoder ---------------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- tiny software rasterizer ---------------- */
function createCanvas(size) {
  const data = Buffer.alloc(size * size * 4); // transparent
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
    const i = (y * size + x) * 4;
    const sa = a / 255;
    const da = data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    data[i] = Math.round((r * sa + data[i] * da * (1 - sa)) / oa);
    data[i + 1] = Math.round((g * sa + data[i + 1] * da * (1 - sa)) / oa);
    data[i + 2] = Math.round((b * sa + data[i + 2] * da * (1 - sa)) / oa);
    data[i + 3] = Math.round(oa * 255);
  };
  return { data, set };
}

function roundRect(c, x0, y0, w, h, radius, color) {
  const [r, g, b, a] = color;
  for (let y = Math.floor(y0); y < y0 + h; y++) {
    for (let x = Math.floor(x0); x < x0 + w; x++) {
      const dx = Math.max(x0 + radius - x, 0, x - (x0 + w - radius - 1));
      const dy = Math.max(y0 + radius - y, 0, y - (y0 + h - radius - 1));
      const inside = dx === 0 && dy === 0 ? 0 : Math.hypot(dx, dy);
      if (inside <= radius) {
        const edge = Math.min(1, Math.max(0, radius - inside + 0.5));
        c.set(x, y, r, g, b, a * edge);
      }
    }
  }
}

function circle(c, cx, cy, radius, color, inner = 0) {
  const [r, g, b, a] = color;
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > radius || d < inner) continue;
      const edge = Math.min(1, Math.max(0, radius - d + 0.5, d - inner + 0.5));
      c.set(x, y, r, g, b, a * edge);
    }
  }
}

function drawIcon(size) {
  const c = createCanvas(size);
  const u = size / 256;
  // rounded blue background with a soft vertical gradient
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const shade = [Math.round(37 + 22 * t), Math.round(99 + 30 * t), Math.round(235 + 8 * t), 255];
    roundRect(c, 8 * u, 8 * u, 240 * u, 240 * u, 56 * u, shade);
  }
  // document sheet
  roundRect(c, 60 * u, 46 * u, 128 * u, 164 * u, 20 * u, [255, 255, 255, 255]);
  // text lines
  const line = [147, 180, 246, 255];
  for (let i = 0; i < 4; i++) {
    roundRect(c, 82 * u, (88 + i * 24) * u, (i === 3 ? 52 : 84) * u, 9 * u, 4.5 * u, line);
  }
  // magnifier ring + handle (accent)
  circle(c, 170 * u, 168 * u, 42 * u, [29, 78, 216, 255]);
  circle(c, 170 * u, 168 * u, 30 * u, [255, 255, 255, 255]);
  circle(c, 170 * u, 168 * u, 27 * u, [29, 78, 216, 255], 0);
  // check mark inside the lens
  for (let i = 0; i < 3; i++) {
    roundRect(c, (156 + i * 7) * u, (168 + i * 5) * u, 9 * u, 7 * u, 3 * u, [255, 255, 255, 255]);
    roundRect(c, (163 + i * 7) * u, (178 - i * 7) * u, 9 * u, 7 * u, 3 * u, [255, 255, 255, 255]);
  }
  // handle
  roundRect(c, 196 * u, 196 * u, 34 * u, 13 * u, 6.5 * u, [29, 78, 216, 255]);
  return encodePNG(size, size, c.data);
}

function encodeICO(sizes) {
  const images = sizes.map((s) => ({ size: s, png: drawIcon(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const iconsDir = resolve(root, "src-tauri/icons");
mkdirSync(iconsDir, { recursive: true });
mkdirSync(resolve(root, "public"), { recursive: true });

const targets = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];
for (const [name, size] of targets) {
  writeFileSync(resolve(iconsDir, name), drawIcon(size));
}
writeFileSync(resolve(iconsDir, "icon.ico"), encodeICO([16, 24, 32, 48, 64, 128, 256]));
writeFileSync(resolve(root, "public/logo.png"), drawIcon(128));

console.log("icons generated:", targets.length + 2, "files");
