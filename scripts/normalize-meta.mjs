#!/usr/bin/env node
/**
 * META NORMALLEŞTİRİCİ — başlık ve açıklama uzunluğu.
 *
 * Denetim 2.609 sayfada 170 karakteri aşan meta açıklama, 1.513 sayfada
 * 68 karakteri aşan başlık buldu. Google açıklamayı ~160, başlığı ~60
 * karakterde kırpıyor; taşan kuyruk SERP'te "..." olur ve tıklanma metni
 * yarıda kesilir.
 *
 * İKİ KURAL, İKİSİ DE MUHAFAZAKÂR:
 *
 *   • AÇIKLAMA 160'ı aşarsa KELİME SINIRINDAN kısaltılır. Kesim bir HTML
 *     varlığının (&...;) ortasına denk gelemez; son tam kelimeden sonra
 *     biter. og:description ve twitter:description da aynı kuraldan geçer.
 *
 *   • ROBOTS YÖNERGESİ tam olarak "index,follow" ise uzun biçime çevrilir
 *     (Discover + büyük önizleme). Yalnızca BU tam dizge eşleşir: `noindex`
 *     sayfalara ve zaten uzun yönergeye dokunulmaz.
 *
 *   • PAYLAŞIM GÖRSELİ `assets/og-image.svg` ise PNG eşine çevrilir; X,
 *     Facebook, WhatsApp ve Telegram SVG çözmüyor, bildirim geçerli olsa
 *     bile önizleme görselsiz çıkıyor. `og:image:type` da ancak sayfada
 *     SVG bildirimi kalmadığında `image/png` olur.
 *
 * SON İKİSİ NEDEN BURADA: bu depodaki sayfaların bir kısmını hiçbir
 * üretici baştan yazmıyor — örneğin
 * `generate-broadcast-schedule-page.mjs` mevcut HTML'i okuyup yalnızca
 * başlık ve açıklama alanlarını yerinde yamalıyor. O sayfalarda `robots`
 * ve `og:image` depodaki dosyadan geliyor. Şablonları düzeltmek onlara
 * ulaşmıyor; HTML'i bir kez süpürmek ise SONRADAN eklenen sayfayı
 * kapsamıyor (#248'in yayın sayfası tam bu yüzden eski yönergeyle doğdu).
 * Zincirin sonundaki bu adım her koşuda tüm sayfalardan geçtiği için
 * kural kendini onarır.
 *
 *   • BAŞLIK 68'i aşarsa yalnızca " | FutbolRadar" markalama eki düşer —
 *     içerik kısmına DOKUNULMAZ. Ek düştükten sonra hâlâ uzunsa öyle
 *     bırakılır: başlığı körlemesine kırpmak anlamı bozar, uzun başlık
 *     bozuk başlıktan iyidir. Marka og:site_name'de zaten taşınıyor.
 *
 * İdempotent: normalize edilmiş sayfada ikinci koşu sıfır değişiklik.
 */
import fs from "node:fs";
import path from "node:path";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const root = process.cwd();
const DESC_MAX = 160;
const TITLE_MAX = 68;
const BRAND_SUFFIX = " | FutbolRadar";
const SHARE_PNG = "assets/og-image.png";

const SKIP_DIRS = new Set([".git", ".vercel", "node_modules", "scripts", "services", "server", "api", "docs", "lib", "components", "editorial", "locales", "data", "assets", "work", "outputs"]);

function clampDescription(text) {
  if (text.length <= DESC_MAX) return text;
  let cut = text.slice(0, DESC_MAX + 1);
  // Varlık ortasında kesme: sondaki tamamlanmamış &...; kuyruğunu at.
  cut = cut.replace(/&[a-zA-Z#0-9]*$/, "");
  // Kelime sınırı: son boşluğa çekil, sarkan noktalama temizlenir.
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > DESC_MAX * 0.6) cut = cut.slice(0, lastSpace);
  return cut.replace(/[,;:\s]+$/, "").trimEnd() + (cut.endsWith(".") ? "" : ".");
}

function normalize(html) {
  let out = html;

  out = out.replace(
    /(<meta (?:name="(?:description|twitter:description)"|property="og:description") content=")([^"]{161,})(")/g,
    (m, open, value, close) => open + clampDescription(value) + close
  );

  out = out.replace(/<title>([^<]{69,})<\/title>/, (m, value) => {
    if (value.endsWith(BRAND_SUFFIX)) {
      const bare = value.slice(0, -BRAND_SUFFIX.length);
      return `<title>${bare}</title>`;
    }
    return m;
  });

  // Yalnızca TAM eşleşme: içeriği "index,follow" olan etiket. `noindex`
  // damgalı istemci kabukları ve zaten uzun yönergeyi taşıyan sayfalar
  // bu desene uymaz, dokunulmaz.
  out = out.replace(
    /(<meta name="robots" content=")index,follow("\s*\/?>)/g,
    (m, open, close) => open + ROBOTS_INDEX + close
  );

  // Paylaşım bildirimi SVG göstermesin.
  out = out.replace(
    /(<meta (?:property="og:image"|name="twitter:image") content="[^"]*)assets\/og-image\.svg(")/g,
    (m, open, close) => open + SHARE_PNG + close
  );
  // JSON-LD görselleri de SVG gösteremez (Google yapısal veri görsellerinde
  // SVG kabul etmiyor); publisher logosu ve article görseli aynı PNG'ye döner.
  out = out.replace(
    /(<script type="application\/ld\+json">[\s\S]*?<\/script>)/g,
    (block) => block.split("assets/og-image.svg").join(SHARE_PNG)
  );

  // Kap bildirimi ancak sayfada SVG paylaşım bildirimi KALMADIYSA
  // düzeltilir; başka bir SVG görseli bildiren sayfada yanlış kap yazmayalım.
  if (!/<meta (?:property="og:image"|name="twitter:image") content="[^"]*\.svg"/.test(out)) {
    out = out.replace(
      /(<meta property="og:image:type" content=")image\/svg\+xml(")/g,
      (m, open, close) => open + "image/png" + close
    );
  }

  return out;
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".html")) files.push(full);
  }
})(root);

let updated = 0;
for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const next = normalize(html);
  if (next !== html) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}
console.log(`normalize-meta: ${updated}/${files.length} sayfa güncellendi (açıklama ≤${DESC_MAX}, başlık eki kuralı).`);
