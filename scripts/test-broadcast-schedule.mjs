#!/usr/bin/env node
/**
 * YAYIN KANALI ZİNCİRİ — SÖZLEŞME DENETİMİ.
 *
 * Bu özelliğin tek gerçek riski yanlış bilgi yazmak. "Süper Lig maçları
 * beIN Sports'ta yayınlanır" cümlesi turnuva düzeyinde doğru, maç düzeyinde
 * eksik: hangi beIN kanalı, o hafta TRT'ye açılan maç var mı, dijital hak
 * kimde. Bu yüzden zincirin her halkasında sınanan şey aynı: DOĞRULANMAMIŞ
 * bir kanal adı ekrana çıkabiliyor mu.
 *
 * İkinci risk sessiz eksik: satırın hiç çizilmemesi. Okuyucu "yayın satırı
 * yok" ile "bu maç yayınlanmıyor"u ayırt edemez, o yüzden bilinmeyen durum
 * da görünür bir cümle taşımak zorunda.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fixtureCard, broadcastLineHtml } from "./lib/matchCards.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  broadcastLabel,
  cardBroadcastLabel,
  istanbulDayOffset,
  isPriorityMatch,
  priorityRank,
  selectBroadcastMatches,
  PRIORITY_COMPETITION_IDS
} = require("../services/broadcastSchedule.js");
const {
  BROADCASTERS,
  COMPETITION_RIGHTS,
  broadcastersForCompetition,
  channelFromSchedule
} = require("../services/broadcastRights.js");

console.log("broadcast-schedule");

// ── 1. KANAL UYDURULMAZ ───────────────────────────────────────────────────
//
// Hak haritasında Süper Lig için beIN Sports yazıyor. Doğrulanmamış bir
// Süper Lig maçında bu ad ekrana ÇIKMAMALI: harita yalnızca hangi akışı
// tarayacağımızı söyler, ne yazacağımızı değil.
{
  const unverified = {
    kickoff: "2027-05-30T20:00:00+03:00",
    homeTeam: "Kayserispor",
    awayTeam: "Antalyaspor",
    competitionId: "super-lig",
    league: "Süper Lig",
    status: "SCHEDULED"
  };
  const label = broadcastLabel(unverified, "tr");
  assert.equal(label.state, "pending", "doğrulanmamış maç 'pending' olmalı");
  assert.equal(label.channel, "", "doğrulanmamış maçta kanal adı taşınmamalı");
  assert.doesNotMatch(label.text, /beIN|TRT|S Sport|Tabii|Exxen/i,
    "hak haritasındaki kanal adı doğrulanmadan metne sızmamalı");
  assert.match(label.text, /bekleniyor/, "bilinmeyen durum görünür bir cümle taşımalı");
  console.log("  ok  doğrulanmamış maçta kanal adı yazılmıyor");
}

// ── 2. BİLİNMEYEN DURUM SESSİZ DEĞİL ─────────────────────────────────────
{
  const pendingHtml = broadcastLineHtml(broadcastLabel({ kickoff: "2027-05-30T20:00:00+03:00" }, "tr"));
  assert.match(pendingHtml, /data-broadcast="pending"/, "bilinmeyen durum işaretlenmeli");
  assert.match(pendingHtml, /Yayın bilgisi bekleniyor/, "bilinmeyen durumda cümle çizilmeli");
  assert.equal(broadcastLineHtml(null), "", "etiket yoksa satır hiç çizilmemeli");
  console.log("  ok  bilinmeyen durum görünür, etiketsiz kart sessiz");
}

// ── 3. İKİ DİL, AYNI KURAL ───────────────────────────────────────────────
{
  const match = { kickoff: "2027-05-30T20:00:00+03:00", homeTeam: "A", awayTeam: "B" };
  assert.match(broadcastLabel(match, "tr").text, /Yayın bilgisi bekleniyor/);
  assert.match(broadcastLabel(match, "en").text, /Broadcast to be confirmed/);
  const trCard = fixtureCard({ locale: "tr", league: "L", stateLabel: "20:00", homeTeam: "A", awayTeam: "B", homeScore: null, awayScore: null, actionHref: "#", broadcast: broadcastLabel(match, "tr") });
  const enCard = fixtureCard({ locale: "en", league: "L", stateLabel: "20:00", homeTeam: "A", awayTeam: "B", homeScore: null, awayScore: null, actionHref: "#", broadcast: broadcastLabel(match, "en") });
  for (const [name, html] of [["tr", trCard], ["en", enCard]]) {
    assert.match(html, /class="fixture-card-broadcast/, `${name}: kartta yayın satırı olmalı`);
  }
  console.log("  ok  Türkçe ve İngilizce kart aynı satırı çiziyor");
}

// ── 4. OYNANMIŞ MAÇTA YAYIN SATIRI YOK ───────────────────────────────────
//
// "Dün akşamki maç şu kanaldaydı" bilgisi doğru ama ana sayfada yer kaplar
// ve hâlâ izlenebilirmiş izlenimi verir.
{
  const finished = { kickoff: "2026-09-11T20:00:00+03:00", homeTeam: "Beşiktaş", awayTeam: "Erzurumspor FK", status: "FINISHED" };
  const scheduled = { ...finished, kickoff: "2027-05-30T20:00:00+03:00", status: "SCHEDULED" };
  assert.equal(cardBroadcastLabel(finished, "tr"), null, "biten maçta yayın satırı çizilmemeli");
  assert.ok(cardBroadcastLabel(scheduled, "tr"), "oynanmamış maçta yayın satırı olmalı");
  console.log("  ok  geçmiş maç ana sayfada yayın satırı taşımıyor");
}

// ── 5. ÖNCELİK SIRASI İSTENEN SIRA ───────────────────────────────────────
{
  const expected = [
    "super-lig",
    "1-lig",
    "sampiyonlar-ligi",
    "avrupa-ligi",
    "konferans-ligi",
    "premier-league",
    "la-liga",
    "serie-a",
    "bundesliga",
    "ligue-1"
  ];
  assert.deepEqual([...PRIORITY_COMPETITION_IDS], expected, "öncelik sırası istenen sırayla birebir olmalı");

  // Türk kulübü, hangi turnuvada olursa olsun büyük Avrupa liglerinin önünde.
  const turkishInEurope = { kickoff: "2027-05-30T20:00:00+03:00", homeTeam: "Samsunspor", awayTeam: "Legia Varşova", competitionId: "konferans-ligi", league: "Konferans Ligi" };
  const bundesliga = { kickoff: "2027-05-30T20:00:00+03:00", homeTeam: "FC Augsburg", awayTeam: "Bayer Leverkusen", competitionId: "bundesliga", league: "Bundesliga" };
  assert.ok(isPriorityMatch(turkishInEurope), "Avrupa'daki Türk takımı öncelikli sayılmalı");
  assert.ok(priorityRank(turkishInEurope) < priorityRank(bundesliga),
    "Türk kulübünün Avrupa maçı Bundesliga maçının önünde olmalı");
  console.log("  ok  öncelik sırası ve Türk kulübü kuralı");
}

// ── 6. GÜN PENCERESİ: YARIN GERÇEKTEN YARIN ──────────────────────────────
{
  const today = istanbulDayOffset(0);
  const tomorrow = istanbulDayOffset(1);
  assert.notEqual(today, tomorrow, "bugün ve yarın farklı gün olmalı");
  assert.equal(
    Math.round((Date.parse(`${tomorrow}T12:00:00+03:00`) - Date.parse(`${today}T12:00:00+03:00`)) / 86400000),
    1,
    "yarın tam bir gün sonrası olmalı"
  );

  const sample = [
    { kickoff: `${tomorrow}T20:00:00+03:00`, homeTeam: "Galatasaray", awayTeam: "Kocaelispor", competitionId: "super-lig" },
    { kickoff: `${today}T20:00:00+03:00`, homeTeam: "Konyaspor", awayTeam: "Trabzonspor", competitionId: "super-lig" }
  ];
  const picked = selectBroadcastMatches(sample, { day: tomorrow });
  assert.equal(picked.length, 1, "yalnızca istenen günün maçları seçilmeli");
  assert.equal(picked[0].homeTeam, "Galatasaray");
  console.log("  ok  gün penceresi yarını doğru kesiyor");
}

// ── 7. HAK HARİTASI EKRANA DEĞİL, TARAYICIYA HİZMET EDER ─────────────────
//
// Haritadaki her turnuva öncelik listesinde olmalı; olmayan bir turnuva
// için akış taramak boşa iş olurdu. Tersi serbest: bir turnuvanın hak
// sahibi bilinmiyorsa listede olmaz ve o maçlar "bekleniyor" kalır.
{
  for (const competitionId of Object.keys(COMPETITION_RIGHTS)) {
    if (competitionId === "turkiye-kupasi") continue; // kupa öncelik listesinde değil, taranması yine de doğru
    assert.ok(
      PRIORITY_COMPETITION_IDS.includes(competitionId),
      `${competitionId}: hak haritasındaki turnuva öncelik listesinde olmalı`
    );
  }
  const superLig = broadcastersForCompetition("super-lig");
  assert.ok(superLig.length, "Süper Lig için taranacak yayıncı tanımlı olmalı");
  for (const broadcaster of superLig) {
    assert.match(broadcaster.scheduleUrl, /^https:\/\//, "yayıncı akış adresi https olmalı");
  }
  console.log("  ok  hak haritası öncelik listesiyle tutarlı");
}

// ── 8. TARAMA ÇIKTISI SÖZLEŞMESİ ─────────────────────────────────────────
//
// Otomatik dosyanın her kaydı kaynağını ve doğrulama anını taşımalı:
// kaynaksız bir kanal adı, tam da bu özelliğin engellemek için var olduğu
// şeydir.
{
  const scanPath = path.join(root, "data", "broadcast-schedule.json");
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.ok(Array.isArray(scan.records), "tarama çıktısı records dizisi taşımalı");
  assert.ok(Array.isArray(scan.days), "tarama çıktısı taranan günleri bildirmeli");

  const today = istanbulDayOffset(0);
  for (const record of scan.records) {
    assert.match(String(record.date), /^\d{4}-\d{2}-\d{2}$/, "kayıt tarihi YYYY-MM-DD olmalı");
    assert.ok(String(record.turkey || "").trim(), `${record.date} ${record.homeTeam}: kanal adı boş olamaz`);
    assert.match(String(record.sourceUrl || ""), /^https:\/\//, `${record.homeTeam}: kanal kaynağı https bağlantı taşımalı`);
    assert.ok(!Number.isNaN(Date.parse(record.verifiedAt)), `${record.homeTeam}: doğrulama anı okunabilir olmalı`);
    // GEÇMİŞ GÜN TUTULMAZ: dosya bugünden eski kayıt taşımamalı.
    assert.ok(String(record.date) >= today, `${record.date}: geçmiş gün kaydı taramada kalmamalı`);
  }
  console.log(`  ok  tarama çıktısı sözleşmesi (${scan.records.length} kayıt)`);
}

// ── 9. İKİ SAYFA DA ÜRETİLMİŞ VE YAYIN SATIRI TAŞIYOR ────────────────────
{
  for (const file of ["bugunun-maclari-hangi-kanalda.html", "yarinki-maclar-hangi-kanalda.html"]) {
    const full = path.join(root, file);
    assert.ok(fs.existsSync(full), `${file}: sayfa üretilmiş olmalı`);
    const html = fs.readFileSync(full, "utf8");
    assert.match(html, /fixture-card-broadcast|broadcast-schedule-empty/, `${file}: yayın satırı ya da boş gün kutusu olmalı`);
    assert.doesNotMatch(html, /Yayın kanalı henüz açıklanmadı/, `${file}: eski çift cümle kalmamalı — metin tek yerden gelir`);
  }
  console.log("  ok  bugün ve yarın sayfaları üretiliyor");
}

// ── 10. AKIŞTAN OKUNAN KANAL ADI ──────────────────────────────────────────
//
// "TRT 1" etiketi + yakalanan "1" eskiden çift rakamlı ("TRT 1" + " 1") oluyordu; noktasız ı
// yüzünden "TRT Spor Yıldız" da "TRT Spor"a düşüyordu.
{
  const trt = BROADCASTERS.trt;
  const bein = BROADCASTERS["bein-sports"];
  assert.equal(channelFromSchedule(trt, "<li>22:00 TRT 1 Galatasaray</li>"), "TRT 1");
  assert.equal(channelFromSchedule(trt, "<li>TRT SPOR canlı</li>"), "TRT Spor");
  assert.equal(channelFromSchedule(trt, "<li>TRT Spor Yıldız canlı</li>"), "TRT Spor Yıldız");
  assert.equal(channelFromSchedule(trt, "<li>TRT SPOR YILDIZ canlı</li>"), "TRT Spor Yıldız");
  assert.equal(channelFromSchedule(trt, "<li>yayın yok</li>"), "TRT 1");
  assert.equal(channelFromSchedule(bein, "<li>beIN SPORTS 1 HD</li>"), "beIN Sports 1");
  assert.equal(channelFromSchedule(bein, "<li>beIN SPORTS</li>"), "beIN Sports");
  for (const value of ["TRT 1", "TRT SPOR", "TRT Spor Yıldız", "beIN SPORTS 1"]) {
    const broadcaster = /^TRT/.test(value) ? trt : bein;
    assert.doesNotMatch(channelFromSchedule(broadcaster, value), /(\d) \1$/, `${value} çift rakam üretmemeli`);
  }
  const schedule = JSON.parse(fs.readFileSync(path.join(root, "data", "broadcast-schedule.json"), "utf8"));
  assert.doesNotMatch(JSON.stringify(schedule), /TRT (\d) \1\b/, "broadcast-schedule.json içinde çift rakamlı TRT etiketi kalmamalı");
  console.log("  ok  akış kanal adları tek biçimli (TRT 1, TRT Spor, TRT Spor Yıldız, beIN Sports 1)");
}

console.log("broadcast-schedule OK (10 bölüm)");
