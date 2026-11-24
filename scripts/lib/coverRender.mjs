/**
 * KAPAK KARTI ÇİZİCİSİ — TARAYICISIZ.
 *
 * İlk sürüm Chromium ile çiziyordu; Vercel derlemesinde tarayıcı yok
 * (`scripts/install-browser.mjs`) ve oraya kurmak her dağıtıma dakikalar ve
 * kırılgan bir adım eklerdi. Bu çizici SVG'yi `@resvg/resvg-js` (hazır ikili,
 * tarayıcı yok) ile rasterler, `jpeg-js` ile JPEG'e çevirir. Yerelde, Vercel
 * derlemesinde ve zamanlanmış hatlarda aynı kod, aynı çıktıyı verir.
 *
 * Yazı tipi depodaki Inter'dir (`fonts/cover/`, OFL). Sistem yazı tipleri
 * KAPALI: derleme makinesinde hangi yazı tipinin kurulu olduğuna bağlı
 * kalınmaz, çıktı her yerde aynıdır.
 *
 * Satır kırma elle yapılır (SVG metni sarmaz): her aday satırın genişliği
 * resvg ile ölçülür.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Resvg } = require("@resvg/resvg-js");
const jpeg = require("jpeg-js");

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fonts", "cover");
const FONT_OPTIONS = Object.freeze({
  fontFiles: [path.join(FONT_DIR, "Inter-ExtraBold.otf"), path.join(FONT_DIR, "Inter-SemiBold.otf")],
  loadSystemFonts: false,
  defaultFontFamily: "Inter"
});

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
const TEXT_LEFT = 78;
const TEXT_MAX_WIDTH = CARD_WIDTH - TEXT_LEFT - 150;
const FAMILY = "Inter, sans-serif";

const xml = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const widthCache = new Map();
/** Tek satır metnin çizilen genişliği (px). */
function measure(text, size, weight, spacing = 0) {
  const key = `${weight}|${size}|${spacing}|${text}`;
  if (widthCache.has(key)) return widthCache.get(key);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="300"><text x="0" y="200" font-family="${FAMILY}" font-weight="${weight}" font-size="${size}" letter-spacing="${spacing}">${xml(text)}</text></svg>`;
  const box = new Resvg(svg, { ...FONT_OPTIONS }).getBBox();
  const width = box ? box.width : text.length * size * 0.6;
  widthCache.set(key, width);
  return width;
}

/** Başlık uzunluğuna göre yazı boyutu. */
function titleSize(title) {
  const n = title.length;
  if (n <= 40) return 76;
  if (n <= 64) return 64;
  if (n <= 90) return 54;
  if (n <= 120) return 46;
  return 40;
}

/** Sözcük sözcük sarar; en çok `maxLines` satır, sığmayan kuyruk "…" olur. */
export function wrapLines(text, size, weight, maxWidth, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  let index = 0;
  for (; index < words.length; index += 1) {
    const candidate = current ? `${current} ${words[index]}` : words[index];
    if (!current || measure(candidate, size, weight) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) break;
    lines.push(current);
    current = words[index];
  }
  if (current) lines.push(current);
  if (index < words.length) {
    // Satır sınırı aşıldı: son satırı sığana dek kısalt ve "…" ekle.
    let last = `${lines.pop()} ${words.slice(index).join(" ")}`.trim();
    while (last.length > 1 && measure(`${last}…`, size, weight) > maxWidth) last = last.slice(0, -1).trimEnd();
    lines.push(`${last}…`);
  }
  return lines;
}

/** Kartın SVG'si. `card`: { kicker, sub, title, date }. */
export function coverSvg(card) {
  const size = titleSize(card.title);
  const lines = wrapLines(card.title, size, 800, TEXT_MAX_WIDTH, 4);
  const lineHeight = Math.round(size * 1.14);
  // İlk satırın taban çizgisi yazı boyutuyla ölçeklenir: büyük başlık alt satıra (sub) binmez.
  const titleTop = 170 + Math.round(size * 0.95);
  const titleSvg = lines
    .map((line, i) => `<text x="${TEXT_LEFT}" y="${titleTop + i * lineHeight}" font-family="${FAMILY}" font-weight="800" font-size="${size}" fill="#f2f7fa">${xml(line)}</text>`)
    .join("");
  const grid = [];
  for (let x = 0; x <= CARD_WIDTH; x += 96) grid.push(`M${x} 0V${CARD_HEIGHT}`);
  for (let y = 0; y <= CARD_HEIGHT; y += 84) grid.push(`M0 ${y}H${CARD_WIDTH}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071017"/><stop offset="0.55" stop-color="#0a1620"/><stop offset="1" stop-color="#041012"/></linearGradient>
<linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b1a3a"/><stop offset="1" stop-color="#2f6ea8"/></linearGradient>
</defs>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bg)"/>
<path d="${grid.join("")}" stroke="#80ff9b" stroke-opacity="0.06" stroke-width="1" fill="none"/>
<circle cx="1085" cy="385" r="235" fill="#2f6ea8" fill-opacity="0.10" stroke="#8b1a3a" stroke-opacity="0.45" stroke-width="3"/>
<circle cx="1085" cy="385" r="155" fill="none" stroke="#2f6ea8" stroke-opacity="0.55" stroke-width="2"/>
<rect x="0" y="0" width="10" height="${CARD_HEIGHT}" fill="url(#bar)"/>
<text x="${TEXT_LEFT}" y="100" font-family="${FAMILY}" font-weight="800" font-size="26" letter-spacing="4" fill="#80ff9b">${xml(String(card.kicker || "").toLocaleUpperCase("tr"))}</text>
<text x="${TEXT_LEFT}" y="143" font-family="${FAMILY}" font-weight="600" font-size="25" fill="#9fb3c0">${xml(card.sub)}</text>
${titleSvg}
<line x1="${TEXT_LEFT}" y1="511" x2="${CARD_WIDTH - 150}" y2="511" stroke="#2f6ea8" stroke-opacity="0.6" stroke-width="2"/>
<text x="${TEXT_LEFT}" y="558" font-family="${FAMILY}" font-weight="600" font-size="26" fill="#9fb3c0">${xml(card.date)}</text>
<text x="${CARD_WIDTH - 150}" y="558" text-anchor="end" font-family="${FAMILY}" font-weight="800" font-size="26" fill="#f2f7fa"><tspan fill="#80ff9b">Futbol</tspan>Radar</text>
</svg>`;
}

/** Kartı 1200×630 JPEG olarak çizer; `Buffer` döner. */
export function renderCoverJpeg(card, quality = 76) {
  const rendered = new Resvg(coverSvg(card), { ...FONT_OPTIONS, fitTo: { mode: "width", value: CARD_WIDTH } }).render();
  if (rendered.width !== CARD_WIDTH || rendered.height !== CARD_HEIGHT) {
    throw new Error(`kapak ölçüsü ${rendered.width}×${rendered.height}, beklenen ${CARD_WIDTH}×${CARD_HEIGHT}`);
  }
  return jpeg.encode({ data: rendered.pixels, width: rendered.width, height: rendered.height }, quality).data;
}
