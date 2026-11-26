/**
 * TÜRKÇE KARAKTER BEKÇİSİ.
 *
 * Sayfa başlığı, meta açıklama ve sayfa içi metinde ASCII'ye düşmüş Türkçe
 * sözcükler ("Oyunculari", "degeri", "gecmisi" ...) hem okura hem arama
 * sonuçlarına kötü görünür. Bu test iki şeyi korur:
 *
 *   1. Üretici/şablon kaynaklarında bilinen bozuk yazımlar geri gelmesin.
 *   2. Üretilmiş sayfaların GÖRÜNEN metninde (etiket ve öznitelik değerleri
 *      hariç — slug/href'ler ASCII kalmalı) aşağıdaki sözcükler bulunmasın.
 *
 * Liste bilerek DAR: yalnızca Türkçe'de tek anlamlı, kişi/kulüp adıyla
 * karışmayan sözcükler. Yeni bir sızıntı bulunursa buraya eklenir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROVIDER_NAME_FIXES, fixProviderTurkishName } from "./lib/turkishNames.mjs";

const root = process.cwd();

// Kural dışı: ASCII yazımı (anahtar) → doğrusu. Yalnızca görünen metinde aranır.
const BAD_WORDS = {
  oyunculari: "oyuncuları", degeri: "değeri", degerler: "değerler", gecmisi: "geçmişi",
  guvenilirligiyle: "güvenilirliğiyle", durumlari: "durumları", gruplari: "grupları",
  farkli: "farklı", kartlarindaki: "kartlarındaki", yaraticilik: "yaratıcılık",
  yukselen: "yükselen", artisi: "artışı", akilli: "akıllı", eslesme: "eşleşme",
  eslesmesi: "eşleşmesi", eslesmeleri: "eşleşmeleri", sinavi: "sınavı", yakinligi: "yakınlığı",
  yakinda: "yakında", bulunamadi: "bulunamadı", hazirlanir: "hazırlanır", yakinligina: "yakınlığına",
  karsilastirma: "karşılaştırma", karsilastirmalari: "karşılaştırmaları", guncelleme: "güncelleme",
  aciklanmadi: "açıklanmadı", olustugunda: "oluştuğunda", genisleyecek: "genişleyecek"
};
// Başlık/meta/h1'de ayrıca aranan (büyük harfli) kalıplar.
const BAD_PHRASES = ["En Iyi ", "Genc Yetenekler", "Yukselen Oyuncular", "Savunma Radari", "Pres Radari", "Performans Radari", "Oyuncu Radari "];

// haber/ ve kose-yazilari/ dış kaynaktan ya da editör elinden gelen serbest metindir; şablon bekçisi onlara bakmaz.
const SKIP_DIRS = new Set([".git", "node_modules", "public", "en", "data", "tests", "scripts", "docs", "haber", "kose-yazilari"]);
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".html")) files.push(full);
  }
  return files;
}

function visibleText(html) {
  return html
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#0?39;|&apos;/g, "'");
}
function headText(html) {
  const out = [];
  for (const m of html.matchAll(/<title>([^<]*)<\/title>/gi)) out.push(m[1]);
  for (const m of html.matchAll(/<meta[^>]+(?:name|property)="(?:description|og:title|og:description|twitter:title|twitter:description)"[^>]+content="([^"]*)"/gi)) out.push(m[1]);
  for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) out.push(m[1].replace(/<[^>]+>/g, ""));
  return out.join(" | ");
}

const wordRx = new RegExp(`(?<![\\p{L}-])(${Object.keys(BAD_WORDS).join("|")})(?![\\p{L}-])`, "giu");
const problems = [];
const files = walk(root);
assert.ok(files.length > 500, `sayfalar taranmalı; bulunan: ${files.length}`);
for (const file of files) {
  const rel = path.relative(root, file);
  const html = fs.readFileSync(file, "utf8");
  const head = headText(html);
  for (const phrase of BAD_PHRASES) if (head.includes(phrase)) problems.push(`${rel}: başlık/meta "${phrase.trim()}"`);
  // Oyuncu adı gibi veri alanları (mac-raporu/mac vb.) şablon sözcüklerini içermez; hepsi taranır.
  const text = `${head} ${visibleText(html)}`;
  const seen = new Set();
  for (const m of text.matchAll(wordRx)) {
    const w = m[1].toLowerCase();
    if (seen.has(w)) continue;
    seen.add(w);
    problems.push(`${rel}: "${m[1]}" → "${BAD_WORDS[w]}"`);
  }
}
assert.equal(problems.length, 0, `ASCII'ye düşmüş Türkçe sözcükler (${problems.length}):\n${problems.slice(0, 40).join("\n")}`);

// Kaynak koruması: bozuk yazım şablonlara geri dönmesin.
const SOURCES = ["app.js", "services/playerComparisonPairs.js", "scripts/generate-static-seo-pages.mjs", "scripts/generate-player-comparison-pages.mjs", "scripts/prerender-player-content.mjs"];
const SOURCE_BAD = ["Akilli eslesme", "Rating sinavi", "Overall farkini", "piyasa yakinligi", "En Iyi Forvetler", "En Iyi Defanslar", "En Iyi Orta", "En Iyi Kaleciler", "Yukselen Oyuncular |", "Genc Yetenekler |", "Oyuncu bulunamadi", "Karsilastirma Merkezi", "Radar kartini paylas", "Scouting Ozeti", "Profil Ozeti"];
for (const src of SOURCES) {
  const text = fs.readFileSync(path.join(root, src), "utf8");
  for (const bad of SOURCE_BAD) assert.ok(!text.includes(bad), `${src}: bozuk yazım geri gelmiş: "${bad}"`);
}

// Sağlayıcı ad düzeltmeleri.
assert.equal(fixProviderTurkishName("Türkiye Kupasi"), "Türkiye Kupası");
assert.equal(fixProviderTurkishName("Bodrum Ilce Stadi"), "Bodrum İlçe Stadı");
assert.equal(fixProviderTurkishName("2.Lig Kirmizi"), "2.Lig Kırmızı");
assert.equal(fixProviderTurkishName("Süper Lig"), "Süper Lig");
assert.ok(PROVIDER_NAME_FIXES.length >= 3);

console.log(`Türkçe karakter testleri geçti (${files.length} sayfa tarandı).`);
