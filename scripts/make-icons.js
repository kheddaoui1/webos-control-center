'use strict';

/* Generates assets/icon.png (512px) and assets/icon.ico from a tiny software renderer. */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets');

// ---------------------------------------------------------------- PNG

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
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------------------------------------------------------------- drawing

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function renderIcon(size) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size * 0.505;
  const margin = size * 0.055;
  const hw = size / 2 - margin;
  const hh = hw;
  const radius = size * 0.235;

  const ringRadius = size * 0.207;
  const ringWidth = Math.max(1.15, size * 0.052);
  const stemWidth = Math.max(1.1, size * 0.05);
  const stemTop = cy - size * 0.245;
  const stemBottom = cy + size * 0.005;
  const gap = 0.40; // radians, half-angle of the gap at the top of the ring

  const topColor = [26, 20, 38];
  const bottomColor = [8, 7, 12];
  const accentA = [255, 62, 106];
  const accentB = [255, 132, 58];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0, gSum = 0, bSum = 0, covered = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const pxX = x + (sx + 0.5) / SS;
          const pxY = y + (sy + 0.5) / SS;
          const dRect = sdRoundRect(pxX, pxY, size / 2, size / 2, hw, hh, radius);
          if (dRect > 0) continue;
          covered++;

          const t = Math.max(0, Math.min(1, (pxY - margin) / (size - margin * 2)));
          let color = mix(topColor, bottomColor, t);

          // Warm glow behind the glyph.
          const dx = pxX - size * 0.62;
          const dy = pxY - size * 0.26;
          const glow = Math.max(0, 1 - Math.hypot(dx, dy) / (size * 0.72));
          color = mix(color, [158, 20, 64], glow * glow * 0.55);

          // Inner border.
          if (dRect > -Math.max(0.8, size * 0.0055)) {
            color = mix(color, [255, 255, 255], 0.12);
          }

          // Power glyph.
          const dist = Math.hypot(pxX - cx, pxY - cy);
          let inRing = Math.abs(dist - ringRadius) <= ringWidth / 2;
          if (inRing) {
            let angle = Math.atan2(pxY - cy, pxX - cx) + Math.PI / 2;
            while (angle > Math.PI) angle -= Math.PI * 2;
            while (angle < -Math.PI) angle += Math.PI * 2;
            if (Math.abs(angle) < gap) inRing = false;
          }
          const inStem = Math.abs(pxX - cx) <= stemWidth / 2 && pxY >= stemTop && pxY <= stemBottom;
          let inGlyph = inRing || inStem;

          // Rounded stem cap.
          if (!inGlyph) {
            const cap = Math.hypot(pxX - cx, pxY - stemTop);
            if (cap <= stemWidth / 2 && pxY <= stemTop) inGlyph = true;
          }

          if (inGlyph) {
            const gT = Math.max(0, Math.min(1, (pxY - (cy - ringRadius)) / (ringRadius * 2)));
            const glyph = mix(accentA, accentB, gT);
            color = mix(color, glyph, 1);
          } else {
            // Soft halo around the glyph.
            const ringD = Math.abs(dist - ringRadius) - ringWidth / 2;
            const stemD = Math.max(Math.abs(pxX - cx) - stemWidth / 2, Math.max(stemTop - pxY, pxY - stemBottom));
            const halo = Math.min(ringD, stemD);
            if (halo > 0 && halo < size * 0.055) {
              const k = 1 - halo / (size * 0.055);
              color = mix(color, [255, 70, 100], k * 0.22);
            }
          }

          rSum += color[0];
          gSum += color[1];
          bSum += color[2];
        }
      }

      const idx = (y * size + x) * 4;
      const alpha = Math.round((covered / (SS * SS)) * 255);
      if (covered > 0) {
        px[idx] = Math.round(rSum / covered);
        px[idx + 1] = Math.round(gSum / covered);
        px[idx + 2] = Math.round(bSum / covered);
        px[idx + 3] = alpha;
      }
    }
  }
  return encodePng(size, size, px);
}

// ---------------------------------------------------------------- ICO

function encodeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const payloads = [];
  images.forEach((image, i) => {
    const e = i * 16;
    entries[e] = image.size >= 256 ? 0 : image.size;
    entries[e + 1] = image.size >= 256 ? 0 : image.size;
    entries[e + 2] = 0;
    entries[e + 3] = 0;
    entries.writeUInt16LE(1, e + 4);
    entries.writeUInt16LE(32, e + 6);
    entries.writeUInt32LE(image.png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += image.png.length;
    payloads.push(image.png);
  });

  return Buffer.concat([header, entries, ...payloads]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const icon512 = renderIcon(512);
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), icon512);
fs.writeFileSync(path.join(OUT_DIR, 'icon-256.png'), renderIcon(256));

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const ico = encodeIco(icoSizes.map((size) => ({ size, png: size === 512 ? icon512 : renderIcon(size) })));
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);

console.log(`icons written: icon.png (512), icon.ico (${icoSizes.join(', ')})`);
