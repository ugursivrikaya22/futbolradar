/**
 * TRANSFER ALIM HATTI TESTLERİ.
 *
 * Testler CANLI KAYNAĞA BAĞLI DEĞİL: her senaryo scripts/fixtures/
 * transfer-sources.json içindeki sabit gövdelerden koşar. Ağ, hattın
 * doğruluğunun ölçüldüğü yer olmamalı — bugün çalışan bir RSS yarın
 * biçim değiştirdiğinde test kırmızıya döner ve kimse bakmaz.
 *
 * Korunan sözler:
 *   1. BASIN HABERİ RESMÎ TRANSFER DEĞİLDİR (kaynak katmanı tavanı).
 *   2. AYNI TRANSFER İKİ KEZ YAYIMLANMAZ (kimlik + birleştirme).
 *   3. UYDURMA OYUNCU YAYIMLANMAZ (oyuncu dizini kapısı).
 *   4. DURUM GERİ GİTMEZ (yaşam döngüsü).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runIngestion } from "./ingest-transfers.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);

const statusModel = require("../services/transfers/statusModel.js");
const normalizer = require("../services/transfers/normalizer.js");
const parser = require("../services/transfers/parser.js");
const validator = require("../services/transfers/validator.js");
const dedup = require("../services/transfers/deduplicator.js");
const confidence = require("../services/transfers/confidence.js");
const updater = require("../services/transfers/updater.js");
const publisher = require("../services/transfers/publisher.js");
const notifier = require("../services/transfers/notifier.js");
const fetcher = require("../services/transfers/fetcher.js");
const playerDirectory = require("../services/transfers/playerDirectory.js");
const { validateTickerItem } = require("../services/newsTicker.js");

const FIX = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "transfer-sources.json"), "utf8"));

const kapSource = { id: "kap-disclosures", label: "KAP", tier: "kap", format: "rss", url: "https://www.kap.org.tr/" };
const mediaSource = { id: "media", label: "Bir gazete", tier: "tier_media", format: "rss", url: "https://example.com/" };
const weakSource = { id: "weak", label: "Diğer medya", tier: "other_media", format: "rss", url: "https://example.com/" };

function ingest(fixtures, sources, existing = []) {
  return runIngestion({ cadence: "test", fixtures, sources, existingTransfers: existing });
}

// ── 1. Resmî transfer algılama ─────────────────────────────────────────────
{
  const { report, articles, tickerItems } = await ingest({ "kap-disclosures": FIX.official_kap }, [kapSource]);
  assert.equal(report.created, 1, "resmî bildirim bir kayıt üretmeli");

  const article = articles[0];
  assert.match(article.title, /resmen açıkladı/, "resmî kaynakta başlık resmî dil kullanabilir");
  assert.equal(tickerItems[0].confidence, "confirmed", "resmî kayıt doğrulanmış güvende olmalı");
  assert.equal(tickerItems[0].category, "official", "resmî kayıt official kategorisine gitmeli");
}

// ── 2. BASIN HABERİ RESMÎ OLAMAZ — hattın en önemli sözü ───────────────────
{
  // Aynı "resmen açıkladı" metni, bu kez YALNIZCA medya kaynağından geliyor.
  const { articles, tickerItems } = await ingest({ media: FIX.official_kap }, [mediaSource]);

  assert.equal(articles.length, 1);
  assert.doesNotMatch(
    articles[0].title,
    /resmen/,
    "medya kaynağı tek başına 'resmen' başlığı ÜRETEMEZ"
  );
  assert.match(articles[0].title, /anlaşmaya vardı/, "medya tavanı agreement_reached olmalı");
  assert.notEqual(tickerItems[0].confidence, "confirmed", "medya kaydı doğrulanmış sayılmamalı");

  // Kural modelin kendisinde de sınanıyor.
  const capped = statusModel.resolveStatus("official", ["tier_media"]);
  assert.equal(capped.status, "agreement_reached");
  assert.equal(capped.capped, true);
  assert.match(capped.reason, /resmî kaynak yok/);

  assert.equal(statusModel.resolveStatus("official", ["kap"]).status, "official");
  assert.equal(statusModel.statusCeiling(["other_media", "tier_media"]), "agreement_reached");
  assert.equal(statusModel.statusCeiling(["tier_media", "club_site"]), "official");
}

// ── 3. Söylenti algılama ───────────────────────────────────────────────────
{
  const { articles, tickerItems } = await ingest({ media: FIX.rumor_media }, [mediaSource]);
  assert.equal(articles.length, 1);
  assert.match(articles[0].title, /iddia/, "söylenti başlığı iddia dilinde olmalı");
  assert.equal(tickerItems[0].category, "transfer-rumour");
  assert.equal(validateTickerItem(tickerItems[0]).valid, true, "söylenti bant öğesi geçerli olmalı");
}

// ── 4. Durum yükseltme: anlaşma → resmî, TEK kayıt ─────────────────────────
{
  const first = await ingest({ media: FIX.agreement_then_official_step1 }, [mediaSource]);
  assert.equal(first.report.created, 1);
  assert.equal(first.transfers[0].transferStatus, "agreement_reached");

  const second = await ingest(
    { "kap-disclosures": FIX.agreement_then_official_step2 },
    [kapSource],
    first.transfers
  );

  assert.equal(second.report.created, 0, "aynı transfer için İKİNCİ KAYIT açılmamalı");
  assert.equal(second.report.updated, 1, "mevcut kayıt güncellenmeli");
  assert.equal(second.transfers.length, first.transfers.length, "kayıt sayısı artmamalı");

  const record = second.transfers.find((row) => /Günay/.test(row.playerName));
  assert.equal(record.transferStatus, "official", "resmî bildirimle durum yükselmeli");
  assert.ok(record.history.length >= 2, "değişiklik geçmişi korunmalı");
  assert.match(
    record.history[record.history.length - 1].note,
    /agreement_reached -> official/,
    "geçmiş durum geçişini yazmalı"
  );
  assert.ok(record.sources.length >= 2, "her iki kaynak da kayıtta kalmalı");
}

// ── 5. Durum GERİ gitmez ───────────────────────────────────────────────────
{
  assert.equal(statusModel.canTransition("official", "rumor").allowed, false);
  assert.equal(statusModel.canTransition("agreement_reached", "negotiation").allowed, false);
  assert.equal(statusModel.canTransition("negotiation", "official").allowed, true);
  assert.equal(statusModel.canTransition("official", "cancelled").allowed, true, "resmî transfer iptal edilebilir");
  assert.equal(statusModel.canTransition("denied", "official").revival, true, "yalanlanan iddia canlanabilir");

  const existing = updater.createRecord({
    playerName: "Kaan Ayhan", fromTeam: "Galatasaray", toTeam: "Beşiktaş",
    requestedStatus: "official", transferWindow: "2026-yaz",
    sources: [{ id: "kap", name: "KAP", tier: "kap", url: "https://kap.org.tr/x" }]
  }).record;

  const merged = updater.mergeRecord(existing, {
    playerName: "Kaan Ayhan", fromTeam: "Galatasaray", toTeam: "Beşiktaş",
    requestedStatus: "rumor", transferWindow: "2026-yaz",
    sources: [{ id: "weak", name: "Diğer", tier: "other_media", url: "https://example.com/y" }]
  });

  assert.equal(merged.record.transferStatus, "official", "resmî kayıt söylentiyle zayıflatılamaz");
  assert.equal(merged.blocked, true, "engellenen geçiş rapor edilmeli");
}

// ── 6. Yinelenen engelleme: aynı transferi iki kaynak bildirirse ───────────
{
  // İki AYRI belge, aynı transfer. Aynı URL iki kez gelseydi tek kaynak
  // sayılırdı (ve sayılmalı) — burada sınanan şey bağımsız teyit.
  const { report, transfers } = await ingest(
    { "kap-disclosures": FIX.official_kap, media: FIX.official_media_echo },
    [kapSource, mediaSource]
  );
  assert.equal(report.created, 1, "iki kaynak tek kayıt üretmeli");
  assert.ok(report.duplicatesSkipped >= 1, "atlanan yineleme sayılmalı");
  assert.ok(transfers[0].sources.length >= 2, "iki kaynak da kayda işlenmeli");
  // Resmî kaynak varken durum official kalmalı; medya onu aşağı çekmemeli.
  assert.equal(transfers[0].transferStatus, "official");
  assert.ok(transfers[0].confidenceScore > 0.9, "bağımsız teyit güveni yükseltmeli");

  // Aynı URL iki kez: TEK kaynak sayılmalı.
  const sameUrl = await ingest(
    { "kap-disclosures": FIX.official_kap, media: FIX.official_kap },
    [kapSource, mediaSource]
  );
  assert.equal(sameUrl.transfers[0].sources.length, 1, "aynı belge iki kez sayılmamalı");
}

// ── 7. Kimlik: pencere kimliğin parçası ────────────────────────────────────
{
  const base = { playerName: "Kaan Ayhan", fromTeam: "Galatasaray", toTeam: "Beşiktaş" };
  const yaz = dedup.transferIdentity({ ...base, transferWindow: "2026-yaz" });
  const kis = dedup.transferIdentity({ ...base, transferWindow: "2027-kis" });
  assert.notEqual(yaz, kis, "farklı pencere farklı harekettir");

  // Eksik taraf: "?→Beşiktaş" sonradan "Galatasaray→Beşiktaş" olunca
  // İKİNCİ kayıt açılmamalı.
  const partial = [updater.createRecord({
    playerName: "Kaan Ayhan", toTeam: "Beşiktaş", fromTeam: "",
    requestedStatus: "negotiation", transferWindow: "2026-yaz",
    sources: [{ id: "m", name: "M", tier: "tier_media", url: "https://example.com/1" }]
  }).record];

  const found = dedup.findExisting(
    { playerName: "Kaan Ayhan", fromTeam: "Galatasaray", toTeam: "Beşiktaş", transferWindow: "2026-yaz" },
    partial
  );
  assert.ok(found.match, "eksik taraf sonradan dolunca aynı kayıt bulunmalı");
  assert.equal(found.exact, false, "gevşek eşleşme olarak işaretlenmeli");
}

// ── 8. Türkçe karakter normalleştirme ──────────────────────────────────────
{
  assert.equal(normalizer.fold("BEŞİKTAŞ"), normalizer.fold("Beşiktaş"));
  assert.equal(normalizer.fold("Beşiktaş"), normalizer.fold("Besiktas"));
  assert.equal(normalizer.fold("İSTANBUL"), "istanbul", "İ doğru katlanmalı");
  assert.equal(normalizer.fold("Iğdır"), "igdir", "I doğru katlanmalı");
  assert.equal(normalizer.fold("Göztepe"), "goztepe");
}

// ── 9. Kulüp takma adları ──────────────────────────────────────────────────
{
  assert.equal(normalizer.canonicalClub("Cimbom"), "Galatasaray");
  assert.equal(normalizer.canonicalClub("BJK"), "Beşiktaş");
  assert.equal(normalizer.canonicalClub("Fener"), "Fenerbahçe");
  assert.equal(normalizer.canonicalClub("Fırtına"), "Trabzonspor");
  assert.equal(normalizer.canonicalClub("Galatasaray SK"), "Galatasaray");
  // Tanımadığı kulübü UYDURMAZ.
  assert.equal(normalizer.canonicalClub("Real Madrid"), "Real Madrid");

  const { articles } = await ingest({ media: FIX.alias_club }, [mediaSource]);
  assert.equal(articles.length, 1);
  assert.match(articles[0].title, /Galatasaray/, "takma ad kanonik ada çevrilmeli");
}

// ── 10. Kiralık transfer ───────────────────────────────────────────────────
{
  const { transfers } = await ingest({ "kap-disclosures": FIX.loan }, [kapSource]);
  assert.equal(transfers[0].type, "Kiralık", "kiralık türü algılanmalı");
  assert.equal(parser.detectType("kiralık dönüş yaptı"), "Kiralık dönüş");
}

// ── 11. Bonservissiz transfer ──────────────────────────────────────────────
{
  const { transfers } = await ingest({ "kap-disclosures": FIX.free_transfer }, [kapSource]);
  assert.equal(transfers[0].type, "Bonservissiz");
  assert.equal(transfers[0].feeEur, 0, "bonservissiz transferde bedel sıfırdır");
}

// ── 12. Sözleşme feshi ─────────────────────────────────────────────────────
{
  assert.equal(parser.detectType("karşılıklı fesih kararı alındı"), "Sözleşme feshi");
  const { transfers } = await ingest({ "kap-disclosures": FIX.termination }, [kapSource]);
  assert.equal(transfers[0].type, "Sözleşme feshi");
}

// ── 13. İptal ve yalanlama ─────────────────────────────────────────────────
{
  const cancelled = await ingest({ media: FIX.cancelled }, [mediaSource]);
  assert.equal(cancelled.transfers[0].transferStatus, "cancelled");
  assert.match(cancelled.articles[0].title, /vazgeçti|iptal/);

  const denied = await ingest({ media: FIX.denied }, [mediaSource]);
  assert.equal(denied.transfers[0].transferStatus, "denied");
  // Terminal durum medya kaynağıyla da verilebilir: yalanlamayı bastırmak
  // okuyucuyu yanıltır.
  assert.equal(statusModel.resolveStatus("denied", ["tier_media"]).capped, false);
}

// ── 14. Eksik ücret UYDURULMAZ ─────────────────────────────────────────────
{
  const { transfers } = await ingest({ "kap-disclosures": FIX.missing_fee }, [kapSource]);
  assert.equal(transfers[0].fee, "Açıklanmadı", "kaynağın söylediği yazılmalı");
  assert.equal(transfers[0].feeEur, null, "rakam uydurulmamalı");

  assert.deepEqual(parser.detectFee("bonservis bedeli belirtilmedi"), { fee: "", feeEur: null });
  assert.equal(parser.detectFee("12 milyon euro bonservis").feeEur, 12000000);

  const record = updater.createRecord({
    playerName: "Kaan Ayhan", toTeam: "Beşiktaş", requestedStatus: "rumor",
    sources: [{ id: "m", name: "M", tier: "tier_media", url: "https://example.com/1" }]
  }).record;
  assert.equal(record.contractUntil, "unknown");
  assert.equal(record.purchaseOption, "unknown");
}

// ── 15. UYDURMA OYUNCU YAYIMLANMAZ ─────────────────────────────────────────
//
// Canlı kaynaklara karşı ilk koşuda hat "Türk", "David" ve "Devrim Bodrum"
// adlı üç oyuncu üretmişti. Bu test o sınıf hatanın geri gelmesini engeller.
{
  const { report, articles } = await ingest({ media: FIX.bogus_player }, [mediaSource]);
  assert.equal(articles.length, 0, "tanınmayan oyuncu YAYIMLANMAMALI");
  // Hangi kovaya düştüğü (red mi karantina mı) adın ne kadar bozuk
  // olduğuna bağlı; sınanan şey KAYIT ALTINA ALINDIĞI: sessizce düşen bir
  // aday "neden bu haber yok?" sorusunu yanıtsız bırakır.
  assert.equal(
    report.rejected.length + report.quarantined.length,
    1,
    "elenen aday gerekçesiyle raporlanmalı, sessizce atılmamalı"
  );

  assert.equal(playerDirectory.looksLikeName("Türk").ok, false);
  assert.equal(playerDirectory.looksLikeName("David").ok, false, "tek parçalı ad kabul edilmemeli");
  // Asıl savunma veritabanı kapısı: yapısal denetimden geçse bile
  // veritabanında karşılığı olmayan ad yayımlanmaz.
  assert.equal(playerDirectory.resolvePlayer("Devrim Bodrum").known, false, "tanınmayan ad kabul edilmemeli");
  assert.equal(playerDirectory.looksLikeName("Semih Galatasaray").ok, false, "kulüp adı içeren ad kabul edilmemeli");
  assert.equal(playerDirectory.isKnownPlayer("Kaan Ayhan"), true, "gerçek oyuncu tanınmalı");

  // Adı düzgün ama veritabanında olmayan oyuncu (gerçekten yeni bir yabancı
  // transferi olabilir): REDDEDİLMEZ, karantinaya alınır ki insan baksın.
  const unknown = await ingest({ media: FIX.unknown_player }, [mediaSource]);
  assert.equal(unknown.articles.length, 0, "tanınmayan oyuncu yayımlanmamalı");
  assert.equal(unknown.report.quarantined.length, 1, "yeni yabancı transferi karantinaya alınmalı");
  assert.match(unknown.report.quarantined[0].reasons[0], /veritabanında bulunamadı/);
}

// ── 16. Transferle ilgisiz haber hatta girmez ──────────────────────────────
{
  const { report, articles } = await ingest({ media: FIX.irrelevant }, [mediaSource]);
  assert.equal(articles.length, 0, "maç haberi transfer hattına girmemeli");
  assert.equal(report.candidatesFound, 0);
}

// ── 17. Aynı oyuncu için birden çok rapor ──────────────────────────────────
{
  const { report, transfers } = await ingest(
    { media: FIX.negotiation_media, weak: FIX.rumor_media },
    [mediaSource, weakSource]
  );
  // Farklı oyuncular: iki ayrı kayıt. Aynı oyuncu olsaydı tek kayıt olurdu
  // (test 6). Burada sınanan şey: iki kaynak birbirine karışmıyor.
  assert.equal(report.created, 2);
  const names = transfers.slice(0, 2).map((row) => row.playerName).sort();
  assert.deepEqual(names, ["Kaan Ayhan", "Victor Nelsson"]);
}

// ── 18. Kaynak çökmesi koşuyu düşürmez ─────────────────────────────────────
{
  const failing = { id: "down", label: "Çöken kaynak", tier: "tier_media", format: "rss", url: "https://example.com/down" };
  const { report, articles } = await runIngestion({
    cadence: "test",
    sources: [failing, kapSource],
    fixtures: { "kap-disclosures": FIX.official_kap },
    existingTransfers: [],
    attempts: 1,
    fetchImpl: async () => { throw new TypeError("ağ yok"); },
    sleepImpl: async () => {}
  });

  assert.equal(report.sourceFailures.length, 1, "çöken kaynak rapor edilmeli");
  assert.match(report.sourceFailures[0].error, /ağ yok/);
  assert.equal(articles.length, 1, "diğer kaynak çalışmaya devam etmeli");

  // Sessiz başarısızlık yok: olay bildiriciye düşüyor.
  const events = notifier.collectEvents(report);
  assert.ok(events.some((event) => event.event === "source_unreachable"));
}

// ── 19. Geçersiz JSON ve boş gövde çökertmez ───────────────────────────────
{
  const jsonSource = { id: "j", label: "JSON kaynak", tier: "tier_media", format: "json", url: "https://example.com/j" };
  const { report } = await ingest({ j: FIX.invalid_json }, [jsonSource]);
  assert.equal(report.candidatesFound, 0, "bozuk JSON aday üretmemeli");
  assert.equal(report.sourceFailures.length, 0, "bozuk gövde çökme sayılmamalı, sessizce boş geçmeli");

  const empty = await ingest({ media: FIX.empty }, [mediaSource]);
  assert.equal(empty.report.candidatesFound, 0);
}

// ── 20. Yeniden deneme ve üstel geri çekilme ───────────────────────────────
{
  assert.equal(fetcher.backoffMs(0), 1000);
  assert.equal(fetcher.backoffMs(1), 2000);
  assert.equal(fetcher.backoffMs(2), 4000);

  let calls = 0;
  const waits = [];
  const result = await fetcher.fetchSource(
    { url: "https://example.com/x" },
    {
      attempts: 3,
      sleepImpl: async (ms) => { waits.push(ms); },
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) return { ok: false, status: 503 };
        return { ok: true, status: 200, text: async () => FIX.official_kap };
      }
    }
  );
  assert.equal(result.ok, true, "geçici hata sonrası başarı");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000], "üstel geri çekilme uygulanmalı");

  // 404 tekrar DENENMEZ.
  let notFoundCalls = 0;
  await fetcher.fetchSource({ url: "https://example.com/404" }, {
    attempts: 3,
    sleepImpl: async () => {},
    fetchImpl: async () => { notFoundCalls += 1; return { ok: false, status: 404 }; }
  });
  assert.equal(notFoundCalls, 1, "kalıcı hata tekrar denenmemeli");

  // Cloudflare engeli 200 döner ama gövdesi işe yaramaz — yakalanmalı.
  const challenged = await fetcher.fetchSource({ url: "https://example.com/cf" }, {
    attempts: 2,
    sleepImpl: async () => {},
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<html><title>Just a moment...</title>" })
  });
  assert.equal(challenged.ok, false, "tarayıcı doğrulaması başarı sayılmamalı");
  assert.match(challenged.error, /Cloudflare/);
}

// ── 21. Güven skoru ────────────────────────────────────────────────────────
{
  const single = confidence.scoreTransfer({ tiers: ["other_media"], status: "rumor" });
  const corroborated = confidence.scoreTransfer({ tiers: ["other_media", "tier_media"], status: "rumor" });
  assert.ok(corroborated.score > single.score, "ikinci bağımsız kaynak güveni artırmalı");

  const officialScore = confidence.scoreTransfer({ tiers: ["kap"], status: "official" });
  assert.ok(officialScore.score > corroborated.score, "resmî kaynak medyadan yüksek olmalı");
  assert.ok(officialScore.score <= 1, "skor 1'i aşmamalı");

  assert.equal(confidence.confidenceLabel("official", 1), "confirmed");
  assert.equal(confidence.confidenceLabel("rumor", 0.4), "rumour");
}

// ── 22. Doğrulama: eksik alanlar reddedilir ────────────────────────────────
{
  const base = {
    playerName: "Kaan Ayhan", fromTeam: "Galatasaray", toTeam: "Beşiktaş",
    sourceUrl: "https://example.com/a", sourceTier: "tier_media",
    status: "rumor", announcedAt: "2026-08-02T10:00:00+03:00", transferWindow: "2026-yaz"
  };
  assert.equal(validator.validateCandidate(base).verdict, "accept");
  assert.equal(validator.validateCandidate({ ...base, playerName: "" }).verdict, "reject");
  assert.equal(validator.validateCandidate({ ...base, sourceUrl: "" }).verdict, "reject");
  assert.equal(validator.validateCandidate({ ...base, sourceUrl: "javascript:x" }).verdict, "reject");
  assert.equal(validator.validateCandidate({ ...base, fromTeam: "", toTeam: "" }).verdict, "reject");
  assert.equal(validator.validateCandidate({ ...base, sourceTier: "bilinmeyen" }).verdict, "reject");
  assert.equal(validator.validateCandidate({ ...base, status: "" }).verdict, "reject");
  assert.equal(validator.validateCandidate({ ...base, announcedAt: "dün" }).verdict, "reject");
  assert.equal(
    validator.validateCandidate({ ...base, announcedAt: "2030-01-01T00:00:00Z" }).verdict,
    "reject",
    "gelecek tarihli kayıt reddedilmeli"
  );

  // Resmî kayıtla çelişen ikinci hedef karantinaya gider.
  const existing = [{
    playerName: "Kaan Ayhan", toTeam: "Beşiktaş", transferStatus: "official", transferWindow: "2026-yaz", id: "x"
  }];
  const conflict = validator.validateCandidate({ ...base, toTeam: "Trabzonspor" }, { existing });
  assert.equal(conflict.verdict, "quarantine");
  assert.match(conflict.reasons[0], /çelişiyor/);
}

// ── 23. Bant işaretlemesi geçerli ──────────────────────────────────────────
{
  for (const status of ["official", "agreement_reached", "negotiation", "rumor", "denied", "cancelled"]) {
    const record = {
      playerName: "Kaan Ayhan", fromTeam: "Galatasaray", toTeam: "Beşiktaş",
      transferStatus: status, confidenceScore: status === "official" ? 1 : 0.6,
      transferWindow: "2026-yaz", announcedAt: new Date().toISOString(), ingestedAt: new Date().toISOString()
    };
    const item = publisher.buildTickerItem(record, { major: true });
    const verdict = validateTickerItem(item);
    assert.equal(verdict.valid, true, `${status}: bant öğesi geçerli olmalı — ${verdict.errors.join("; ")}`);

    if (status !== "official" && status !== "denied" && status !== "cancelled") {
      assert.doesNotMatch(item.text, /RESMİ|SON DAKİKA/, `${status}: resmî ön ek kullanılmamalı`);
    }
  }

  const officialItem = publisher.buildTickerItem({
    playerName: "Kaan Ayhan", toTeam: "Galatasaray", transferStatus: "official",
    confidenceScore: 1, announcedAt: new Date().toISOString(), transferWindow: "2026-yaz"
  }, { major: true });
  assert.match(officialItem.text, /^SON DAKİKA \|/, "büyük kulüp + resmî = SON DAKİKA");
}

// ── 24. Haber gövdesi ve künye kutusu ──────────────────────────────────────
{
  const record = updater.createRecord({
    playerName: "Semih Kılıçsoy", fromTeam: "Beşiktaş", toTeam: "Galatasaray",
    requestedStatus: "official", type: "Bonservis", fee: "12 milyon euro",
    transferWindow: "2026-yaz",
    sources: [{ id: "kap", name: "KAP", tier: "kap", url: "https://kap.org.tr/x" }]
  }).record;

  const article = publisher.buildArticle(record, { major: true });
  assert.ok(article.body.length >= 5, "haber gövdesi bölümler taşımalı");
  assert.ok(article.bodyHeadings.some((heading) => heading === "Transfer durumu"), "durum bölümü olmalı");
  assert.ok(article.infoBox.rows.some((row) => row.label === "Transfer durumu"), "künye kutusunda durum olmalı");
  assert.equal(article.status, "verified");
  assert.ok(article.sources.length >= 1, "haber kaynak bağlantısı taşımalı");
  assert.ok(article.tags.length >= 3, "haber en az üç etiket taşımalı");

  // Eksik bilgi varsa "güncellenecek" notu ZORUNLU.
  const partial = updater.createRecord({
    playerName: "Semih Kılıçsoy", toTeam: "Galatasaray", requestedStatus: "negotiation",
    transferWindow: "2026-yaz",
    sources: [{ id: "m", name: "M", tier: "tier_media", url: "https://example.com/1" }]
  }).record;
  assert.match(publisher.buildArticle(partial).updateNote, /güncellenecek/);
}

// ── 25. Ana sayfa yüzeyleri: kayıt yayın hattına düşüyor ───────────────────
{
  const { transfers } = await ingest({ "kap-disclosures": FIX.official_kap }, [kapSource]);
  const record = transfers[0];

  // Eski sözlük korunmalı: takım sayfaları `status: "confirmed"` okuyor.
  assert.equal(record.status, "confirmed", "resmî kayıt eski sözlükte confirmed görünmeli");

  const { evaluateTransfer } = require("../services/transferService.js");
  assert.equal(
    evaluateTransfer(record).publishable,
    true,
    "yeni kayıt mevcut takım sayfası hattından geçmeli"
  );

  // Resmî olmayan kayıt takım sayfasına DÜŞMEMELİ.
  const rumorRun = await ingest({ media: FIX.rumor_media }, [mediaSource]);
  assert.equal(
    evaluateTransfer(rumorRun.transfers[0]).publishable,
    false,
    "söylenti doğrulanmış takım bölümüne girmemeli"
  );
}

// ── 26. Sağlık raporu hiçbir şeyi gizlemez ─────────────────────────────────
{
  const { report } = await ingest(
    { media: FIX.unknown_player, "kap-disclosures": FIX.official_kap },
    [mediaSource, kapSource]
  );

  for (const field of [
    "cadence", "startedAt", "finishedAt", "sourcesChecked", "sourceFailures",
    "dormantSources", "created", "updated", "duplicatesSkipped", "rejected",
    "quarantined", "averageDelaySeconds", "latestOfficial"
  ]) {
    assert.ok(field in report, `sağlık raporunda ${field} bulunmalı`);
  }

  assert.ok(report.dormantSources.length >= 1, "erişilemeyen kaynaklar raporda görünmeli");
  assert.ok(
    report.dormantSources.every((row) => row.reason),
    "her erişilemeyen kaynak GEREKÇE taşımalı"
  );
  assert.ok(report.quarantined.length >= 1, "karantina raporda görünmeli");
  assert.ok(report.latestOfficial, "son resmî transfer raporda olmalı");

  const markdown = notifier.summaryMarkdown(report, notifier.collectEvents(report));
  assert.match(markdown, /Transfer otomasyonu koşusu/);
  assert.match(markdown, /karantina/i);
}

console.log(
  "Transfer alım hattı testleri geçti " +
  "(resmî algılama, medya tavanı, söylenti, durum yükseltme, geri geçiş engeli, " +
  "tekilleştirme, Türkçe katlama, kulüp takma adları, kiralık, bonservissiz, fesih, " +
  "iptal/yalanlama, eksik ücret, uydurma oyuncu kapısı, kaynak çökmesi, bozuk JSON, " +
  "geri çekilme, güven skoru, doğrulama, bant ve haber işaretlemesi, sağlık raporu)."
);
