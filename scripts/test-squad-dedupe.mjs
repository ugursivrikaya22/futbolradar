/**
 * Kadro tekilleştirme: aynı oyuncunun kısa ("A. Batagov") ve uzun
 * ("Arseniy Batagov") adlı kayıtları takım/kadro yüzeylerinde TEK satır
 * olmalı; tam ad gösterilmeli, mevki Türkçe ve tek tip olmalı.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  collapseDuplicates,
  positionLabelTr,
  isAbbreviatedName
} = require("../services/duplicatePlayerService.js");

let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// --- Birim: konkret çiftler ---
const fixture = [
  { id: "arseniy-batagov", name: "Arseniy Batagov", currentTeam: "Trabzonspor", position: "Stoper", providerId: "mock-arseniy-batagov", sourceUrl: "https://example.test/x", dataStatus: "verified" },
  { id: "a-batagov-trabzonspor", name: "A. Batagov", currentTeam: "Trabzonspor", position: "Defender", providerId: "63627" },
  { id: "andre-onana", name: "Andre Onana", currentTeam: "Trabzonspor", position: "Kaleci", providerId: "mock-andre-onana" },
  { id: "a-onana-trabzonspor", name: "A. Onana", currentTeam: "Trabzonspor", position: "Goalkeeper", providerId: "1234" },
  { id: "ahmet-dogan-yildirim", name: "Ahmet Doğan Yıldırım", currentTeam: "Trabzonspor", position: "Kaleci", providerId: "mock-ahmet" },
  { id: "a-yildirim-trabzonspor", name: "A. Yıldırım", currentTeam: "Trabzonspor", position: "Goalkeeper", providerId: "999" },
  // Aynı soyad, farklı ad baş harfi: BİRLEŞMEMELİ.
  { id: "barış-yilmaz", name: "Barış Alper Yılmaz", currentTeam: "Galatasaray", position: "Forvet", providerId: "mock-bay" },
  { id: "j-yilmaz-galatasaray", name: "J. Yılmaz", currentTeam: "Galatasaray", position: "Attacker", providerId: "55" },
  // Aynı ad, farklı takım: BİRLEŞMEMELİ.
  { id: "m-demir-a", name: "M. Demir", currentTeam: "Konyaspor", position: "Defender", providerId: "71" },
  { id: "mehmet-demir-b", name: "Mehmet Demir", currentTeam: "Rizespor", position: "Defender", providerId: "72" }
];

const collapsed = collapseDuplicates(fixture);
const names = collapsed.map((p) => p.name);

expect(names.filter((n) => /Batagov/.test(n)).length === 1, "Batagov tek kayıt olmalı");
expect(names.includes("Arseniy Batagov") && !names.includes("A. Batagov"), "Batagov tam adla gösterilmeli");
expect(names.filter((n) => /Onana/.test(n)).length === 1 && names.includes("Andre Onana"), "Onana tek kayıt, tam ad");
expect(names.filter((n) => /Yıldırım/.test(n)).length === 1 && names.includes("Ahmet Doğan Yıldırım"), "Yıldırım tek kayıt, tam ad");
expect(names.includes("Barış Alper Yılmaz") && names.includes("J. Yılmaz"), "farklı ad baş harfli aynı soyadlılar ayrı kalmalı");
expect(names.includes("M. Demir") && names.includes("Mehmet Demir"), "farklı takımdaki aynı soyadlılar ayrı kalmalı");

const batagov = collapsed.find((p) => /Batagov/.test(p.name));
expect(batagov.position === "Stoper", `Batagov mevkisi özgül Türkçe olmalı, bulundu "${batagov.position}"`);
expect(batagov.providerId === "63627" || batagov.mergedIds.length === 1, "gerçek sağlayıcı kimliği korunmalı ya da birleşen kimlik izlenebilmeli");

for (const p of collapsed) {
  expect(!/^(Defender|Goalkeeper|Midfielder|Attacker)$/.test(p.position), `${p.name}: İngilizce mevki kalmamalı (${p.position})`);
}

expect(positionLabelTr("Goalkeeper") === "Kaleci", "Goalkeeper → Kaleci");
expect(positionLabelTr("Defender") === "Defans", "Defender → Defans");
expect(positionLabelTr("Sag kanat") === "Sağ kanat", "Sag kanat → Sağ kanat");
expect(positionLabelTr("") === "", "boş mevki boş kalmalı");
expect(isAbbreviatedName("A. Batagov") && !isAbbreviatedName("Arseniy Batagov"), "kısaltılmış ad tespiti");

// --- Gerçek veri: hiçbir takımda kısa+uzun çift kalmamalı ---
const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const real = collapseDuplicates(raw);
expect(real.length < raw.length, "gerçek veride en az bir mükerrer birleşmeli");

const byTeam = new Map();
for (const p of real) {
  const key = String(p.currentTeam || p.team || "");
  if (!byTeam.has(key)) byTeam.set(key, []);
  byTeam.get(key).push(p);
}
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase();
for (const [team, list] of byTeam) {
  const seen = new Map();
  for (const p of list) {
    const tokens = norm(p.name).replace(/\./g, " ").split(/\s+/).filter(Boolean);
    const key = `${tokens[tokens.length - 1]}|${tokens[0].charAt(0)}`;
    if (seen.has(key)) expect(false, `${team}: "${seen.get(key)}" ve "${p.name}" hâlâ ayrı satır`);
    seen.set(key, p.name);
  }
}

// --- Yüzeyler tekilleştirmeyi gerçekten kullanıyor mu? ---
// (Üretilmiş HTML Vercel build'inde oluşuyor; burada kaynağı denetliyoruz.)
for (const file of [
  "scripts/generate-evergreen-seo-pages.mjs",
  "scripts/prerender-player-content.mjs",
  "services/providers/mockProvider.js",
  "api/squad.js"
]) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  expect(/collapseDuplicates/.test(src), `${file} collapseDuplicates kullanmalı`);
}

if (failures) {
  console.error(`${failures} test failed.`);
  process.exit(1);
}
console.log("squad dedupe tests passed");
