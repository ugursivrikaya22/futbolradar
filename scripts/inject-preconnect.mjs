/**
 * DIŞ ARMA SUNUCUSUNA BAĞLANTIYI ÖNDEN ISIT.
 *
 * Ana sayfa mobilde 241 görsel bildiriyor ve neredeyse hepsi tek bir dış
 * kaynaktan geliyor: `media.api-sports.io` (kulüp armaları). Sayfada
 * hiçbir `preconnect`/`dns-prefetch` yoktu; tarayıcı ilk armaya sıra
 * gelene kadar DNS çözümlemesi, TCP el sıkışması ve TLS anlaşmasını
 * BEKLETİYORDU. Mobil bağlantıda bu üçü tipik olarak 150-300 ms.
 *
 * `preconnect` bu üç adımı belge ayrıştırılırken başlatır; ilk arma
 * istendiğinde bağlantı hazır olur. Görselleri erken indirmez, yalnızca
 * kapıyı açar — yani veri maliyeti yok.
 *
 * `dns-prefetch` de yazılıyor: `preconnect` desteklemeyen eski tarayıcılar
 * en azından DNS'i önden çözer. İkisi birlikte zararsız, tek başına
 * `dns-prefetch` daha az kazandırır.
 *
 * TEK KAYNAK: armaların adresi `data/teams.json` ve anket üreticisi
 * üzerinden geliyor; burada yalnızca ORİJİN yazılı. Sağlayıcı değişirse
 * bu sabitin de değişmesi gerekir — bu yüzden liste kısa ve açık
 * tutuluyor, "her ihtimale karşı" origin eklenmiyor: kullanılmayan bir
 * preconnect, tarayıcının bağlantı bütçesinden boşuna yer alır.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const MARKER_START = "<!-- preconnect:start -->";
const MARKER_END = "<!-- preconnect:end -->";
const BLOCK_RE = /[\t ]*<!-- preconnect:start -->[\s\S]*?<!-- preconnect:end -->\n?/g;

/** Sayfaların gerçekten görsel çektiği dış orijinler. */
const ORIGINS = ["https://media.api-sports.io"];

const BLOCK = `${MARKER_START}
${ORIGINS.map((origin) => `<link rel="preconnect" href="${origin}" crossorigin />
<link rel="dns-prefetch" href="${origin}" />`).join("\n")}
${MARKER_END}`;

const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", "work", "outputs", "public"]);

function collectHtmlFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return found;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectHtmlFiles(full));
    else if (entry.name.endsWith(".html")) found.push(full);
  }
  return found;
}

let updated = 0;
let already = 0;
let headless = 0;

for (const file of collectHtmlFiles(root)) {
  const original = fs.readFileSync(file, "utf8");

  // Önceki blok sökülür: orijin listesi değişirse eski satır kalmasın.
  const stripped = original.replace(BLOCK_RE, "");

  const headIndex = stripped.indexOf("</head>");
  if (headIndex === -1) {
    headless += 1;
    continue;
  }

  const next = stripped.slice(0, headIndex) + BLOCK + "\n" + stripped.slice(headIndex);
  if (next === original) {
    already += 1;
    continue;
  }

  fs.writeFileSync(file, next, "utf8");
  updated += 1;
}

console.log(
  `preconnect: ${updated} sayfa güncellendi, ${already} zaten güncel` +
  (headless ? `, ${headless} dosyada <head> yok` : "") +
  ` (${ORIGINS.join(", ")}).`
);
