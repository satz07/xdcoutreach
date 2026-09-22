/**
 * Generate simple PNG logo badges (no external deps) for email CID embeds.
 * Creates solid branded mark PNGs that email clients render reliably.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function rgbaPng(width, height, paint) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y, width, height);
      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function circleLogo(bg1, bg2, accent) {
  const size = 128;
  return rgbaPng(size, size, (x, y, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = w / 2 - 2;
    if (dist > r) return [0, 0, 0, 0];
    const t = (x + y) / (w + h);
    const rC = Math.round(bg1[0] + (bg2[0] - bg1[0]) * t);
    const gC = Math.round(bg1[1] + (bg2[1] - bg1[1]) * t);
    const bC = Math.round(bg1[2] + (bg2[2] - bg1[2]) * t);
    // X mark
    const onDiag1 = Math.abs(dx - dy) < 6 && Math.abs(dx) < r * 0.55;
    const onDiag2 = Math.abs(dx + dy) < 6 && Math.abs(dx) < r * 0.55;
    if (onDiag1 || onDiag2) return accent;
    return [rC, gC, bC, 255];
  });
}

function roundedLogo(bg1, bg2, accent) {
  const size = 128;
  const radius = 28;
  return rgbaPng(size, size, (x, y, w, h) => {
    const inRoundRect = (() => {
      const px = Math.max(radius, Math.min(x, w - 1 - radius));
      const py = Math.max(radius, Math.min(y, h - 1 - radius));
      const dx = x - px;
      const dy = y - py;
      return dx * dx + dy * dy <= radius * radius || (x >= radius && x < w - radius) || (y >= radius && y < h - radius);
    })();
    // simpler round-rect check
    const left = 8;
    const top = 8;
    const right = w - 8;
    const bottom = h - 8;
    const rr = 24;
    let inside = false;
    if (x >= left + rr && x < right - rr && y >= top && y < bottom) inside = true;
    else if (y >= top + rr && y < bottom - rr && x >= left && x < right) inside = true;
    else {
      const corners = [
        [left + rr, top + rr],
        [right - rr - 1, top + rr],
        [left + rr, bottom - rr - 1],
        [right - rr - 1, bottom - rr - 1],
      ];
      for (const [cx, cy] of corners) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rr * rr) inside = true;
      }
    }
    if (!inside) return [0, 0, 0, 0];
    const t = (x + y) / (w + h);
    const rC = Math.round(bg1[0] + (bg2[0] - bg1[0]) * t);
    const gC = Math.round(bg1[1] + (bg2[1] - bg1[1]) * t);
    const bC = Math.round(bg1[2] + (bg2[2] - bg1[2]) * t);
    // teal accent wave
    const wave = Math.sin((x / w) * Math.PI * 2) * 10;
    if (y > h * 0.55 + wave && y < h * 0.55 + wave + 10 && x > w * 0.2 && x < w * 0.8) {
      return accent;
    }
    return [rC, gC, bC, 255];
  });
}

const outDir = path.join(__dirname, '../../public/logos');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'xdc.png'),
  circleLogo([27, 111, 255], [0, 194, 255], [255, 255, 255, 255])
);
fs.writeFileSync(
  path.join(outDir, 'contour.png'),
  roundedLogo([10, 37, 64], [26, 107, 138], [92, 225, 230, 255])
);

console.log('Generated PNG logos in', outDir);
