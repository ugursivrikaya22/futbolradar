#!/usr/bin/env node
/**
 * MAÇ MERKEZİ ZENGİNLEŞTİRMESİ — SÖZLEŞME TESTLERİ.
 *
 * Buradaki testlerin tamamı TEK BİR SORUYU soruyor: veri yokken ekrana bir
 * şey çıkıyor mu? Bu modüllerin (oyuncu puanı, xG, şut haritası, ısı
 * haritası, otomatik yorum) hepsi sağlayıcıya bağlı ve hepsinin sessizce
 * uydurmaya kayma riski var — bir eşiği gevşetmek, bir `null`'ı sıfır
 * saymak yeterli. Testler o kapıları kilitliyor.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const plus = require(path.join(root, "services", "matchCenterPlus.js"));
const hub = require(path.join(root, "services", "matchHub.js"));
plus.attachHub(hub);

let checks = 0;
const ok = (message) => { checks += 1; console.log(`  ok  ${message}`); };

/* ── 1. ÖLÇÜM KAPISI: null/undefined/NaN yüzeye sızmaz ─────────────── */
{
  assert.equal(plus.measured(null), null);
  assert.equal(plus.measured(undefined), null);
  assert.equal(plus.measured(""), null);
  assert.equal(plus.measured("abc"), null);
  assert.equal(plus.measured(0), 0, "sıfır GERÇEK bir ölçümdür, elenmemeli");
  assert.equal(plus.measured("58%"), 58);
  assert.equal(plus.measured("1,74"), 1.74);

  for (const bad of [null, undefined, NaN, "", "null", "undefined", "NaN"]) {
    assert.equal(plus.isDisplayable(bad), false, `"${bad}" basılabilir sayılmamalı`);
  }
  assert.equal(plus.isDisplayable(0), true);
  assert.equal(plus.isDisplayable("Osimhen"), true);
  ok("ölçüm ve görüntüleme kapıları null/undefined/NaN'ı eliyor");
}

/* ── 2. OYUNCU ADI EŞLEŞTİRME ──────────────────────────────────────── */
{
  assert.equal(plus.samePlayer("E. Huuhtanen", "Eetu Huuhtanen"), true);
  assert.equal(plus.samePlayer("Uğurcan Çakır", "U. Çakır"), true);
  assert.equal(plus.samePlayer("Fabinho", "Fabinho"), true);
  // Aynı soyadı + FARKLI ilk harf: yanlış oyuncuya puan yazılmamalı.
  assert.equal(plus.samePlayer("A. Yılmaz", "B. Yılmaz"), false);
  assert.equal(plus.samePlayer("", "Osimhen"), false);
  ok("oyuncu adı eşleştirme kısa/tam adı tutuyor, farklı oyuncuyu tutmuyor");
}

/* ── 3. DURUM: canlı maç "Başlamadı" göstermemeli ──────────────────── */
{
  const live = { status: "1H", providerStatus: "1H", minute: 23, score: { home: 1, away: 0 } };
  assert.equal(plus.phaseOf(live), "first-half");
  assert.equal(plus.phaseOf({ ...live, providerStatus: "2H", minute: 67 }), "second-half");
  assert.equal(plus.phaseOf({ ...live, providerStatus: "HT" }), "halftime");
  assert.equal(plus.phaseOf({ ...live, providerStatus: "ET", minute: 105 }), "extra-time");
  assert.equal(plus.phaseOf({ ...live, providerStatus: "P" }), "penalties");
  assert.equal(plus.phaseOf({ status: "FT", score: { home: 1, away: 2 } }), "finished");
  assert.equal(plus.phaseOf({ status: "PST" }), "unplayed");
  assert.equal(plus.phaseOf({ status: "NS" }), "scheduled");

  // SKOR KAPISI: skoru olmayan "canlı" iddiası çizilmez.
  assert.equal(plus.phaseOf({ status: "1H", providerStatus: "1H", score: null }), "scheduled");
  assert.equal(plus.phaseOf({ status: "LIVE", score: { home: null, away: null } }), "scheduled");
  assert.equal(plus.isLivePhase("halftime"), true);
  assert.equal(plus.isLivePhase("finished"), false);
  ok("maç durumu tüm evreleri ayırıyor; skorsuz canlı iddiası çizilmiyor");
}

/* ── 4. xG: anlamsız değer basılmaz ────────────────────────────────── */
{
  const withXg = (home, away) => ({ statistics: [{ type: "Gol beklentisi (xG)", home, away }] });
  const good = plus.expectedGoals(withXg(0.86, 1.74));
  assert.deepEqual([good.homeText, good.awayText, good.leader], ["0.86", "1.74", "away"]);

  // İstenen kesin kural: "-3.5 gibi anlamsız xG" gösterilmemeli.
  assert.equal(plus.expectedGoals(withXg(-3.5, 1.2)), null, "negatif xG çizilmemeli");
  assert.equal(plus.expectedGoals(withXg(1.2, 99)), null, "imkânsız xG çizilmemeli");
  assert.equal(plus.expectedGoals(withXg(null, 1.2)), null, "tek taraflı xG çizilmemeli");
  assert.equal(plus.expectedGoals(withXg("", "")), null);
  assert.equal(plus.expectedGoals({ statistics: [] }), null, "xG yoksa bölüm açılmamalı");
  assert.equal(plus.expectedGoals({}), null);

  // ŞUT BAZINDA xG'DEN TAKIM TOPLAMI.
  //
  // Sağlayıcı takım toplamını vermediği maçlarda, ölçülmüş şut xG'leri
  // toplanarak takım xG'si kurulur — bu yeni bir tahmin değil, xG'nin
  // tanımı. Ama ancak ŞUTLARIN TAMAMI ölçülmüşse: bir şutun bile xG'si
  // eksikse toplam gerçeğin altında kalır ve hiç gösterilmez.
  const withShots = {
    homeTeam: "A", awayTeam: "B",
    shots: [
      { x: 90, y: 50, side: "home", outcome: "goal", minute: 10, xg: 0.5, team: "A" },
      { x: 80, y: 40, side: "home", outcome: "on", minute: 20, xg: 0.25, team: "A" },
      { x: 85, y: 55, side: "away", outcome: "off", minute: 30, xg: 0.1, team: "B" }
    ]
  };
  const derived = plus.expectedGoals(withShots);
  assert.equal(derived.source, "shots");
  assert.equal(derived.homeText, "0.75");
  assert.equal(derived.awayText, "0.10");

  // Sağlayıcının kendi toplamı VARSA o kazanır.
  const both = { ...withShots, statistics: [{ type: "Gol beklentisi (xG)", home: 2.11, away: 0.77 }] };
  assert.equal(plus.expectedGoals(both).source, "provider");
  assert.equal(plus.expectedGoals(both).homeText, "2.11");

  // Tek bir şutun ölçümü eksikse toplam kurulmaz.
  const partial = { ...withShots, shots: withShots.shots.map((s, i) => (i ? s : { ...s, xg: null })) };
  assert.equal(plus.expectedGoals(partial), null, "eksik ölçümle toplam kurulmamalı");

  // xG eğrisi şut bazında xG'den doğar.
  const curve = plus.xgTimeline({ ...withShots, shots: withShots.shots.concat([
    { x: 70, y: 30, side: "away", outcome: "on", minute: 60, xg: 0.2, team: "B" }
  ]) });
  assert.ok(curve && curve.home.length >= 2 && curve.away.length >= 2, "eğri iki taraf için de kurulmalı");
  assert.equal(curve.goals.length, 1, "gol işareti konmalı");
  assert.equal(plus.xgTimeline({}), null, "şut yoksa eğri yok");
  ok("xG yalnızca geçerli ölçümde açılıyor; şut bazında toplam ve eğri kuruluyor");
}

/* ── 5. ŞUT HARİTASI: koordinat yoksa harita yok ───────────────────── */
{
  assert.equal(plus.shotMap({}), null, "şut verisi yokken harita çizilmemeli");
  assert.equal(plus.shotMap({ shots: [] }), null);
  // Koordinatsız şut kaydı sahaya yerleştirilemez.
  assert.equal(plus.shotMap({ shots: [{ player: "Osimhen", outcome: "goal" }] }), null);

  const detail = {
    homeTeam: "Trabzonspor",
    awayTeam: "Galatasaray",
    shots: [
      { x: 88, y: 50, outcome: "goal", minute: "18'", player: "Osimhen", assist: "Sané", xg: 0.42, team: "Galatasaray" },
      { x: 70, y: 30, outcome: "blocked", minute: 31, player: "Muçi", team: "Trabzonspor" },
      { x: 300, y: 5, outcome: "goal", team: "Trabzonspor" },
      { x: 60, y: 20, outcome: "bilinmeyen", team: "Trabzonspor" }
    ]
  };
  const shots = plus.shotMap(detail);
  assert.equal(shots.length, 2, "geçersiz koordinat ve bilinmeyen sonuç elenmeli");
  assert.equal(shots[0].side, "away");
  assert.equal(shots[0].xgText, "0.42");
  assert.equal(shots[1].outcome, "blocked");
  assert.equal(shots[1].xg, null, "ölçülmemiş xG uydurulmamalı");
  ok("şut haritası koordinat şartına bağlı; bozuk kayıtlar eleniyor");
}

/* ── 6. ISI HARİTASI: veri yoksa bölüm gizli ───────────────────────── */
{
  assert.equal(plus.heatmaps({}), null);
  assert.equal(plus.heatmaps({ players: [{ name: "X", heatmap: [] }] }), null);
  const points = Array.from({ length: 8 }, (_, i) => ({ x: 10 + i * 5, y: 40 }));
  const maps = plus.heatmaps({ players: [{ name: "Torreira", team: "Galatasaray", heatmap: points }] });
  assert.equal(maps.length, 1);
  assert.equal(maps[0].points.length, 8);
  ok("ısı haritası yalnızca gerçek nokta bulutuyla açılıyor");
}

/* ── 7. OYUNCU PUANLARI: sağlayıcı vermezse üretilmez ──────────────── */
{
  assert.equal(plus.playerRatings({}), null);
  // Derecesiz oyuncu istatistiği puan tablosu AÇMAZ.
  const noRatings = { players: Array.from({ length: 22 }, (_, i) => ({ name: `Oyuncu ${i}`, team: "A", minutes: 90 })) };
  assert.equal(plus.playerRatings(noRatings), null, "derece yoksa puan tablosu açılmamalı");
  assert.equal(plus.manOfTheMatch(noRatings), null, "derece yoksa maçın oyuncusu ilan edilmemeli");

  // Kapsama eşiğinin altında maçın oyuncusu ilan edilmez.
  const few = {
    homeTeam: "A", awayTeam: "B",
    players: Array.from({ length: 7 }, (_, i) => ({ name: `Oyuncu ${i}`, team: i < 4 ? "A" : "B", providerRating: 6 + i * 0.1 }))
  };
  assert.ok(plus.playerRatings(few), "yedi dereceli oyuncuda tablo açılabilir");
  assert.equal(plus.manOfTheMatch(few), null, "yetersiz kapsamada maçın oyuncusu ilan edilmemeli");

  // OYNAMAMIŞ YEDEK "0.0" İLE LİSTELENMEZ. Sağlayıcı, oyuna hiç girmemiş
  // futbolculara da derece alanı yazıyor ve değeri 0 geliyor; bu bir not
  // değil, "ölçüm yok"un sayıya dönüşmüş hâli.
  assert.equal(plus.isRealRating(0, 0), false, "0 dakika + 0 puan gerçek bir not değil");
  assert.equal(plus.isRealRating(0, 90), false, "sıfır puan basılmamalı");
  assert.equal(plus.isRealRating(6.4, 0), false, "oynamamış oyuncu puanlanmamalı");
  assert.equal(plus.isRealRating(11, 90), false, "ölçek dışı değer basılmamalı");
  assert.equal(plus.isRealRating(6.4, null), true, "süre bildirilmemişse oyuncu elenmez");
  assert.equal(plus.isRealRating(6.4, 12), true);

  const withBench = {
    homeTeam: "A", awayTeam: "B",
    players: [
      ...Array.from({ length: 11 }, (_, i) => ({ name: `Oynayan ${i}`, team: "A", providerRating: 6 + i * 0.1, minutes: 90 })),
      ...Array.from({ length: 9 }, (_, i) => ({ name: `Yedek ${i}`, team: "A", providerRating: 0, minutes: 0 }))
    ]
  };
  const bench = plus.playerRatings(withBench, { locale: "tr" });
  assert.equal(bench.home.players.length, 11, "oynamamış yedekler puan tablosuna girmemeli");
  assert.ok(bench.home.players.every((player) => player.rating > 0), "sıfır puan listelenmemeli");
  ok("oyuncu puanı ve maçın oyuncusu yalnızca sağlayıcı derecesinden doğuyor");
}

/* ── 8. OTOMATİK YORUM: yeterli veri yoksa cümle yok ───────────────── */
{
  assert.equal(plus.commentary({}), null);
  assert.equal(plus.commentary({ homeTeam: "A", awayTeam: "B", status: "NS" }), null,
    "başlamamış maça yorum yazılmamalı");
  // Tek ölçüm bir analiz değildir.
  const thin = {
    homeTeam: "A", awayTeam: "B", status: "FT", score: { home: 1, away: 0 },
    statistics: [{ type: "Korner", home: 4, away: 2 }]
  };
  assert.equal(plus.commentary(thin), null, "üç cümlenin altında yorum üretilmemeli");
  ok("otomatik yorum yetersiz veride hiç üretilmiyor");
}

/* ── 9. ZAMAN ÇİZGİSİ: yarılara ayrılıyor, koşan skor doğrulanıyor ─── */
{
  const detail = {
    homeTeam: "Trabzonspor",
    awayTeam: "Galatasaray",
    score: { home: 1, away: 2 },
    events: [
      { time: "18'", type: "Goal", detail: "Normal Goal", value: "Osimhen · Asist: Sané", team: { name: "Galatasaray" } },
      { time: "31'", type: "Card", detail: "Yellow Card", value: "Torreira", team: { name: "Galatasaray" } },
      { time: "73'", type: "Card", detail: "Red Card", value: "Bardakcı", team: { name: "Galatasaray" } },
      { time: "85'", type: "Goal", detail: "Normal Goal", value: "Muçi", team: { name: "Trabzonspor" } },
      { time: "90'", type: "Goal", detail: "Normal Goal", value: "Sané", team: { name: "Galatasaray" } }
    ],
    substitutions: [{ time: "61'", in: "Yunus Akgün", out: "Sallai", team: "Galatasaray" }]
  };

  const groups = plus.timeline(detail, { locale: "tr" });
  assert.deepEqual(groups.map((group) => group.key), ["first", "second"]);
  assert.equal(groups[0].items.length, 2, "ilk yarıda iki olay");
  assert.equal(groups[0].items[0].kind, "goal");
  assert.equal(groups[0].items[0].player, "Osimhen");
  assert.equal(groups[0].items[0].assist, "Sané");
  assert.equal(groups[0].items[0].side, "away");
  // Olaylardan çıkan toplam tabelayla tutuyor → koşan skor yazılır.
  assert.equal(groups[0].items[0].scoreHome, 0);
  assert.equal(groups[0].items[0].scoreAway, 1);
  const sub = groups[1].items.find((item) => item.kind === "sub");
  assert.equal(sub.playerIn, "Yunus Akgün");
  assert.equal(sub.playerOut, "Sallai");
  // Olay akışındaki subst: API-Football `player` = çıkan, `assist` = giren.
  const evGroups = plus.timeline({ homeTeam: "Galatasaray", awayTeam: "Barcelona", score: { home: 0, away: 1 }, events: [
    { time: "59'", team: { name: "Barcelona" }, type: "subst", detail: "Substitution 2", player: { name: "Anthony Gordon" }, assist: { name: "Karim Adeyemi" } }
  ] }, { locale: "tr" });
  const evSub = evGroups.flatMap((group) => group.items).find((item) => item.kind === "sub");
  assert.equal(evSub.playerIn, "Karim Adeyemi");
  assert.equal(evSub.playerOut, "Anthony Gordon");

  // Tabela olaylarla TUTMUYORSA hiçbir satıra skor yazılmaz.
  const mismatched = plus.timeline({ ...detail, score: { home: 4, away: 4 } }, { locale: "tr" });
  const anyScore = mismatched.some((group) => group.items.some((item) => item.scoreHome !== undefined));
  assert.equal(anyScore, false, "doğrulanamayan koşan skor basılmamalı");

  assert.equal(plus.timeline({ homeTeam: "A", awayTeam: "B" }), null, "olay yoksa çizgi yok");

  // İNGİLİZCE SAYFADA TÜRKÇE METİN KALMAMALI.
  const en = plus.timeline(detail, { locale: "en" });
  const labels = en.flatMap((group) => [group.label, ...group.items.map((item) => item.label)]);
  for (const label of labels) {
    assert.ok(!/[çğışöü]/i.test(label), `İngilizce akışta Türkçe etiket: "${label}"`);
  }
  assert.ok(labels.includes("First half") && labels.includes("Goal") && labels.includes("Red card"));
  ok("zaman çizgisi yarılara ayrılıyor, koşan skor doğrulanıyor, EN tarafı Türkçesiz");
}

/* ── 10. İSTATİSTİK PANELİ: sıra ve İngilizce etiket ───────────────── */
{
  const detail = {
    homeTeam: "A",
    awayTeam: "B",
    statistics: [
      { type: "Korner", home: 4, away: 9, category: "Genel" },
      { type: "Topla oynama", home: 37, away: 63, unit: "%", category: "Genel", higherIsBetter: true },
      { type: "Toplam şut", home: 8, away: 14, category: "Hücum", higherIsBetter: true },
      { type: "Bilinmeyen ölçüm", home: null, away: 3 }
    ]
  };
  const rows = plus.statPanel(detail, { locale: "tr" });
  assert.deepEqual(rows.map((row) => row.type), ["Topla oynama", "Toplam şut", "Korner"],
    "satırlar okuyucunun aradığı sıraya göre dizilmeli");
  assert.ok(!rows.some((row) => row.type === "Bilinmeyen ölçüm"), "değeri olmayan satır elenmeli");
  assert.equal(rows[0].homeText, "37%");
  assert.equal(rows[0].leader, "away");

  const en = plus.statPanel(detail, { locale: "en" });
  assert.deepEqual(en.map((row) => row.label), ["Possession", "Total shots", "Corners"]);
  for (const row of en) {
    assert.ok(!/[çğışöü]/i.test(row.label), `İngilizce panelde Türkçe etiket: "${row.label}"`);
    assert.ok(!/[çğışöü]/i.test(row.category), `İngilizce panelde Türkçe kategori: "${row.category}"`);
  }
  assert.equal(plus.statPanel({ statistics: [] }), null);
  ok("istatistik paneli sıralı, eksik satırı eliyor, EN etiketleri Türkçesiz");
}

/* ── 11. SAHA DİZİLİŞİ: koordinat/diziliş yoksa saha çizilmez ──────── */
{
  const names = Array.from({ length: 11 }, (_, i) => `Oyuncu ${i + 1}`);
  const withFormation = {
    homeTeam: "A", awayTeam: "B",
    lineups: [{ team: "A", formation: "4-2-3-1", players: names }]
  };
  const sides = plus.pitchLineups(withFormation, { locale: "tr" });
  assert.equal(sides.hasPitch, true);
  assert.deepEqual(sides.home.pitch.map((line) => line.length), [1, 4, 2, 3, 1],
    "hatlar dizilişe göre kurulmalı, kaleci ilk satırda");

  // Diziliş metni de koordinat da yoksa saha ÇİZİLMEZ (düz liste kalır).
  const noShape = { homeTeam: "A", awayTeam: "B", lineups: [{ team: "A", players: names }] };
  const plain = plus.pitchLineups(noShape, { locale: "tr" });
  assert.equal(plain.hasPitch, false, "dizilişsiz kadro sahaya oturtulmamalı");
  assert.equal(plus.pitchLineups({}, { locale: "tr" }), null);
  ok("saha dizilişi yalnızca doğrulanmış diziliş/koordinatla çiziliyor");
}

/* ── 12. OYUNCU GÖRSELİ: kimliksiz adres üretilmez ─────────────────── */
{
  assert.equal(plus.playerPhoto("276"), "https://media.api-sports.io/football/players/276.png");
  for (const bad of [null, undefined, "", "abc", "12a"]) {
    assert.equal(plus.playerPhoto(bad), null, `"${bad}" için adres üretilmemeli`);
  }
  ok("oyuncu görseli yalnızca gerçek sağlayıcı kimliğinden kuruluyor");
}

/* ── 13. GERÇEK VERİ: depodaki maçlarda hiçbir modül uydurmuyor ────── */
{
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
  const list = Array.isArray(payload) ? payload : payload.matches || [];
  assert.ok(list.length > 0, "denetlenecek maç bulunmalı");

  let ratedMatches = 0;
  for (const match of list) {
    for (const locale of ["tr", "en"]) {
      const ratings = plus.playerRatings(match, { locale });
      if (ratings) {
        ratedMatches += 1;
        for (const side of [ratings.home, ratings.away].filter(Boolean)) {
          for (const player of side.players) {
            assert.ok(Number.isFinite(player.rating), `${match.id}: ${player.name} geçersiz puan`);
            assert.ok(player.rating > 0 && player.rating <= 10, `${match.id}: ${player.name} ölçek dışı/sıfır puan`);
            assert.ok(player.minutes === null || player.minutes > 0,
              `${match.id}: ${player.name} sahaya çıkmadan puanlanmış`);
            assert.ok(player.name && !/^(null|undefined)$/i.test(player.name), `${match.id}: bozuk oyuncu adı`);
          }
        }
      }

      const xg = plus.expectedGoals(match);
      if (xg) {
        assert.ok(xg.home >= 0 && xg.away >= 0, `${match.id}: negatif xG yayımlanmış`);
      }

      const rows = plus.statPanel(match, { locale }) || [];
      for (const row of rows) {
        assert.ok(plus.isDisplayable(row.homeText) && plus.isDisplayable(row.awayText),
          `${match.id}: "${row.type}" satırında basılamaz değer`);
        assert.ok(!/null|undefined|NaN/i.test(`${row.homeText}${row.awayText}${row.label}`),
          `${match.id}: "${row.type}" satırı bozuk metin taşıyor`);
        assert.ok(row.homeShare >= 0 && row.homeShare <= 100, `${match.id}: bozuk yüzde`);
      }

      const commentary = plus.commentary(match, { locale });
      if (commentary) {
        for (const sentence of commentary.sentences) {
          assert.ok(!/null|undefined|NaN/i.test(sentence), `${match.id}: yorumda bozuk değer — "${sentence}"`);
          if (locale === "en") {
            // ÖZEL ADLAR DENETİM DIŞI. "Fenerbahçe" İngilizce cümlede de
            // Fenerbahçe'dir; kulüp ve futbolcu adlarını Türkçe harf
            // taşıyor diye çeviriye zorlamak veriyi bozmak olurdu. Denetim
            // ŞABLON METNİNE bakıyor: adlar çıkarıldıktan sonra geriye
            // Türkçe bir kelime kalmamalı.
            const template = sentence
              .split(/\s+/)
              .filter((word) => !/^[A-ZÇĞİÖŞÜ]/.test(word))
              .join(" ");
            assert.ok(!/[çğışöü]/i.test(template),
              `${match.id}: İngilizce yorumda Türkçe şablon metni — "${sentence}"`);
          }
        }
      }
    }
  }
  ok(`depodaki ${list.length} maçta bozuk değer yok (${ratedMatches / 2} maçta puan tablosu açıldı)`);
}

/* ── 14. İSTEMCİ KOPYASI GÜNCEL Mİ ─────────────────────────────────── */
{
  const source = fs.readFileSync(path.join(root, "services", "matchCenterPlus.js"), "utf8");
  for (const copy of ["match-center-plus-core.js", path.join("public", "match-center-plus-core.js")]) {
    const file = path.join(root, copy);
    assert.ok(fs.existsSync(file), `${copy} üretilmemiş — npm run build:match-center-plus`);
    assert.ok(fs.readFileSync(file, "utf8").endsWith(source),
      `${copy} kaynaktan ayrışmış — npm run build:match-center-plus`);
  }
  ok("tarayıcı çekirdeği kaynakla aynı");
}

/* ── 15. İSTEMCİ SÖZLEŞMESİ: kabuk kancaları iki dosyada da aynı ───── */
{
  const client = fs.readFileSync(path.join(root, "match-center-plus.js"), "utf8");
  const ssr = fs.readFileSync(path.join(root, "scripts", "lib", "matchSeoPage.mjs"), "utf8");

  // Kanca adı bir tarafta değişirse bölüm SESSİZCE ölür: kabuk `hidden`
  // doğduğu için ekranda hiç görünmez, yani hata gözle fark edilmez.
  for (const name of ["pitch", "ratings", "xg", "shotmap", "timeline", "stats", "heatmap", "analysis"]) {
    assert.ok(client.includes(`"${name}"`), `istemci "${name}" modülünü kaybetmiş`);
    assert.ok(ssr.includes(`shellFor("${name}"`), `SSR "${name}" kabuğunu basmıyor`);
  }
  // ŞUT LİSTESİ ERİŞİLEBİLİRLİK AYAĞI: haritadaki noktalar üst üste
  // biniyor ve yarısı dokunarak seçilemiyor; liste kaybolursa o şutlara
  // ulaşmanın hiçbir yolu kalmaz.
  assert.ok(client.includes("mcp-shot-row"), "şut listesi kaybolmuş");
  assert.ok(client.includes("mcp-shot-list"), "şut listesi kapsayıcısı kaybolmuş");

  for (const hook of ["data-mcp-body", "data-mcp-payload", "futbolradar:match-detail"]) {
    assert.ok(client.includes(hook), `istemci "${hook}" kancasını kaybetmiş`);
  }
  assert.ok(ssr.includes("data-mcp-body") && ssr.includes("data-mcp-payload"),
    "SSR istemcinin beklediği kancaları basmalı");

  // İkinci bir yoklama döngüsü açılmamalı: canlı veri paylaşılan olaydan gelir.
  assert.ok(!/setInterval/.test(client), "istemci kendi yoklama döngüsünü açmamalı");
  assert.ok(client.includes("IntersectionObserver"), "ağır bölümler tembel yüklenmeli");
  ok("istemci ↔ SSR kabuk sözleşmesi bütün");
}

/* ── 16. BASILMIŞ SAYFALAR: kabuklar gizli doğuyor ─────────────────── */
{
  const dir = path.join(root, "mac");
  const pages = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".html")) : [];
  let inspected = 0;
  for (const name of pages.slice(0, 60)) {
    const html = fs.readFileSync(path.join(dir, name), "utf8");
    if (!html.includes('data-mcp="')) continue;
    inspected += 1;
    for (const key of ["pitch", "ratings", "xg", "shotmap", "timeline", "stats", "heatmap", "analysis"]) {
      const marker = `data-mcp="${key}" hidden`;
      assert.ok(html.includes(marker), `${name}: "${key}" kabuğu gizli doğmalı`);
    }
    assert.ok(html.includes("match-center-plus.js"), `${name}: istemci bağlanmamış`);
  }
  if (inspected) ok(`${inspected} basılı maç sayfasında kabuklar gizli doğuyor`);
  else ok("basılı sayfalarda kabuk yok (sayfalar henüz yeniden üretilmedi)");
}

console.log(`\n[test-match-center-plus] ${checks} denetim geçti.`);
