// Gera build/icon.png (256x256) usando só Node: rasterização por supersampling + escrita manual de PNG.
// Uso: node scripts/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 256;
const SS = 4; // 4x4 amostras por pixel

/* ---------- geometria ---------- */

const mix = (a, b, t) => a + (b - a) * t;
const mixC = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];

function inRoundRect(x, y, cx, cy, w, h, r) {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  if (dx <= 0 || dy <= 0) return Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2;
  return dx * dx + dy * dy <= r * r;
}

/** Distância assinada aproximada a um retângulo arredondado (negativa = dentro) */
function sdRoundRect(x, y, cx, cy, w, h, r) {
  const qx = Math.abs(x - cx) - (w / 2 - r);
  const qy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Espada: coração implícito com a ponta para cima + haste. (u,v) normalizados, v para baixo, v=0 no centro */
function inSpade(u, v) {
  const x = u * 1.05;
  const y = v - 0.15; // coração com y para cima: lobos ficam embaixo na tela
  const a = x * x + y * y - 1;
  const heart = a * a * a - x * x * y * y * y <= 0;
  const stemTop = 0.75;
  const stemBottom = 1.5;
  let stem = false;
  if (v >= stemTop && v <= stemBottom) {
    const t = (v - stemTop) / (stemBottom - stemTop);
    stem = Math.abs(u) <= mix(0.08, 0.46, t * t);
  }
  return heart || stem;
}

/* ---------- cena ---------- */

const rot = (x, y, cx, cy, deg) => {
  const a = (-deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
};

const BG_IN = [27, 120, 82];
const BG_OUT = [10, 52, 36];
const GOLD = [230, 185, 80];

/** Retorna [r,g,b,a] (a 0..1) de uma amostra */
function shade(x, y) {
  // 1) fundo: quadrado arredondado com feltro verde
  const bgD = sdRoundRect(x, y, 128, 128, 248, 248, 52);
  if (bgD > 0) return [0, 0, 0, 0];
  const rad = Math.hypot(x - 128, y - 118) / 170;
  let col = mixC(BG_IN, BG_OUT, Math.min(1, rad * rad));
  // aro dourado fino
  if (bgD > -5) col = mixC(col, GOLD, 0.85);

  // 2) carta de trás (verso vinho), girada para a direita
  {
    const [rx, ry] = rot(x, y, 150, 134, 11);
    // sombra
    const sh = sdRoundRect(rx - 3, ry - 5, 150, 134, 112, 156, 12);
    if (sh < 6) col = mixC(col, [0, 0, 0], 0.28 * (1 - Math.max(0, sh) / 6));
    if (inRoundRect(rx, ry, 150, 134, 112, 156, 12)) {
      col = [236, 232, 220];
      if (inRoundRect(rx, ry, 150, 134, 112 - 12, 156 - 12, 8)) {
        const stripe = (Math.floor((rx + ry) / 7) & 1) === 0;
        col = stripe ? [128, 30, 44] : [150, 40, 56];
      }
    }
  }

  // 3) carta da frente, girada para a esquerda
  {
    const cx = 104;
    const cy = 134;
    const [rx, ry] = rot(x, y, cx, cy, -9);
    const sh = sdRoundRect(rx - 3, ry - 5, cx, cy, 116, 164, 13);
    if (sh < 7) col = mixC(col, [0, 0, 0], 0.32 * (1 - Math.max(0, sh) / 7));
    if (inRoundRect(rx, ry, cx, cy, 116, 164, 13)) {
      col = [251, 250, 246];
      const edge = sdRoundRect(rx, ry, cx, cy, 116, 164, 13);
      if (edge > -2) col = [205, 200, 188];
      // espada grande
      const s = 36;
      const u = (rx - cx) / s;
      const v = (ry - cy) / s + 0.33;
      if (inSpade(u, v)) col = [24, 26, 25];
      // espada pequena no canto
      const su = (rx - (cx - 40)) / 9;
      const sv = (ry - (cy - 62)) / 9 + 0.33;
      if (inSpade(su, sv)) col = [24, 26, 25];
    }
  }

  // 4) ficha dourada sobre as cartas (canto inferior direito)
  {
    const fx = 180;
    const fy = 186;
    const d = Math.hypot(x - fx, y - fy);
    if (d < 40) {
      const shadow = d > 36;
      col = shadow ? mixC(col, [0, 0, 0], 0.3) : col;
    }
    if (d <= 36) {
      col = [196, 40, 52];
      if (d <= 36 && d > 30) {
        // marcas brancas alternadas na borda
        const ang = Math.atan2(y - fy, x - fx);
        const seg = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 12);
        col = (seg & 1) === 0 ? [248, 246, 238] : [196, 40, 52];
      } else if (d <= 30 && d > 27) {
        col = [248, 246, 238];
      } else if (d <= 27) {
        col = mixC([196, 40, 52], [140, 24, 36], d / 27);
        if (d <= 15 && d > 12) col = GOLD;
        if (d <= 12) col = [196, 40, 52];
        if (d <= 7) col = GOLD;
      }
    }
  }

  return [col[0], col[1], col[2], 1];
}

/* ---------- rasterização ---------- */

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let py = 0; py < SIZE; py++) {
  const rowStart = py * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filtro: nenhum
  for (let px = 0; px < SIZE; px++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = shade(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
        r += c[0] * c[3];
        g += c[1] * c[3];
        b += c[2] * c[3];
        a += c[3];
      }
    }
    const n = SS * SS;
    const o = rowStart + 1 + px * 4;
    if (a > 0) {
      raw[o] = Math.round(r / a);
      raw[o + 1] = Math.round(g / a);
      raw[o + 2] = Math.round(b / a);
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
}

/* ---------- escrita do PNG ---------- */

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // profundidade
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// build/icon.png (electron-builder) e public/icon.png (copiado para dist/ pelo Vite; usado pela bandeja em runtime)
for (const dir of ['build', 'public']) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, 'icon.png'), png);
}
console.log(`Ícone gerado (${png.length} bytes): build/icon.png e public/icon.png`);
