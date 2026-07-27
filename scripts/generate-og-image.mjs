/**
 * OPEN GRAPH GÖRSELİ — PNG ÜRETİCİ.
 *
 * NEDEN GEREKLİ
 *
 * Sitenin tek paylaşım görseli `assets/og-image.svg` idi ve 3287 sayfanın
 * tamamı onu gösteriyordu. Facebook, X/Twitter, LinkedIn, WhatsApp ve
 * Slack'in hiçbiri `image/svg+xml` kabul etmiyor — hepsi SVG'yi sessizce
 * atıyor. Sonuç: sitenin HİÇBİR sayfasının paylaşım önizlemesi yoktu.
 * 2972 sayfa ayrıca `og:image:type: image/svg+xml` beyan ederek durumu
 * açıkça kayda geçiriyordu.
 *
 * NEDEN ELLE KODLANMIŞ PNG
 *
 * Bu ortamda rasterleştirici yok (ImageMagick, rsvg, Pillow, sharp — hiçbiri
 * kurulu değil ve depo sıfır npm bağımlılığıyla çalışıyor). Node'un yerleşik
 * zlib'i PNG için yeterli: PNG, zlib akışı + CRC32'li chunk'lardan ibaret.
 * Bu betik görseli matematiksel olarak çiziyor (gradyan, ızgara, radar
 * halkaları, monogram, bitmap wordmark) ve 2x örnekleyip küçülterek kenar
 * yumuşatma uyguluyor.
 *
 * Çıktı SVG'nin birebir kopyası değil; markanın geometrisini ve paletini
 * taşıyan, sosyal tarayıcıların GERÇEKTEN okuduğu bir görsel. Tasarımcı
 * eliyle üretilmiş bir sürümle değiştirilmesi beklenir — spesifikasyon ve
 * yedek zinciri docs/open-graph-image.md içinde.
 *
 * Kullanım: node scripts/generate-og-image.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const WIDTH = 1200;
const HEIGHT = 630;
const SS = 2; // supersampling faktörü (kenar yumuşatma)
const W = WIDTH * SS;
const H = HEIGHT * SS;

/* ---------------------------------------------------------------- *
 * Palet — assets/og-image.svg ile aynı marka renkleri
 * ---------------------------------------------------------------- */
const BG_TOP = [0x07, 0x10, 0x17];
const BG_MID = [0x08, 0x1b, 0x20];
const BG_BOTTOM = [0x04, 0x10, 0x12];
const GREEN = [0x80, 0xff, 0x9b];
const CYAN = [0x4d, 0xe5, 0xff];
const INK = [0xee, 0xf8, 0xf5];
const MUTED = [0xb8, 0xcb, 0xc8];
const TILE = [0x10, 0x26, 0x2b];

const buffer = Buffer.alloc(W * H * 3);

function setPixel(x, y, rgb, alpha = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const index = (y * W + x) * 3;
  for (let channel = 0; channel < 3; channel += 1) {
    const existing = buffer[index + channel];
    buffer[index + channel] = Math.round(existing * (1 - alpha) + rgb[channel] * alpha);
  }
}

function lerp(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

/* 1. Diyagonal gradyan arka plan ------------------------------------- */
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    const rgb = t < 0.55 ? lerp(BG_TOP, BG_MID, t / 0.55) : lerp(BG_MID, BG_BOTTOM, (t - 0.55) / 0.45);
    const index = (y * W + x) * 3;
    buffer[index] = rgb[0];
    buffer[index + 1] = rgb[1];
    buffer[index + 2] = rgb[2];
  }
}

/* 2. Izgara deseni (96x84, SVG ile aynı) ------------------------------ */
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    if (x % (96 * SS) === 0 || y % (84 * SS) === 0) setPixel(x, y, GREEN, 0.07);
  }
}

/* 3. Radar geometrisi -------------------------------------------------- */
function fillCircle(cx, cy, r, rgb, alpha) {
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1 = Math.min(W - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1 = Math.min(H - 1, Math.ceil((cy + r) * SS));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x / SS - cx;
      const dy = y / SS - cy;
      if (dx * dx + dy * dy <= r * r) setPixel(x, y, rgb, alpha);
    }
  }
}

function strokeCircle(cx, cy, r, width, rgb, alpha) {
  const outer = r + width / 2;
  const inner = r - width / 2;
  const x0 = Math.max(0, Math.floor((cx - outer) * SS));
  const x1 = Math.min(W - 1, Math.ceil((cx + outer) * SS));
  const y0 = Math.max(0, Math.floor((cy - outer) * SS));
  const y1 = Math.min(H - 1, Math.ceil((cy + outer) * SS));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x / SS - cx;
      const dy = y / SS - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= outer && distance >= inner) setPixel(x, y, rgb, alpha);
    }
  }
}

function strokeLine(x1, y1, x2, y2, width, rgb, alpha) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * SS * 2);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const cx = (x1 + (x2 - x1) * t) * SS;
    const cy = (y1 + (y2 - y1) * t) * SS;
    const radius = (width / 2) * SS;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy <= radius * radius) {
          setPixel(Math.round(cx + dx), Math.round(cy + dy), rgb, alpha);
        }
      }
    }
  }
}

fillCircle(930, 220, 210, CYAN, 0.08);
strokeCircle(960, 250, 130, 3, GREEN, 0.38);
strokeCircle(960, 250, 78, 4, CYAN, 0.28);
strokeLine(960, 250, 820, 100, 4, GREEN, 0.75);
strokeLine(960, 250, 1085, 160, 4, CYAN, 0.7);
strokeLine(960, 250, 1045, 385, 4, GREEN, 0.6);

/* 4. Bitmap wordmark ---------------------------------------------------
 * Sistemde font yok, bu yüzden gereken 10 glif elle tanımlı (5x7 ızgara).
 * Marka adı camelCase: "FutbolRadar".
 */
const GLYPHS = {
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
  t: ["00100", "00100", "11111", "00100", "00100", "00101", "00010"],
  b: ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  l: ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  n: ["00000", "00000", "10110", "11001", "10001", "10001", "10001"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  k: ["10000", "10000", "10010", "10100", "11000", "10100", "10010"],
  f: ["00110", "01001", "01000", "11100", "01000", "01000", "01000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"]
};

/**
 * TANIMSIZ GLİF SESSİZCE BOŞLUK BIRAKMAZ.
 *
 * İlk sürümde eksik harfler sessizce atlanıyordu ve alt başlık
 * "For u  o  tu u" gibi okunaksız bir dizi hâline geliyordu — paylaşım
 * görselinde bozuk metin, metin olmamasından kötüdür. Artık eksik glif
 * derleme anında hata veriyor: ya glifi tanımlarsın ya metni değiştirirsin.
 */
function assertRenderable(text) {
  const missing = [...new Set([...text])].filter((character) => character !== " " && !GLYPHS[character]);
  if (missing.length) {
    throw new Error(`OG görseli: tanımsız glif ${JSON.stringify(missing.join(""))} — metin "${text}"`);
  }
}

function drawText(text, originX, originY, scale, rgb, letterSpacing = 1) {
  assertRenderable(text);
  let cursor = originX;
  for (const character of text) {
    const glyph = GLYPHS[character];
    if (!glyph) { cursor += (5 + letterSpacing) * scale; continue; }
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== "1") continue;
        for (let dy = 0; dy < scale * SS; dy += 1) {
          for (let dx = 0; dx < scale * SS; dx += 1) {
            setPixel(
              Math.round((cursor + col * scale) * SS + dx),
              Math.round((originY + row * scale) * SS + dy),
              rgb, 1
            );
          }
        }
      }
    }
    cursor += (5 + letterSpacing) * scale;
  }
}

/* 5. Monogram karesi + wordmark ---------------------------------------- */
function roundedRect(x, y, w, h, radius, rgb, alpha) {
  for (let py = Math.floor(y * SS); py < Math.ceil((y + h) * SS); py += 1) {
    for (let px = Math.floor(x * SS); px < Math.ceil((x + w) * SS); px += 1) {
      const lx = px / SS - x;
      const ly = py / SS - y;
      const cx = Math.min(Math.max(lx, radius), w - radius);
      const cy = Math.min(Math.max(ly, radius), h - radius);
      if ((lx - cx) ** 2 + (ly - cy) ** 2 <= radius * radius) setPixel(px, py, rgb, alpha);
    }
  }
}

roundedRect(88, 84, 76, 76, 18, TILE, 1);
// Kenarlık: dış dikdörtgeni yeşille, içini tekrar dolduruyoruz.
roundedRect(88, 84, 76, 76, 18, GREEN, 0.9);
roundedRect(91, 87, 70, 70, 15, TILE, 1);
drawText("FR", 106, 106, 5, GREEN, 1);

drawText("FutbolRadar", 188, 96, 7, INK, 1);
drawText("Futbol", 90, 210, 13, INK, 1);
drawText("Radar", 90, 330, 13, GREEN, 1);

/* 6. Aksan çubuğu — wordmark'ın ALTINDA, üstüne değil.
 * İlk sürümde 420'deydi ve "Radar" satırının altını çizip metnin
 * okunurluğunu bozuyordu. */
roundedRect(90, 448, 300, 6, 3, GREEN, 0.85);

drawText("Canli skor - form - momentum", 92, 486, 4, MUTED, 1);

/* ---------------------------------------------------------------- *
 * Örnekleme düşürme + PNG kodlama
 * ---------------------------------------------------------------- */
const out = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      let total = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          total += buffer[((y * SS + sy) * W + (x * SS + sx)) * 3 + channel];
        }
      }
      out[(y * WIDTH + x) * 3 + channel] = Math.round(total / (SS * SS));
    }
  }
}

// PNG: her satırın başına filtre baytı (0 = None).
const raw = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
for (let y = 0; y < HEIGHT; y += 1) {
  raw[y * (WIDTH * 3 + 1)] = 0;
  out.copy(raw, y * (WIDTH * 3 + 1) + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;   // bit derinliği
ihdr[9] = 2;   // renk tipi: truecolor RGB
ihdr[10] = 0;  // sıkıştırma
ihdr[11] = 0;  // filtre
ihdr[12] = 0;  // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

for (const target of [path.join(root, "assets"), path.join(root, "public", "assets")]) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "og-image.png"), png);
}

console.log(`OG görseli yazıldı: assets/og-image.png (${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)} KB)`);
