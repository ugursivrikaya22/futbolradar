#!/usr/bin/env node
/**
 * TAKIM KÜMESİ İÇ LİNK AĞI.
 *
 * Her takımın maç / puan durumu / form / oyuncu radarı / transfer sayfaları
 * birbirine eksik bağlanıyordu (ör. form ve oyuncu radarı sayfaları takımın
 * maç ve puan sayfasına link vermiyordu; hiçbiri Transfer Radar'a gitmiyordu).
 * Bu betik yalnızca DİSKTE VAR OLAN sayfalara link basar; metin üretmez,
 * yalnızca sayfa başlıklarını (<title>) bağlantı metni olarak kullanır.
 * İşaretli blok her çalıştırmada yeniden yazılır. `--check` yalnızca doğrular.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");
const START = "<!-- team-cluster:start -->";
const END = "<!-- team-cluster:end -->";
const BLOCK_RE = /[\t ]*<!-- team-cluster:start -->[\s\S]*?<!-- team-cluster:end -->\n?/g;
const SUFFIXES = ["maclari", "puan-durumu", "form-durumu", "oyuncu-radari", "yeni-transferleri-2026-2027", "transfer"];
const SHARED = ["super-lig-transferleri-2026-2027.html", "istatistik-merkezi.html", "gol-kralligi.html", "asist-kralligi.html"];
const NOT_TEAMS = new Set(["bugunun", "haftanin", "sampiyonlar-ligi-on-eleme", "fenerbahce-avrupa"]);

const exists = (rel) => fs.existsSync(path.join(root, rel));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function titleOf(rel) {
  const html = fs.readFileSync(path.join(root, rel), "utf8");
  const raw = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || rel)
    .replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return raw.split(/\s+[|–—]\s+FutbolRadar/i)[0].replace(/\s*\|\s*FutbolRadar\s*$/i, "").trim();
}

const teams = fs.readdirSync(root)
  .filter((f) => /-maclari\.html$/.test(f))
  .map((f) => f.replace(/-maclari\.html$/, ""))
  .filter((slug) => !NOT_TEAMS.has(slug));

let updated = 0;
let checked = 0;
const problems = [];
for (const team of teams) {
  const cluster = SUFFIXES.map((s) => `${team}-${s}.html`).filter(exists);
  if (cluster.length < 2) continue;
  const all = [...cluster, ...SHARED.filter(exists)];
  for (const page of cluster) {
    const links = all.filter((rel) => rel !== page)
      .map((rel) => `<li><a href="./${rel}">${esc(titleOf(rel))}</a></li>`).join("");
    const block = `${START}\n<nav class="team-cluster-links" aria-label="İlgili sayfalar"><h2>İlgili sayfalar</h2><ul>${links}</ul></nav>\n${END}`;
    for (const file of [path.join(root, page), path.join(root, "public", page)].filter((f) => fs.existsSync(f))) {
      const original = fs.readFileSync(file, "utf8");
      const stripped = original.replace(BLOCK_RE, "");
      if (!/[\t ]*<\/main>/i.test(stripped)) { problems.push(`${page}: </main> yok`); continue; }
      const next = stripped.replace(/[\t ]*<\/main>/i, `    ${block}\n    </main>`);
      checked += 1;
      if (next === original) continue;
      if (CHECK_ONLY) { problems.push(`${path.relative(root, file)}: takım kümesi bloğu güncel değil`); continue; }
      fs.writeFileSync(file, next, "utf8");
      updated += 1;
    }
  }
}
if (problems.length) {
  console.error("team-cluster links FAILED:");
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exitCode = 1;
} else {
  console.log(`team-cluster: ${updated} sayfa güncellendi, ${checked - updated} zaten güncel.`);
}
