/**
 * CANLI SKORLAR BANDI TESTLERİ.
 *
 * Transfer Radarı bandının yerini alan yeni bant. Kural TEK ve MUTLAK:
 * yalnızca ŞU AN OYNANAN maçlar banda girer — başlamamış, bitmiş,
 * ertelenen ya da iptal edilen hiçbir kayıt buraya düşmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  MAX_ITEMS,
  isCurrentlyLive,
  minuteOrStatusLabel,
  selectLiveTickerRecords
} = require("../services/liveScoresTicker.js");

/**
 * SABİT "ŞİMDİ" — tazelik kapıları sunucu zamanına göre karar verdiği için
 * testin kendi anı sabit olmalı; yoksa aynı fikstür saatine göre bir gün
 * geçip ertesi gün kalırdı.
 */
const NOW = Date.parse("2026-09-11T21:30:00+03:00");

/** Şu anda oynanan bir maçın başlama saati (yarım saat önce). */
const FRESH_KICKOFF = new Date(NOW - 30 * 60 * 1000).toISOString();

function match(fields) {
  return {
    id: "m1",
    homeTeam: "Ev Takımı",
    awayTeam: "Deplasman",
    league: "Süper Lig",
    competitionId: "super-lig",
    score: { home: 0, away: 0 },
    status: "LIVE",
    // BAŞLAMA SAATİ ARTIK ZORUNLU: saatsiz bir kayıt canlılığını
    // doğrulayamaz ve banda giremez (services/matchStatus.js#liveVerdict,
    // "live-without-clock" kapısı). Eskiden fikstürlerin saati yoktu ve
    // bant hiçbir zaman kontrolü yapmadığı için hepsi canlı sayılıyordu.
    kickoff: FRESH_KICKOFF,
    ...fields
  };
}

function selectLiveTickerRecordsNow(rows, options = {}) {
  return selectLiveTickerRecords(rows, { nowMs: NOW, ...options });
}

// ── 1. Yalnızca ŞU AN oynanan maçlar banda girer ────────────────────────────

{
  const rows = [
    match({ id: "live-1h", status: "1H" }),
    match({ id: "live-ht", status: "HT" }),
    match({ id: "scheduled", status: "SCHEDULED" }),
    match({ id: "finished", status: "FINISHED", score: { home: 2, away: 1 } }),
    match({ id: "postponed", status: "POSTPONED" }),
    match({ id: "cancelled", status: "CANCELLED" })
  ];

  const selected = selectLiveTickerRecordsNow(rows).map((item) => item.id);
  assert.deepEqual(selected.sort(), ["live-1h", "live-ht"].sort(), "yalnızca oynanan maçlar banda girmeli");

  assert.equal(isCurrentlyLive(match({ status: "SCHEDULED" }), NOW), false, "başlamamış maç canlı sayılmamalı");
  assert.equal(isCurrentlyLive(match({ status: "FINISHED" }), NOW), false, "bitmiş maç canlı sayılmamalı");
  assert.equal(isCurrentlyLive(match({ status: "POSTPONED" }), NOW), false, "ertelenen maç canlı sayılmamalı");
  assert.equal(isCurrentlyLive(match({ status: "HT" }), NOW), true, "devre arası hâlâ canlı sayılmalı (maç sürüyor)");
  assert.equal(isCurrentlyLive(match({ status: "LIVE" }), NOW), true, "canlı maç canlı sayılmalı");
}

// ── 1b. BAYAT/DONMUŞ "CANLI" KAYIT BANDA KALAMAZ ───────────────────────────
//
// Bandın HİÇ zaman kontrolü yoktu: sağlayıcı bir maçı "FINISHED"e
// çevirmezse o maç günlerce "89'" yazarak kayıyordu. Ana sayfada beş gün
// önce oynanmış maçların bandı buydu.

{
  const stale = [
    // Dünkü maç — hiçbir koşulda bugün canlı değil.
    match({ id: "dun", kickoff: "2026-09-10T19:45:00+03:00", minute: 81, score: { home: 1, away: 1 } }),
    // Bugün başladı ama maç süresi + payı aştı.
    match({ id: "suresi-doldu", kickoff: new Date(NOW - 200 * 60 * 1000).toISOString() }),
    // Süre penceresinin içinde ama kayıt kırk dakikadır güncellenmemiş.
    match({ id: "donmus", updatedAt: new Date(NOW - 40 * 60 * 1000).toISOString() }),
    // Hiçbir zaman bilgisi yok: canlılık doğrulanamaz.
    match({ id: "saatsiz", kickoff: null }),
    // Statik yedekten geldi: arkasında canlı kaynak yok.
    match({ id: "yedek", __staticFallback: true })
  ];

  assert.deepEqual(
    selectLiveTickerRecordsNow(stale).map((item) => item.id),
    [],
    "bayat/donmuş/kaynaksız canlı kayıtların hiçbiri banda girmemeli"
  );

  // Taze kayıt aynı tabloda hayatta kalır: kapı canlıyı öldürmüyor.
  assert.deepEqual(
    selectLiveTickerRecordsNow([...stale, match({ id: "taze", minute: 30 })]).map((item) => item.id),
    ["taze"],
    "gerçekten oynanan maç bantta kalmalı"
  );

  // GECE YARISINI GEÇEN MAÇ. Takvim günü "dün"dür ama başlama saati süre
  // penceresinin içindedir: gün kapısı bu maçı DÜŞÜRMEMELİ. Gün kapısını
  // ham tarih karşılaştırmasıyla yazmak (dün ise at) 23:50'de başlayan bir
  // maçı 00:40'ta ekrandan silerdi — maç daha ilk yarısındayken.
  const gece = match({ id: "gece", kickoff: "2026-09-11T23:50:00+03:00" });
  assert.equal(
    isCurrentlyLive(gece, Date.parse("2026-09-12T00:40:00+03:00")),
    true,
    "gece yarısını geçen maç gün kapısından düşmemeli"
  );

  // Aynı maç, süre penceresi aşıldığında düşer.
  assert.equal(
    isCurrentlyLive(gece, Date.parse("2026-09-12T03:30:00+03:00")),
    false,
    "süre penceresi aşılınca gece maçı da düşmeli"
  );
}

// ── 2. Taraf adı eksikse kayıt banda girmez ─────────────────────────────────

{
  const rows = [
    match({ id: "ok" }),
    match({ id: "no-home", homeTeam: "" }),
    match({ id: "no-away", awayTeam: "" })
  ];
  const selected = selectLiveTickerRecordsNow(rows);
  assert.deepEqual(selected.map((item) => item.id), ["ok"], "eksik taraflı kayıt boşluğu doldurulmadan atlanmalı");
}

// ── 3. Dakika/durum etiketi ──────────────────────────────────────────────

{
  assert.equal(minuteOrStatusLabel(match({ minute: 67, status: "2H" })), "67'", "dakika varsa dakika basılmalı");
  assert.equal(minuteOrStatusLabel(match({ status: "HT", minute: null })), "HT", "devre arası HT etiketi taşımalı");
  assert.equal(minuteOrStatusLabel(match({ status: "ET", minute: null })), "ET", "uzatma ET etiketi taşımalı");
  assert.equal(minuteOrStatusLabel(match({ status: "LIVE", minute: null })), "Canlı", "dakika yoksa genel canlı etiketi");
}

// ── 4. Skor sayısal değilse "–" — uydurma yok ────────────────────────────

{
  const [item] = selectLiveTickerRecordsNow([match({ score: { home: null, away: null } })]);
  assert.equal(item.homeScore, null, "sayısal olmayan skor null kalmalı");
  assert.equal(item.awayScore, null, "sayısal olmayan skor null kalmalı");

  const [scored] = selectLiveTickerRecordsNow([match({ score: { home: 2, away: 1 } })]);
  assert.equal(scored.homeScore, 2);
  assert.equal(scored.awayScore, 1);
}

// ── 5. Üst sınır ─────────────────────────────────────────────────────────

{
  const many = Array.from({ length: 40 }, (unused, index) => match({ id: `live-${index}` }));
  assert.equal(selectLiveTickerRecordsNow(many).length, MAX_ITEMS, "bant liste değildir, sınırı olmalı");
}

// ── 6. Veri yoksa uydurma yok ───────────────────────────────────────────

{
  assert.deepEqual(selectLiveTickerRecords([]), [], "canlı maç yoksa bant boş kalmalı");
  assert.deepEqual(selectLiveTickerRecords(null), [], "bozuk yük çökmemeli");
}

// ── 7. Lig adı: fixture.league.id üzerinden doğrulanmış katalog adı ────────
//
// Faz B'nin kök hata düzeltmesiyle aynı kural: ham sağlayıcı metni değil,
// competitionId'nin çözdüğü kanonik ad.

{
  const [item] = selectLiveTickerRecordsNow([match({ league: "Bilinmeyen Bir Metin", competitionId: "super-lig" })]);
  assert.equal(item.league, "Süper Lig", "lig adı katalogdaki kanonik isme çözülmeli, ham metne değil");
}

console.log(`Canlı skorlar bandı testleri geçti (yalnızca canlı maç, taraf/skor korumaları, ${MAX_ITEMS} üst sınır).`);

// ── 8. ÜRETİLEN ÇIKTI: bant kapsamı — hangi sayfalarda çıkar, hangilerinde çıkmaz ──

{
  const { LIVE_TICKER_PAGES, LIVE_TICKER_OWN_PAGES } = await import("./lib/liveScoresTicker.mjs");

  const BAND = 'data-component="LiveScoresTicker"';
  // Eski, ayrı bir enjeksiyon mekanizmasıyla basılan transfer bandının
  // işareti — apply-shared-layout.mjs'in LEGACY_TRANSFER_TICKER_RE ile
  // temizlediği aynı yorum bloğu. Bilerek `data-component="TransferRadarTicker"`
  // DEĞİL: güncel Transfer Radarı bandı (prerender-core-pages.mjs
  // transferRadarTicker(), ana sayfanın TEPESİNDE, üçüncü bant) aynı
  // bileşen özniteliğini taşıyor ve bu ayrı, kasıtlı bir yüzey — o bant
  // burada "eski" sayılmamalı.
  const OLD_BAND = "<!-- shared-layout:transfer-ticker:start -->";
  const hasBand = (file) => {
    const full = path.join(root, file);
    return fs.existsSync(full) && fs.readFileSync(full, "utf8").includes(BAND);
  };
  const hasOldBand = (file) => {
    const full = path.join(root, file);
    return fs.existsSync(full) && fs.readFileSync(full, "utf8").includes(OLD_BAND);
  };

  const expected = [...LIVE_TICKER_PAGES, ...LIVE_TICKER_OWN_PAGES];
  const missing = expected.filter((file) => !hasBand(file));
  assert.deepEqual(missing, [], `bant listedeki her sayfada olmalı; eksik: ${missing.join(", ")}`);

  const stale = expected.filter((file) => hasOldBand(file));
  assert.deepEqual(stale, [], `eski, tepedeki transfer bandı işareti hâlâ duran sayfalar (temizlenmeli): ${stale.join(", ")}`);

  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "public") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith(".html")) out.push(path.relative(root, full).split(path.sep).join("/"));
    }
    return out;
  };

  const allPages = walk(root);
  assert.ok(allPages.length > 1000, `tam tarama beklenen büyüklükte değil (${allPages.length} sayfa)`);

  const known = new Set(expected);
  const leaked = allPages.filter((file) => !known.has(file) && hasBand(file));
  assert.deepEqual(
    leaked.slice(0, 10),
    [],
    `bant yalnızca listedeki sayfalarda olmalı; sızan ${leaked.length} sayfa: ${leaked.slice(0, 10).join(", ")}`
  );

  [
    ["index.html", "en/index.html"],
    ["canli-skor.html", "en/live-football-scores.html"],
    ["bugunun-maclari.html", "en/todays-matches.html"],
    ["puan-durumu.html", "en/standings.html"]
  ].forEach(([tr, en]) => {
    assert.equal(hasBand(tr), hasBand(en), `${tr} ve ${en} bant konusunda eşit olmalı`);
  });

  console.log(
    `Bant kapsamı testleri geçti (${expected.length} sayfada var, eski bant yok, ` +
    `kalan ${allPages.length - expected.length} sayfada yok, 4 dil çifti eşit).`
  );
}

// ── 9. Boşken bant görünmemeli ───────────────────────────────────────────
//
// Sunucu (liveTickerBlock) ve istemci (app.js#LiveScoresTicker.render) canlı
// maç yokken `.live-scores-ticker` öğesine `data-empty` işareti koyar; page.css
// bunu `display: none` ile gizler. Üçü de aynı işaretten okumalı, yoksa bant
// içeriksiz bir çubuk olarak sayfada asılı kalır.

{
  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  assert.match(
    css,
    /\.live-scores-ticker\[data-empty\]\s*\{[^}]*display:\s*none/,
    "page.css .live-scores-ticker[data-empty] display:none içermeli — boşken bant görünmemeli"
  );

  const clientJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(
    clientJs,
    /toggleAttribute\("data-empty",\s*!items\.length\)/,
    "istemci LiveScoresTicker.render() data-empty işaretini toggle etmeli"
  );

  console.log("Boş bant görünürlük testi geçti (data-empty → display:none, sunucu/istemci tutarlı).");
}
