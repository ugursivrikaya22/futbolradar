/**
 * PAYLAŞILAN İSKELETİ TÜM SAYFALARA UYGULA
 * ----------------------------------------------------------------------------
 * Neden: başlık/alt bilgi işaretlemesi 6 üretici script ve 61 kök HTML dosyası
 * içinde kopyalanmıştı; sayfalar arasında menü farklılaşmıştı. Bu adım derleme
 * sırasında `scripts/lib/layout.mjs` çıktısını üretilmiş tüm HTML'e yazar,
 * böylece ~900 sayfa tek tasarım diline sahip olur.
 *
 * Yalnızca `<header class="topbar">…</header>` ve `<footer class="footer">…
 * </footer>` blokları değiştirilir; sayfa içeriğine dokunulmaz.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter, newsTicker } from "./lib/layout.mjs";
import { buildTickerFeed } from "./lib/tickerFeed.mjs";
import { buildEnTickerItems } from "./lib/enTicker.mjs";
import { liveTickerBlock, LIVE_TICKER_PAGES } from "./lib/liveScoresTicker.mjs";

const { counterpartPath, localeOfPath } = createRequire(import.meta.url)("../services/i18n.js");
const { selectLiveTickerRecords } = createRequire(import.meta.url)("../services/liveScoresTicker.js");
const { curatedMatches } = createRequire(import.meta.url)("../services/providers/mockProvider.js");

const root = process.cwd();
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

const HEADER_RE = /<header\b[^>]*class="[^"]*\btopbar\b[^"]*"[^>]*>[\s\S]*?<\/header>/i;
const FOOTER_RE = /<footer\b[^>]*class="[^"]*\bfooter\b[^"]*"[^>]*>[\s\S]*?<\/footer>/i;
const TICKER_RE = /[\t ]*<!-- shared-layout:ticker:start -->[\s\S]*?<!-- shared-layout:ticker:end -->\n?/g;
const LIVE_TICKER_RE = /[\t ]*<!-- shared-layout:live-ticker:start -->[\s\S]*?<!-- shared-layout:live-ticker:end -->\n?/g;
// Eski transfer bandının işaretçisi: bir önceki derlemenin bandı hâlâ
// sayfada duruyor olabilir, bu geçiş derlemesinde de temizlenir.
const LEGACY_TRANSFER_TICKER_RE = /[\t ]*<!-- shared-layout:transfer-ticker:start -->[\s\S]*?<!-- shared-layout:transfer-ticker:end -->\n?/g;

function readGeneratedFile(file) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
  return "";
}

function writeGeneratedFile(file, contents) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
  } catch {
    return null;
  }
}

function asArray(payload, ...keys) {
  if (Array.isArray(payload)) {
    return payload;
  }
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) {
      return payload[key];
    }
  }
  return [];
}

function istanbulToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
}

/**
 * Banttaki içerik: önce günün tamamlanan/canlı maç sonuçları (en taze bilgi),
 * ardından doğrulanmış haber akışı. Uydurma başlık üretilmez; yalnızca
 * veri dosyalarında zaten doğrulanmış kayıtlar kullanılır.
 */

/** Bant öğelerinin göreli bağlantıları sayfa derinliğine göre yeniden yazılır. */
function rebaseItems(items, base) {
  return items.map((item) => ({
    ...item,
    href: /^https?:/i.test(item.href) ? item.href : `${base}${item.href}`
  }));
}

function collectHtmlFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      found.push(full);
    }
  }

  return found;
}

function siteRootFor(file) {
  const relative = path.relative(root, file);
  return relative.startsWith(`public${path.sep}`) ? path.join(root, "public") : root;
}

/** Kökte "./", bir klasör altta "../" gibi göreli önek üretir. */
function baseFor(file) {
  const depth = path.relative(siteRootFor(file), file).split(path.sep).length - 1;
  return depth <= 0 ? "./" : "../".repeat(depth);
}

// Bant doğrulanmış kaynaklardan beslenir (maç sonuçları, onaylı transferler,
// doğrulanmış editoryal haberler) ve tazelik denetiminden geçer: rozet ancak
// gerçekten taze bir öğe varsa "Son Dakika" olur.
const tickerFeed = buildTickerFeed();
const tickerItems = tickerFeed.items;
const enTickerItems = buildEnTickerItems();

// Bandın hangi sayfalarda çıkacağı scripts/lib/liveScoresTicker.mjs'te —
// enjeksiyon ve test aynı listeyi oradan okur.
const LIVE_TICKER_PAGE_SET = new Set(LIVE_TICKER_PAGES);

// Seçim servistedir (services/liveScoresTicker.js); burada yalnızca derleme
// anındaki maç anlık görüntüsü okunur. TR/EN aynı kayıtları taşır — canlı
// skor bir çeviri sorunu değil, takım/lig adları zaten katalogdan geliyor.
const liveRecords = selectLiveTickerRecords(curatedMatches());

const files = [...collectHtmlFiles(root), ...collectHtmlFiles(path.join(root, "public"))]
  .filter((file) => !path.relative(root, file).startsWith("node_modules"));

let updated = 0;
let skipped = 0;

for (const file of files) {
  const original = readGeneratedFile(file);

  if (!HEADER_RE.test(original) && !FOOTER_RE.test(original)) {
    skipped += 1;
    continue;
  }

  const base = baseFor(file);
  const sitePath = path.relative(siteRootFor(file), file).split(path.sep).join("/");
  const locale = localeOfPath(sitePath);
  // Dil kutusu AYNI SAYFANIN karşılığına gider; karşılığı olmayan sayfalarda
  // (7.900 üretilmiş sayfanın büyük kısmı) hedef dilin ana sayfası güvenli
  // yedektir. Kullanıcıyı alakasız bir sayfaya atmaktansa dilin girişine
  // götürmek dürüst davranıştır.
  const altHref = counterpartPath(sitePath, locale === "en" ? "tr" : "en");

  // İngilizce bant aynı bileşenden çizilir ama Türkçe editoryal başlıklar
  // yerine yapısal veriden üretilmiş İngilizce öğeler taşır (enTicker.mjs):
  // Türkçe serbest metin çevrilmeden İngilizce sayfaya giremez, bandın
  // yokluğu ise iki sürüm arasındaki tasarım eşitliğini bozuyordu.
  const ticker = locale === "en"
    ? newsTicker({ base, locale, items: rebaseItems(enTickerItems, base) })
    : newsTicker({ base, items: rebaseItems(tickerItems, base), badge: tickerFeed.badge });
  // Canlı skor bandı haber bandının ALTINA girer ve yalnızca listedeki
  // sayfalara. Ana sayfalarda bant zaten sayfanın KENDİ işaretlemesinde;
  // oraya ikinci bir kopya basılmaz.
  //
  // "Sayfanın kendi bandı var mı" sorusu, bu scriptin daha önce bastığı blok
  // ÇIKARILDIKTAN SONRA sorulur — aksi hâlde derleme idempotan olmazdı
  // (bkz. eski transfer bandındaki aynı gerekçe).
  const unmanaged = original.replace(LIVE_TICKER_RE, "").replace(LEGACY_TRANSFER_TICKER_RE, "");
  const wantsLiveTicker = LIVE_TICKER_PAGE_SET.has(sitePath)
    && !unmanaged.includes('data-component="LiveScoresTicker"');
  const liveTicker = wantsLiveTicker
    // `keepEmpty`: canlı maç yoksa bant kaybolmaz. Transfer bandı bu
    // sayfalarda veri yokken hiç basılmıyordu (3 günlük transfer penceresi
    // neredeyse hiç boş kalmadığı için sorun görünmüyordu) — ama "canlı"
    // doğası gereği günün büyük bölümünde SIFIR maç demektir; bant her
    // derlemede belirip kaybolsaydı hem kararsız bir tasarım olurdu hem de
    // sayfa kapsamı testi (hangi sayfada bant var) derleme anına bağlı
    // hâle gelirdi. Ana sayfalarla AYNI kural: yoksa "şu anda canlı maç
    // yok" mesajı, hiç kaybolmaz.
    ? liveTickerBlock(liveRecords, { locale, base, keepEmpty: true })
    : "";

  const headerBlock = [
    siteHeader({ base, locale, altHref }),
    ticker ? `\n      <!-- shared-layout:ticker:start -->${ticker}<!-- shared-layout:ticker:end -->` : "",
    liveTicker ? `\n      <!-- shared-layout:live-ticker:start -->${liveTicker}<!-- shared-layout:live-ticker:end -->` : ""
  ].join("");

  let next = original.replace(LIVE_TICKER_RE, "").replace(LEGACY_TRANSFER_TICKER_RE, "");
  next = next.replace(TICKER_RE, "");
  next = next.replace(HEADER_RE, () => headerBlock);
  next = next.replace(FOOTER_RE, () => siteFooter({ base, locale }));

  if (next !== original) {
    writeGeneratedFile(file, next);
    updated += 1;
  }
}

console.log(
  `Shared layout applied: ${updated} updated, ${skipped} without layout blocks, ` +
  `${tickerItems.length} ticker items (${tickerFeed.badge}` +
  `${tickerFeed.usedFallback ? ", son doğrulanmış içerik korundu" : ""})`
);
