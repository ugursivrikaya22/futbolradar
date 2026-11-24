/**
 * SAYFAYA ÖZEL KAPAK GÖRSELİ — TEK TANIM.
 *
 * Google Discover bir sayfayı öne çıkarırken en az 1200 piksel genişliğinde
 * bir görsel arar ve her sayfada aynı marka kartını (logo, ortak paylaşım
 * görseli) kapak saymaz. Haber ve köşe yazısı sayfalarının tamamı eskiden
 * `assets/og-image.png` bildiriyordu: boyut yeterliydi, ama sayfaya özgü hiçbir
 * şey taşımıyordu.
 *
 * Kapaklar `scripts/generate-cover-images.mjs` ile üretilip depoya İŞLENİR
 * (Vercel derlemesinde tarayıcı yok; bkz. `scripts/install-browser.mjs`).
 * Üretici, sayfa şablonları ve test aynı yol kuralını buradan okur; böylece
 * "sayfa bir dosya bildiriyor, dosya yok" durumu tek yerden denetlenir.
 *
 * Kapak dosyası yoksa sayfa eski ortak görsele (1200×630) düşer: yeni gelen bir
 * haber kapaksız kalsa da sayfa görselsiz ya da kırık kalmaz.
 */
import fs from "node:fs";
import path from "node:path";

export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 630;
export const COVER_DOMAIN = "https://www.futbolradar.com";
export const COVER_DIR = "assets/covers";

/** Ortak (sayfaya özgü olmayan) görseller: bunlar kapak sayılmaz. */
const GENERIC_IMAGES = new Set(["assets/og-image.svg", "assets/og-image.png"]);

export function isGenericImage(filePath) {
  const clean = String(filePath || "").replace(/^\.?\//, "");
  return !clean || GENERIC_IMAGES.has(clean);
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Haber sayfasının dosya adıyla (`haber/<slug>.html`) aynı kuralı kullanır. */
export function newsCoverSlug(article) {
  return slugify(article.slug || article.id || article.title);
}

/** Depo köküne göre kapak yolu: `assets/covers/haber/<slug>.jpg`. */
export function coverRelPath(kind, slug) {
  return `${COVER_DIR}/${kind}/${slug}.jpg`;
}

export function coverUrl(relPath) {
  return `${COVER_DOMAIN}/${relPath}`;
}

/** Kapak dosyası depoda var mı? Yoksa çağıran ortak görsele düşer. */
export function coverExists(relPath, root = process.cwd()) {
  try {
    return fs.statSync(path.join(root, relPath)).isFile();
  } catch {
    return false;
  }
}

/** JPEG başlığından ölçü (SOF işaretçisi). Okunamazsa null. */
export function readJpegSize(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) { pos += 1; continue; }
    const marker = buf[pos + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const len = buf.readUInt16BE(pos + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) };
    pos += 2 + len;
  }
  return null;
}
