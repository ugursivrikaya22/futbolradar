/**
 * JSON-LD OLMAYAN SAYFALARA TEMEL BREADCRUMB İŞARETLEMESİ EKLER.
 *
 * Neden: yapılandırılmış veri üretici script'lerin içine tek tek yazılmıştı.
 * Üreticiden geçen sayfalar (oyuncu profilleri, maç analizleri, kıyaslar,
 * haberler) BreadcrumbList taşıyor; elle yazılmış kök sayfaların bir bölümü
 * (puan durumu, takımlar, maç merkezi, gol krallığı, momentum…) hiç
 * taşımıyordu. Arama motoru bu sayfaların site içindeki yerini okuyamıyor,
 * sonuçlarda kırıntı yolu görünmüyordu.
 *
 * Bu adım UYDURMA VERİ ÜRETMEZ. Yazdığı her alan sayfanın kendisinden
 * türetilir:
 *   - konum: sayfanın kendi canonical adresi
 *   - ad:    sayfanın kendi <h1>'i, yoksa <title>'ın marka ekinden arındırılmış
 *            hâli
 * Sayfada zaten application/ld+json varsa dosyaya hiç dokunulmaz — üreticinin
 * daha zengin işaretlemesi (Article, SportsEvent, Person) her zaman kazanır.
 *
 * İdempotent: eklenen blok bir işaretle damgalanır, ikinci koşuda atlanır.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";
const MARKER = "data-futbolradar-breadcrumb";

// Google mülkiyet doğrulama dosyası birebir korunur.
const VERIFICATION_FILE = "googlef881b0d7527a8fba.html";
const SKIP = [".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs", "public", VERIFICATION_FILE];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeJsonLd(value) {
  // JSON.stringify tırnak ve ters bölü kaçışını hallediyor; burada yalnızca
  // </script> dizisinin bloğu erken kapatmasını engelliyoruz.
  return value.replace(/</g, "\\u003c");
}

/**
 * Kırıntı yolundaki ad: önce <title>'ın marka ekinden önceki bölümü,
 * yoksa <h1>.
 *
 * Sıra bilerek böyle: bu sitede <h1> çoğu sayfada bir SLOGAN, gezinme
 * etiketi değil ("Maç merkezinde günün futbol akışını tek panelden oku.").
 * Kırıntı yolunda okunması gereken ise sayfanın adı ("Maç Merkezi") ve o ad
 * <title>'ın ilk bölümünde duruyor. <h1> yalnızca başlık kullanılamazsa
 * devreye girer.
 */
function pageName(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const label = decodeEntities(title[1]).split("|")[0].replace(/\s+/g, " ").trim();
    if (label) return label;
  }

  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1) return "";
  return decodeEntities(h1[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function canonicalOf(html) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  return match ? match[1].trim() : "";
}

let injected = 0;
let skippedExisting = 0;
let skippedIncomplete = 0;

for (const file of walk(root)) {
  const html = fs.readFileSync(file, "utf8");

  if (/application\/ld\+json/i.test(html)) {
    skippedExisting += 1;
    continue;
  }
  if (!html.includes("</head>")) {
    skippedIncomplete += 1;
    continue;
  }

  const canonical = canonicalOf(html);
  const name = pageName(html);

  // Kırıntı yolu ancak sayfanın adresi ve adı gerçekten biliniyorsa yazılır.
  // Bilinmiyorsa uydurulmaz; sayfa işaretlemesiz kalır.
  if (!canonical || !canonical.startsWith(DOMAIN) || !name) {
    skippedIncomplete += 1;
    continue;
  }

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "FutbolRadar", item: `${DOMAIN}/` },
      { "@type": "ListItem", position: 2, name, item: canonical }
    ]
  };

  const block = `  <script type="application/ld+json" ${MARKER}>
    ${escapeJsonLd(JSON.stringify(breadcrumb))}
  </script>`;

  fs.writeFileSync(file, html.replace("</head>", `${block}\n  </head>`), "utf8");
  injected += 1;
}

console.log(`Breadcrumb schema checked: ${injected} page(s) gained baseline markup, ${skippedExisting} already had JSON-LD, ${skippedIncomplete} skipped (no canonical/name).`);
