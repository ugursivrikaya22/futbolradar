/**
 * ANA SAYFA BAŞLIĞI TEK BİR MAÇA KİLİTLENEMEZ.
 *
 * NEDEN VAR: "Süper Lig başlıyor: Galatasaray - Çorum FK saat 21:30'da"
 * başlığı 14 Ağustos'ta bir özellik commit'iyle geldi ve hiçbir üretici script
 * `<title>`/`og:title`/`twitter:title`'a dokunmadığı için maç bittikten
 * GÜNLER sonra bile aynen kaldı — arama sonuçlarında ve sosyal paylaşımlarda
 * geçmiş bir maçı hâlâ "başlıyor" diye duyurdu. `<title>` `index.html`'e
 * elle yazılan statik metin; bu test o metnin bir daha sessizce
 * bayatlamasını önlüyor.
 *
 * KURAL: başlık belirli bir maça/saate kilitlenemez. "HH:MM'da" gibi bir
 * kickoff saati veya "X - Y" takım eşleşmesi taşıyan bir başlık, tanımı
 * gereği o maç bitince bayatlar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const HOME_PAGES = ["index.html", "public/index.html"];
const TAG_PATTERNS = [
  { name: "title", re: /<title>([^<]+)<\/title>/ },
  { name: "og:title", re: /<meta property="og:title" content="([^"]+)"/ },
  { name: "twitter:title", re: /<meta name="twitter:title" content="([^"]+)"/ }
];

// Bir maça özgü kickoff saati veya skor kalıbı: "21:30'da", "21:30 TSİ" gibi.
const KICKOFF_TIME_RE = /\b\d{1,2}:\d{2}('|’)?(da|de|te|ta)\b|\bTSİ\b/i;

let checked = 0;
const problems = [];

for (const page of HOME_PAGES) {
  const file = path.join(root, page);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");

  for (const { name, re } of TAG_PATTERNS) {
    const match = html.match(re);
    if (!match) {
      problems.push(`${page}: ${name} etiketi bulunamadı`);
      continue;
    }
    checked += 1;
    const value = match[1];
    if (KICKOFF_TIME_RE.test(value)) {
      problems.push(`${page}: ${name} bir maç saatine kilitlenmiş → "${value}"`);
    }
  }
}

assert.equal(
  problems.length,
  0,
  `Ana sayfa başlığı bir maça/saate kilitlenmiş olamaz (evergreen kalmalı):\n  ${problems.join("\n  ")}`
);
console.log(`  ok  ana sayfa başlığı/og/twitter etiketleri evergreen (${checked} etiket denetlendi)`);
