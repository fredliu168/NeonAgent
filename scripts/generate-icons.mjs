import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";

const sizes = [16, 32, 48, 128];

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function setPixel(buf, width, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const index = (y * width + x) * 4;
  const inv = 1 - alpha;
  buf[index] = Math.round(buf[index] * inv + color[0] * alpha);
  buf[index + 1] = Math.round(buf[index + 1] * inv + color[1] * alpha);
  buf[index + 2] = Math.round(buf[index + 2] * inv + color[2] * alpha);
  buf[index + 3] = Math.min(255, Math.round(buf[index + 3] + color[3] * alpha));
}

function drawLine(buf, width, x1, y1, x2, y2, radius, color) {
  const minX = Math.floor(Math.min(x1, x2) - radius - 2);
  const maxX = Math.ceil(Math.max(x1, x2) + radius + 2);
  const minY = Math.floor(Math.min(y1, y2) - radius - 2);
  const maxY = Math.ceil(Math.max(y1, y2) + radius + 2);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const dist = Math.hypot(x - px, y - py);
      const alpha = Math.max(0, Math.min(1, radius + 0.6 - dist));
      if (alpha > 0) setPixel(buf, width, x, y, color, alpha);
    }
  }
}

function drawCircle(buf, width, cx, cy, radius, color) {
  const min = Math.floor(-radius - 2);
  const max = Math.ceil(radius + 2);
  for (let y = min; y <= max; y += 1) {
    for (let x = min; x <= max; x += 1) {
      const dist = Math.hypot(x, y);
      const alpha = Math.max(0, Math.min(1, radius + 0.6 - dist));
      if (alpha > 0) setPixel(buf, width, Math.round(cx + x), Math.round(cy + y), color, alpha);
    }
  }
}

function render(size) {
  const scale = 4;
  const width = size * 4;
  const buf = Buffer.alloc(width * width * 4);
  const radius = Math.round(width * 0.22);
  const inset = width * 0.18;
  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = width - inset;
  const stroke = Math.max(4, width * 0.1);
  const glowStroke = stroke * 2.05;
  const dot = Math.max(4, width * 0.06);
  const topRightY = top + width * 0.01;

  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / width;
      const ny = y / width;
      const cx = Math.max(radius, Math.min(width - radius - 1, x));
      const cy = Math.max(radius, Math.min(width - radius - 1, y));
      const inside = Math.hypot(x - cx, y - cy) <= radius;
      if (!inside) continue;
      const t = Math.min(1, Math.max(0, (nx + ny) / 2));
      const r = mix(15, 15, t);
      const g = mix(23, 118, t);
      const b = mix(42, 110, t);
      const index = (y * width + x) * 4;
      buf[index] = Math.round(r);
      buf[index + 1] = Math.round(g);
      buf[index + 2] = Math.round(b);
      buf[index + 3] = 255;
    }
  }

  const glow = [45, 212, 191, 90];
  const mark = [167, 243, 208, 255];
  drawLine(buf, width, left, bottom, left, top, glowStroke, glow);
  drawLine(buf, width, left, top, right, bottom, glowStroke, glow);
  drawLine(buf, width, right, bottom, right, topRightY, glowStroke, glow);
  drawLine(buf, width, left, bottom, left, top, stroke, mark);
  drawLine(buf, width, left, top, right, bottom, stroke, mark);
  drawLine(buf, width, right, bottom, right, topRightY, stroke, mark);
  drawCircle(buf, width, left, top, dot, [236, 254, 255, 255]);
  drawCircle(buf, width, right, bottom, dot, [236, 254, 255, 255]);
  drawCircle(buf, width, right, topRightY, dot * 0.75, [153, 246, 228, 255]);

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const index = ((y * scale + sy) * width + (x * scale + sx)) * 4;
          for (let i = 0; i < 4; i += 1) sum[i] += buf[index + i];
        }
      }
      const outIndex = (y * size + x) * 4;
      for (let i = 0; i < 4; i += 1) out[outIndex + i] = Math.round(sum[i] / (scale * scale));
    }
  }

  return encodePng(size, size, out);
}

mkdirSync("images", { recursive: true });
for (const size of sizes) {
  const file = `images/icon-${size}.png`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(size));
  console.log(`Generated ${file}`);
}
