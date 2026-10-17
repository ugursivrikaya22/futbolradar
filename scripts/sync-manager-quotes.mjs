#!/usr/bin/env node
/**
 * MAÇ SONU AÇIKLAMALARINI OTOMATİK TOPLA.
 *
 * Kural burada DEĞİL: hangi başlığın yayımlanabilir bir alıntı taşıdığına
 * services/quoteHarvest.js karar veriyor (tırnak zorunlu, kişi kadro/teknik
 * direktör listesinden ARANIR, maç zaman penceresiyle bağlanır, belirsizlik
 * reddedilir). Bu dosya yalnızca besleme çekiyor, kuralı uyguluyor ve
 * sonucu yazıyor.
 *
 * NEDEN BAŞLIK, NEDEN MAKALE GÖVDESİ DEĞİL. Gövdeyi kazımak iki nedenle
 * reddedildi: (1) Türk spor sitelerinin çoğu makale gövdesine bot erişimini
 * engelliyor (fotomac.com.tr 403 ölçüldü) — okunamayan bir sayfadan
 * "doğrulanmış alıntı" çıkarılamaz; (2) gövdede birden çok kişi konuşuyor ve
 * dolaylı anlatım ile doğrudan alıntı iç içe geçiyor, hangi cümlenin kime
 * ait olduğu ancak YORUMLA çıkar. Başlığın "Kişi: \"cümle\"" kalıbı ise
 * yapısal; yorum gerektirmeyen tek yer orası.
 *
 * BU BETİK AZ KAYIT ÜRETİR VE BU BİR KUSUR DEĞİL. Elde edilen her kayıt üç
 * ayrı mekanik kanıttan geçmiş oluyor. Şerit boş kalırsa "Kaynaklardan
 * bekleniyor" der; uydurma bir alıntıdan iyidir.
 *
 * Kullanım:
 *   node scripts/sync-manager-quotes.mjs            # dry-run, sadece rapor
 *   node scripts/sync-manager-quotes.mjs --apply    # dosyaya yaz
 *   node scripts/sync-manager-quotes.mjs --verbose  # ret gerekçelerini bas
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildSpeakerIndex,
  harvestQuote,
  mergeHarvestedQuotes,
  verifyQuoteInBody
} = require("../services/quoteHarvest.js");
const { isFinishedStatus } = require("../services/matchStatus.js");
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");

const root = process.cwd();
const OUTPUT_PATH = path.join(root, "data", "manager-quotes.json");
const PUBLIC_OUTPUT_PATH = path.join(root, "public", "data", "manager-quotes.json");
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_RETRIES = 2;
const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

/** Besleme başına okunacak en fazla öğe: tek kaynak listeyi kaplamasın. */
const INTAKE_PER_FEED = 40;

/**
 * Makale gövdesi çekilirken kullanılan tarayıcı kimliği. Varsayılan Node
 * kimliğiyle birçok Türk spor sitesi 403 dönüyor ve okunamayan sayfa
 * doğrulanamıyor. Kimlik gizlenmiyor, yalnızca yaygın bir tarayıcı beyan
 * ediliyor; istek hızı da beslemedeki aday sayısıyla (tipik olarak tek
 * haneli) kendiliğinden sınırlı.
 */
const ARTICLE_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function googleNewsUrl(query) {
  const params = new URLSearchParams({ q: query, hl: "tr", gl: "TR", ceid: "TR:tr" });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

/**
 * BESLEMELER — İKİ MEKANİZMA.
 *
 * Doğrudan RSS veren Türk spor beslemeleri (scripts/sync-football-news.mjs'te
 * zaten ölçülüp çalıştığı doğrulanmış olanlar) ilk sırada: gerçek makale
 * adresini veriyorlar. Alıntı başlıkları asıl olarak buralarda çıkıyor.
 *
 * İkinci mekanizma Google News araması. Alıntı başlıkları belirli bir kalıbı
 * izlediği için ("Kişi: \"cümle\"") arama, tırnak işareti ve takım adıyla
 * daraltılıyor. Google News, RSS yayınlamayan ya da otomatik erişimi
 * engelleyen kaynaklara (Sporx, Ajansspor, Fanatik) tek meşru yol.
 */
const DIRECT_FEEDS = [
  { id: "trt-haber", url: "https://www.trthaber.com/spor_articles.rss", name: "TRT Haber" },
  { id: "hurriyet-spor", url: "https://www.hurriyet.com.tr/rss/spor", name: "Hürriyet" },
  { id: "fotomac", url: "https://www.fotomac.com.tr/rss/anasayfa.xml", name: "Fotomaç" },
  { id: "sabah-spor", url: "https://www.sabah.com.tr/rss/spor.xml", name: "Sabah" },
  { id: "aa-spor", url: "https://www.aa.com.tr/tr/rss/default?cat=spor", name: "Anadolu Ajansı" }
];

/**
 * Arama beslemeleri takım adı üzerinden kurulur. Teknik direktör adıyla
 * aramak daha isabetli görünüyor ama listeyi teknik direktör
 * DEĞİŞİKLİKLERİNE bağımlı kılar; takım adı sabittir ve kişi zaten
 * kadro/teknik direktör listesinden çözülüyor.
 */
function searchFeeds(teams) {
  return teams.map((team) => ({
    id: `arama-${team.toLocaleLowerCase("tr").replace(/\s+/g, "-")}`,
    url: googleNewsUrl(`"${team}" maç sonu açıklama`),
    name: "",
    scope: "search"
  }));
}

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code.replace(/^x/i, ""), /^x/i.test(code) ? 16 : 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .trim();
}

function tagValue(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function sourceFromBlock(block) {
  const match = String(block).match(/<source(?:\s+url=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/source>/i);
  return match ? { url: decodeXml(match[1]), name: decodeXml(match[2]) } : { url: "", name: "" };
}

function parseRss(xml, feed = {}) {
  const blocks = [...String(xml || "").matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => match[2]);

  return blocks.map((block) => {
    const source = sourceFromBlock(block);
    const atomLink = String(block).match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
    return {
      title: tagValue(block, "title"),
      link: tagValue(block, "link") || decodeXml(atomLink && atomLink[1]),
      publishedAt: tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated"),
      // Google News aramasında yayın organı <source> etiketinde; doğrudan
      // beslemede beslemenin kendisi yayın organıdır.
      sourceName: source.name || feed.name || "",
      feedId: feed.id
    };
  }).filter((item) => item.title && item.link);
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * KAYNAK BEYAZ LİSTESİ ZORUNLU.
 *
 * Kapı services/sourceLinks.js'te ve bu depoda yayımlanan HER dış bağlantı
 * oradan geçiyor; test-source-links onu denetliyor. Listede olmayan bir alan
 * adı buraya sızarsa derleme zaten kırmızıya döner — ama o noktada kayıt
 * dosyaya girmiş olur. Aynı kapıyı burada da tutuyoruz ki hiç girmesin.
 *
 * Kontrol YENİDEN YAZILMIYOR, servisin kendi işlevi çağrılıyor: alt alan adı
 * kuralının ("spor.hurriyet.com.tr" kabul, "hurriyet.com.tr.kotu.site" ret)
 * iki ayrı kopyası olsaydı biri gevşerdi.
 */

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_RETRIES + 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt <= REQUEST_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * Makale gövdesini çeker. RSS çekiminden ayrı: kabul başlığı HTML ve
 * tarayıcı kimliği gerekiyor — birçok Türk spor sitesi varsayılan Node
 * kimliğine 403 dönüyor. Erişilemeyen sayfa doğrulanmış sayılmaz ve kayıt
 * elenir; "okuyamadım ama herhâlde doğrudur" bir doğrulama değildir.
 */
async function fetchArticle(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "tr-TR,tr;q=0.9",
        "user-agent": ARTICLE_USER_AGENT
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

async function main() {
  const managers = readJson("data/managers.json", { managers: [] });
  const squads = readJson("data/super-lig-squads.json", []);
  const calendar = readJson("data/fixture-calendar.json", { matches: [] });
  const curated = readJson("data/matches.json", []);

  const speakerIndex = buildSpeakerIndex({ managers, squads });
  if (!speakerIndex.size) {
    console.error("Alıntı toplama iptal: konuşan kişi dizini boş (managers.json / super-lig-squads.json okunamadı).");
    process.exitCode = 1;
    return;
  }

  const fixtures = [
    ...(Array.isArray(calendar) ? calendar : calendar.matches || []),
    ...(Array.isArray(curated) ? curated : curated.matches || [])
  ].filter(Boolean);

  const teams = [...new Set(
    (Array.isArray(squads) ? squads : Object.values(squads))
      .map((squad) => String((squad && squad.teamName) || "").trim())
      .filter(Boolean)
  )];

  const feeds = [...DIRECT_FEEDS, ...searchFeeds(teams)];
  const now = new Date().toISOString();

  const candidates = [];
  const failures = [];

  for (const feed of feeds) {
    try {
      const xml = await fetchText(feed.url);
      candidates.push(...parseRss(xml, feed).slice(0, INTAKE_PER_FEED));
    } catch (error) {
      failures.push(`${feed.id}: ${error.message}`);
    }
  }

  if (!candidates.length) {
    console.error(`Alıntı toplama iptal: hiçbir beslemeden öğe alınamadı (${failures.length} hata).`);
    if (failures.length) console.error(failures.slice(0, 5).join("\n"));
    process.exitCode = failures.length ? 1 : 0;
    return;
  }

  const harvested = [];
  const rejected = [];

  for (const item of candidates) {
    const host = hostOf(item.link);
    if (!isAllowedSourceUrl(item.link)) {
      rejected.push({ item, reason: `kaynak beyaz listede değil: ${host || "(adres okunamadı)"}` });
      continue;
    }
    // Google News araması yayın organını <source> etiketinde veriyor; boşsa
    // alan adına düşülür — "kaynak adı yok" diye elemek yerine izlenebilir
    // bir ad üretmek doğru, çünkü ad zaten bağlantıdan geliyor.
    const named = { ...item, sourceName: item.sourceName || host };
    const verdict = harvestQuote(named, { speakerIndex, fixtures, isFinished: isFinishedStatus, now });
    if (verdict.error) {
      rejected.push({ item: named, reason: verdict.error });
      continue;
    }

    // DÖRDÜNCÜ KAPI — başlık tek başına kanıt değil.
    //
    // Yayın organı başlığa sıkıştırılmış bir alıntı koyup onu yine tırnak
    // içinde veriyor. Cümle makalenin gövdesinde de geçmiyorsa, tırnak içinde
    // yayımladığımız şey konuşanın kurduğu cümle değil gazetecinin özeti olur.
    // Yalnızca buraya kadar gelen bir avuç aday için istek atılıyor.
    let body = "";
    try {
      body = await fetchArticle(verdict.quote.source.url);
    } catch (error) {
      rejected.push({ item: named, reason: `makale okunamadı: ${error.message}` });
      continue;
    }

    const inBody = verifyQuoteInBody(verdict.quote.quote, body);
    if (inBody.error) {
      rejected.push({ item: named, reason: inBody.error });
      continue;
    }

    harvested.push({
      ...verdict.quote,
      automation: { ...verdict.quote.automation, verifiedInBody: true }
    });
  }

  const store = readJson("data/manager-quotes.json", { quotes: [] });
  const merged = mergeHarvestedQuotes(store, harvested);

  console.log(
    `Alıntı toplama: ${candidates.length} başlık okundu, ${harvested.length} yayımlanabilir alıntı, ` +
    `${merged.added.length} yeni kayıt, ${rejected.length} elendi, ${failures.length} besleme hatası.`
  );

  for (const quote of merged.added) {
    console.log(`  + [${quote.matchId}] ${quote.speaker} (${quote.role}, ${quote.team}) — ${quote.source.name}`);
  }

  if (VERBOSE) {
    // Ret gerekçeleri gruplanır: 300 satır "kalıp yok" okumak yerine hangi
    // kuralın ne kadar elediği görülür.
    const byReason = new Map();
    for (const row of rejected) {
      const key = String(row.reason).replace(/"[^"]*"/g, '"…"').replace(/\([^)]*\)/g, "(…)");
      byReason.set(key, (byReason.get(key) || 0) + 1);
    }
    console.log("  ret gerekçeleri:");
    for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(4)} × ${reason}`);
    }
    if (failures.length) console.log(`  besleme hataları:\n    ${failures.join("\n    ")}`);
  }

  if (!APPLY) {
    console.log("Dry run — yazmak için --apply kullanın.");
    return;
  }

  if (!merged.added.length) {
    console.log("Yeni kayıt yok, dosya yeniden yazılmadı.");
    return;
  }

  const output = { ...(Array.isArray(store) ? {} : store), quotes: merged.quotes };
  atomicWrite(OUTPUT_PATH, output);
  if (fs.existsSync(path.dirname(PUBLIC_OUTPUT_PATH))) atomicWrite(PUBLIC_OUTPUT_PATH, output);
  console.log(`data/manager-quotes.json yazıldı (${merged.quotes.length} kayıt).`);
}

main().catch((error) => {
  console.error(`Alıntı toplama başarısız: ${error.message}`);
  process.exitCode = 1;
});
