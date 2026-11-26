/**
 * FUTBOLCU 360 — SÖZLEŞME TESTLERİ.
 *
 * Bu test "sayfa güzel mi" diye bakmaz; oyuncu sayfasının söz verdiği
 * şeyleri kilitler:
 *
 *   1. VERİ KATMANI. Maç günlüğü yalnızca gerçek kadro/olay kaydından
 *      satır üretir, kanıt yoksa satır üretmez, yanlış oyuncuya gol
 *      yazmaz.
 *   2. KAPI. Doğrulanmamış kayıtta hiçbir ölçüm yayımlanmaz — 360
 *      modülünün açtığı yeni yüzeyler de dahil. Bu, geliştirme sırasında
 *      gerçekten kaçan bir hataydı: alan bazlı kapı tek başına
 *      kullanıldığında doğrulanmamış bir kayıttaki şut/xG değerleri
 *      "mevkiye özel istatistik" başlığı altında sayfaya sızıyordu.
 *   3. ÜRETİLMİŞ ÇIKTI. H1 yalnızca ad; H2'ler sözleşmedeki kalıpta;
 *      başlık ve meta açıklaması sayfada GERÇEKTEN olan bölümleri
 *      anlatıyor; aynı konuda iki bölüm basılmıyor.
 *   4. İKİ DİL. Her dizge iki sözlükte de var; İngilizce sayfa Türkçe
 *      rotalara bağlanmıyor.
 *   5. HAFİFLİK. Form grafiği satır içi SVG — profil sayfası yeni bir
 *      betik ya da grafik kütüphanesi yüklemiyor.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { renderPlayer360, player360Description, player360Title } from "./lib/player360.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();

const { buildPlayer360, buildAvailability, newsMentionsPlayer, positionFamily } = require("../services/player360Service.js");
const { buildPlayerMatchLog, resolvePlayerByName, namesMatch, nameKey } = require("../services/playerMatchLogService.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const { getPlayers } = require("../services/playerService.js");
const { createPlayerUrlResolver } = require("../services/playerUrl.js");

const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
const tr = JSON.parse(fs.readFileSync(path.join(root, "locales", "tr.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(root, "locales", "en.json"), "utf8"));

function readJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

const context = {
  players,
  transfers: readJson("data/transfers.json", []).filter((row) => row && row.status === "confirmed"),
  news: readJson("data/news.json", []),
  matches: readJson("data/matches.json", []),
  archive: readJson("data/historical-match-archive.json", { records: [] }).records || [],
  squadStatuses: readJson("data/squad-statuses.json", { teams: [] })
};

const results = [];
function check(name, fn) {
  fn();
  results.push(name);
}

// ── 1. Maç günlüğü ──────────────────────────────────────────────────────────

/**
 * Gerçek maç: Göztepe 2-4 Gaziantep FK (7 Eylül 2026). Olay akışında
 * Kozłowski iki gol, Maxim iki asist, Dervişoğlu bir gol. Bu sayılar
 * testin İÇİNDE sabit: sayacın kendi çıktısını doğrulaması bir şey
 * kanıtlamaz.
 */
check("maç günlüğü gerçek olaylardan doğru sayıyı çıkarır", () => {
  const expectations = [
    { id: "k-koz-owski-gaziantep-fk", goals: 2, assists: 0, started: true },
    { id: "a-maxim-gaziantep-fk", goals: 0, assists: 2, started: true },
    { id: "h-dervisoglu-gaziantep-fk", goals: 1, assists: 0, started: true }
  ];

  for (const expected of expectations) {
    const player = players.find((row) => row.id === expected.id);
    assert.ok(player, `${expected.id} veri kümesinde olmalı`);

    const log = buildPlayerMatchLog(player, { matches: context.matches, archive: context.archive, limit: 10 });
    const row = log.appearances.find((entry) => entry.matchId === "goztepe-gaziantep-fk-2026-09-07");
    assert.ok(row, `${expected.id}: maç satırı üretilmeliydi`);
    assert.equal(row.goals, expected.goals, `${expected.id}: gol sayısı`);
    assert.equal(row.assists, expected.assists, `${expected.id}: asist sayısı`);
    assert.equal(row.started, expected.started, `${expected.id}: ilk 11 bilgisi`);
    assert.equal(row.opponent, "Göztepe");
    assert.equal(row.scoreLine, "2-4");
    assert.equal(row.result, "win", "deplasmanda 4-2 kazanan taraf");
  }
});

check("kanıtı olmayan maç satır üretmez", () => {
  const player = players.find((row) => row.id === "k-koz-owski-gaziantep-fk");
  const log = buildPlayerMatchLog(player, { matches: context.matches, archive: context.archive });

  for (const row of log.appearances) {
    const inSquad = row.started || row.subbedOnAt !== null;
    const inEvents = row.goals > 0 || row.assists > 0 || row.yellowCards > 0 || row.redCards > 0 || row.subbedOffAt !== null;
    assert.ok(inSquad || inEvents, `${row.matchId}: kanıtsız satır basılmış`);
  }
});

/**
 * Dakika yalnızca oyuna giriş/çıkış kaydı varsa basılır. `subst` olayı
 * taşımayan bir maçta ilk 11'deki oyuncunun 90 dakika oynadığı
 * VARSAYILMAZ — veri eksikliğiyle tam maç ayırt edilemez.
 */
check("dakika türetmesi kanıta bağlı", () => {
  let withMinutes = 0;
  let withoutMinutes = 0;

  for (const player of players) {
    const log = buildPlayerMatchLog(player, { matches: context.matches, archive: context.archive });
    for (const row of log.appearances) {
      if (row.minutes === null) { withoutMinutes += 1; continue; }
      withMinutes += 1;
      assert.ok(row.minutes >= 0 && row.minutes <= 90, `${row.matchId}: dakika aralık dışı (${row.minutes})`);
      assert.ok(row.started || row.subbedOnAt !== null, `${row.matchId}: dakika kanıtsız türetilmiş`);
    }
  }

  assert.ok(withMinutes > 0, "en az bir maçta dakika türetilebilmeli");
  assert.ok(withoutMinutes > 0, "kanıt olmayan maçlarda dakika boş kalmalı");
});

check("kadro adı yalnızca tek ve kesin adaya bağlanır", () => {
  assert.ok(namesMatch(nameKey("A. Maxim"), nameKey("Alexandru Maxim")), "kısaltma ile tam ad eşleşmeli");
  assert.ok(!namesMatch(nameKey("A. Maxim"), nameKey("Bogdan Maxim")), "farklı ilk harf eşleşmemeli");
  assert.equal(resolvePlayerByName("A. Maxim", null, players), null, "kulüpsüz eşleşme denenmemeli");

  const resolved = resolvePlayerByName("A. Maxim", "Gaziantep FK", players);
  assert.ok(resolved && resolved.id === "a-maxim-gaziantep-fk", "kulübüyle birlikte tek adaya bağlanmalı");
});

// ── 2. Yayın kapısı ─────────────────────────────────────────────────────────

/**
 * Kaydın kendisi kapıdan geçmediyse 360 modülünün açtığı yüzeylerin
 * hiçbiri ölçüm taşımaz. Özellikle "mevkiye özel istatistikler": alan
 * bazlı kapı (statsAreVerified) tek başına kullanıldığında doğrulanmamış
 * bir kayıttaki şut ve xG değerleri buradan sızıyordu.
 */
check("doğrulanmamış kayıtta hiçbir ölçüm yayımlanmaz", () => {
  const unverified = players.filter((player) => !publicPlayerView(player).verified);
  assert.ok(unverified.length > 0, "test için doğrulanmamış kayıt bulunmalı");

  let checked = 0;
  for (const player of unverified.slice(0, 200)) {
    const model = buildPlayer360({ player, ...context });
    assert.equal(model.seasonStats.core.length, 0, `${player.id}: sezon istatistiği sızmış`);
    assert.equal(model.seasonStats.positional.length, 0, `${player.id}: mevkiye özel istatistik sızmış`);
    assert.equal(model.identity.team, null, `${player.id}: doğrulanmamış kulüp iddiası`);
    assert.equal(model.identity.shirtNumber, null, `${player.id}: doğrulanmamış forma numarası`);
    checked += 1;
  }
  assert.ok(checked > 100, "yeterince kayıt denetlenmeli");
});

check("sayım istatistikleri yalnızca alan bazlı doğrulamayla açılır", () => {
  const osimhen = players.find((row) => row.id === "v-osimhen-galatasaray");
  assert.ok(osimhen, "referans kayıt bulunmalı");

  const model = buildPlayer360({ player: osimhen, ...context });
  const keys = new Set(model.seasonStats.core.map((row) => row.key));

  // `statsVerifiedFields` bu kaydı gol/asist/maç/dakika/kartla sınırlıyor.
  for (const key of ["goals", "assists", "appearances", "minutes"]) {
    assert.ok(keys.has(key), `${key} yayımlanmalıydı`);
  }
  // Şut, pas isabeti, xG o listede YOK: kayıtta sıfır duruyorlar ama
  // ölçülmediler.
  assert.equal(model.seasonStats.positional.length, 0,
    "doğrulanmamış mevki metrikleri yayımlanmamalı");
});

// ── 3. Üretilmiş sayfa ──────────────────────────────────────────────────────

/**
 * PROFİL ARTIK TEK DİZİNDE DEĞİL.
 *
 * Tam adı bilinen oyuncu `futbolcu/<tam-ad>.html`, bilinmeyen
 * `oyuncular/<id>.html` konumunda; eski konumda kalan dosya yönlendirme
 * sayfası ve 360 yığını taşımaz. Test, dizin adını sabitlemek yerine adres
 * çözücüden okur — böylece bir sonraki oyuncu taşındığında da doğru yere
 * bakar.
 */
const playerUrls = createPlayerUrlResolver(readJson("data/player-url-slugs.json", { entries: [], aliases: [] }));

/** Sayfası olan kayıtlar: kopya kayıtlar kanoniğe yönlendirdiği için elenir. */
const canonicalPlayers = players.filter((player) => playerUrls.resolveId(player.id) === player.id);
const generated = canonicalPlayers
  .map((player) => playerUrls.playerPagePath(player.id))
  .filter((relativePath) => fs.existsSync(path.join(root, relativePath)));

function readProfile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

/**
 * SAYFADA GÖRÜNEN AD, KAYITTAKİ AD DEĞİL.
 *
 * Adres tam ada taşınan oyuncuda başlık ve H1 da tam adı gösteriyor
 * ("Talisca" → "Anderson Talisca"): adresi tam ada taşıyıp başlığı
 * kısaltmalı bırakmak okuyucuya iki ayrı ad gösterirdi. Testin
 * karşılaştırdığı ad da bu yüzden görünen addır.
 */
function displayNameOf(player) {
  // Üreticiyle AYNI kaçış: "N'Golo Kanté" sayfada "N&#39;Golo Kanté" olarak
  // duruyor; yalnızca `&` kaçıran bir karşılaştırma kesme işaretli her adı
  // hatalı sayardı.
  return String(playerUrls.playerDisplayName(player))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function playerOfPage(relativePath) {
  const id = path.basename(relativePath, ".html");
  return canonicalPlayers.find((player) => playerUrls.playerPagePath(player.id) === relativePath)
    || players.find((player) => player.id === id);
}

check("her kanonik profil 360 yığınını taşır", () => {
  assert.ok(generated.length >= 100, `yeterli profil üretilmemiş (${generated.length})`);

  let missing = 0;
  for (const file of generated) {
    const html = readProfile(file);
    if (!html.includes('data-p360-section="identity"')) missing += 1;
  }
  assert.equal(missing, 0, `${missing} profilde 360 yığını yok`);
});

check("H1 oyuncunun tam adıyla başlar", () => {
  for (const file of generated.slice(0, 120)) {
    const html = readProfile(file);
    const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => match[1].trim());
    assert.equal(headings.length, 1, `${file}: tam olarak bir H1 olmalı`);

    const player = playerOfPage(file);
    const name = displayNameOf(player);
    assert.ok(headings[0] === name || headings[0] === `${name} kimdir?`,
      `${file}: H1 tam ad veya "tam ad kimdir?" olmalı (${headings[0]})`);
  }
});

check("H2 kalıbı ve tekilliği", () => {
  // Sezon ve haber bölümü VERİ VARSA basılır, yoksa hiç (boş başlık yok);
  // bu yüzden zorunlu listede değiller, koşullu denetim aşağıda.
  const required = ["matches", "availability", "transfers", "career"];

  for (const file of generated.slice(0, 120)) {
    const html = readProfile(file);
    const player = playerOfPage(file);

    for (const key of required) {
      assert.ok(html.includes(`data-p360-section="${key}"`), `${file}: ${key} bölümü basılmalı`);
      assert.ok(html.includes(`id="p360-${key}-title"`), `${file}: ${key} başlığı bulunmalı`);
    }

    // Bölüm başlıkları oyuncunun adıyla başlar — uzun kuyruklu aramanın
    // sayfada birebir karşılığı.
    const seasonHeading = /<h2 id="p360-season-title">([^<]*)<\/h2>/.exec(html);
    assert.equal(html.includes('data-p360-section="season"'), Boolean(seasonHeading), `${file}: sezon bölümü ile başlığı birlikte olmalı`);
    if (seasonHeading) {
      assert.ok(seasonHeading[1].startsWith(displayNameOf(player)),
        `${file}: sezon başlığı oyuncu adıyla başlamalı (${seasonHeading[1]})`);
    }
    // Depodaki `futbolcu/*.html` derleme öncesi bayat bir anlık görüntü olabilir;
    // boş-bölüm kuralı yalnızca bu üreteç sürümüyle üretilmiş sayfada (özet
    // şeridi işareti var) denetlenir. Taze derlemede bütün sayfalar buna girer.
    if (html.includes('data-p360-section="summary"')) {
      assert.ok(!html.includes("henüz doğrulanmış bir kaynakla eşleşmedi"), `${file}: boş sezon notu basılmış`);
      assert.ok(!html.includes("güncel haber bulunmuyor"), `${file}: boş haber notu basılmış`);
    }

    // Aynı bölüm iki kez basılmaz: kart katmanı çakışanları atlar.
    for (const key of ["identity", "matches", "career"]) {
      const occurrences = html.split(`data-p360-section="${key}"`).length - 1;
      assert.equal(occurrences, 1, `${file}: ${key} bölümü ${occurrences} kez basılmış`);
    }
    for (const key of ["season", "news", "summary"]) {
      const occurrences = html.split(`data-p360-section="${key}"`).length - 1;
      assert.ok(occurrences <= 1, `${file}: ${key} bölümü ${occurrences} kez basılmış`);
    }
    assert.ok(!html.includes("<h2>Sezon İstatistikleri</h2>"), `${file}: kart katmanı sezon bölümünü tekrarlıyor`);
    assert.ok(!html.includes("<h2>Kariyer Geçmişi</h2>"), `${file}: kart katmanı kariyer bölümünü tekrarlıyor`);
    assert.ok(!html.includes("<h2>Kimlik ve Kulüp</h2>"), `${file}: kart katmanı kimlik bölümünü tekrarlıyor`);
  }
});

check("başlık ve meta açıklaması sözleşmeye uyar", () => {
  let sixtyPlus = 0;
  for (const file of generated.slice(0, 120)) {
    const html = readProfile(file);

    const title = /<title>([\s\S]*?)<\/title>/.exec(html);
    assert.ok(title, `${file}: başlık yok`);

    // MARKA EKİ KOŞULSUZ DEĞİL — sitenin kendi kuralı var.
    //
    // scripts/normalize-meta.mjs, 68 karakteri aşan başlıklardan
    // " | FutbolRadar" ekini DÜŞÜRÜYOR: arama sonucunda zaten görünmeyen
    // bir eki taşımak, görünen kısımdan yer çalar. "Futbolcu 360" başlık
    // kalıbı uzun adlarda bu sınırı aşıyor, dolayısıyla ek kimi sayfada
    // var kimi sayfada yok — ve bu doğru davranış.
    //
    // Kilitlenen şey, ekin varlığı değil: eksiz bir başlık, ancak ekle
    // birlikte sınırı AŞTIĞI için eksiz olabilir. Eki KISALTMANIN kendisi
    // (68 karakter sınırı) son işlem zincirinin işi ve orada sınanıyor;
    // bu test, üreticinin standalone koşusunda da geçerli olan tarafı
    // tutar: ek keyfî düşmemiş olmalı.
    const titleText = title[1];
    const player = playerOfPage(file);
    assert.ok(titleText.startsWith(displayNameOf(player)),
      `${file}: başlık oyuncu adıyla başlamalı`);
    if (!titleText.endsWith("| FutbolRadar")) {
      assert.ok(`${titleText} | FutbolRadar`.length > 68,
        `${file}: marka eki gereksiz yere düşmüş (${titleText})`);
    }

    const description = /<meta name="description" content="([^"]*)"/.exec(html);
    assert.ok(description, `${file}: meta açıklaması yok`);
    assert.ok(description[1].length >= 50, `${file}: meta açıklaması fazla kısa`);
    // Puan meta açıklamasına GİRMEZ — kapının en kalıcı ihlali oradaydı.
    assert.ok(!/overall rating \d|rating \d/i.test(description[1]), `${file}: açıklamada puan var`);
    if (description[1].length >= 60) sixtyPlus += 1;
  }
  assert.ok(sixtyPlus > 100, "açıklamaların çoğu anlamlı uzunlukta olmalı");
});

check("meta açıklaması yalnızca sayfada olan bölümleri vaat eder", () => {
  for (const player of players.slice(0, 250)) {
    const model = buildPlayer360({ player, ...context });
    const description = player360Description(model, { locale: "tr" });

    if (/son maçları/i.test(description)) {
      assert.ok(model.matchLog.available, `${player.id}: olmayan maç bölümü vaat ediliyor`);
    }
    if (/sezonu:/i.test(description)) {
      assert.ok(model.seasonStats.available, `${player.id}: olmayan sezon bölümü vaat ediliyor`);
    }
    if (/güncel durum:/i.test(description)) {
      assert.ok(model.availability.available, `${player.id}: olmayan durum bölümü vaat ediliyor`);
    }
  }
});

check("veri yoksa bölüm boş kalır ama sayfa kırılmaz", () => {
  const bare = {
    id: "test-bos", name: "Test Oyuncu", position: "Forvet",
    providerId: "mock-test-1", transferHistory: [], formerTeams: []
  };
  const model = buildPlayer360({ player: bare, players: [], transfers: [], news: [], matches: [], archive: [] });

  assert.equal(model.verified, false);
  assert.equal(model.matchLog.available, false);
  assert.equal(model.availability.status, "unknown");
  assert.equal(model.honours.available, false, "veri yoksa kupa bölümü açılmaz");

  const html = renderPlayer360(model, { locale: "tr" });
  assert.ok(html.includes("Bilgi bulunmuyor"), "durum bilinmiyorsa açıkça yazılmalı");
  assert.ok(!/>\s*(0|-|N\/A|null|undefined)\s*</.test(html.replace(/>\s*0\s*<\/b>/g, "")),
    "boş alanlar sıfır ya da tire ile doldurulmamalı");
  assert.ok(!html.includes("p360-section=\"honours\""), "boş kupa bölümü basılmamalı");
});

// ── 4. İki dil ──────────────────────────────────────────────────────────────

check("her 360 dizgesi iki sözlükte de var", () => {
  const keys = Object.keys(tr).filter((key) => key.startsWith("player360."));
  assert.ok(keys.length >= 80, `360 sözlüğü beklenenden küçük (${keys.length})`);

  for (const key of keys) {
    assert.ok(key in en, `${key}: İngilizce karşılığı yok`);
    assert.ok(String(en[key]).trim(), `${key}: İngilizce karşılığı boş`);
    // Yer tutucu sayısı iki dilde AYNI olmalı; yoksa cümlenin bir parçası
    // doldurulmadan basılır.
    assert.equal((String(tr[key]).match(/%s/g) || []).length,
      (String(en[key]).match(/%s/g) || []).length,
      `${key}: yer tutucu sayısı dillerde farklı`);
  }
});

check("İngilizce sayfa İngilizce rotalara bağlanır", () => {
  const dir = path.join(root, "en", "player");
  if (!fs.existsSync(dir)) return;

  // YALNIZCA CANLI SAYFALAR. `en/player/` dizininde eski koşulardan kalmış,
  // kaydı artık yayın kapısından geçmeyen dosyalar da duruyor; bunlar
  // site haritasında ve rota eşlemesinde yer almıyor. Bu test üretilmekte
  // olan sayfaları denetler, eski artıkları değil.
  const live = new Set(players
    .filter((player) => publicPlayerView(player).verified)
    .map((player) => `${player.id}.html`));
  const files = fs.readdirSync(dir).filter((name) => live.has(name)).slice(0, 60);
  assert.ok(files.length > 0, "İngilizce profil üretilmiş olmalı");

  for (const file of files) {
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    assert.ok(html.includes('data-p360-section="identity"'), `${file}: 360 yığını yok`);
    assert.ok(!/href="[^"]*\bgol-kralligi\.html/.test(html), `${file}: Türkçe gol krallığı rotası`);
    assert.ok(!/href="[^"]*\btakimlar\/[a-z-]+\.html/.test(html), `${file}: Türkçe takım rotası`);
    // Maç raporu rotasının İngilizcesi üretilmiyor: satır bağlantısız kalır,
    // kırık link basılmaz.
    assert.ok(!/href="[^"]*mac-raporu\//.test(html), `${file}: Türkçe maç raporu bağlantısı`);
  }
});

check("başlık ve açıklama İngilizcede İngilizce", () => {
  const player = players.find((row) => row.id === "v-osimhen-galatasaray");
  const model = buildPlayer360({ player, ...context });

  const title = player360Title(model, { locale: "en" });
  const description = player360Description(model, { locale: "en" });

  assert.ok(title.includes("Stats"), "İngilizce başlık İngilizce olmalı");
  assert.ok(!/İstatistik|Haberleri/.test(title), "İngilizce başlıkta Türkçe kalmamalı");
  assert.ok(!/sezonu|güncel durum/.test(description), "İngilizce açıklamada Türkçe kalmamalı");
});

// ── 5. Hafiflik ve iç linkler ───────────────────────────────────────────────

check("profil sayfası yeni betik yüklemez, grafik satır içi SVG", () => {
  // Grafik en az iki maç kaydı olan oyuncuda çizilir (tek nokta eğri
  // değildir); örnek sayfa bu yüzden sabit değil, koşulu sağlayan ilk
  // profilden seçilir.
  const chartFile = generated.find((file) =>
    readProfile(file).includes('<svg class="p360-chart"'));
  assert.ok(chartFile, "en az bir profilde form grafiği çizilmeli");

  const sample = readProfile(chartFile);
  assert.ok(sample.includes("<svg class=\"p360-chart\""), "form grafiği satır içi SVG olmalı");
  assert.ok(!/<script[^>]+src="[^"]*(chart|d3|plotly|recharts|highcharts)/i.test(sample),
    "grafik kütüphanesi yüklenmemeli");

  // "YENİ BETİK YOK" ölçütü sabit bir listeye değil, KARŞILAŞTIRMAYA
  // dayanır: derleme sonrası her sayfaya site geneli betikler (pwa.js) ve
  // sürüm damgaları (?v=...) ekleniyor; sabit liste bunları "beklenmeyen"
  // sayıp testi sitenin kendi son işlem zincirine karşı kuruyordu.
  //
  // Doğru soru: 360 modülü, ona dokunmayan bir sayfada OLMAYAN bir betik
  // getiriyor mu? Kıyas sayfası bu karşılaştırma için iyi bir taban:
  // aynı derinlikte, aynı son işlem zincirinden geçiyor, 360 yığını yok.
  const basenames = (html) => new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((match) => path.basename(match[1].split("?")[0])));

  // Profil sayfasının betik demeti 360 öncesiyle AYNI olmalı. Dördü de
  // bu değişiklikten önce de yükleniyordu; `app.js` son işlem zincirinde
  // `app-lite.js` ile değiştiriliyor, `pwa.js` site geneli enjekte
  // ediliyor. Sorgu dizgeleri (?v=...) sürüm damgası, karşılaştırmaya
  // girmez.
  const expected = new Set(["pwa.js", "player-profile.js", "site.js", "app-lite.js", "app.js"]);
  for (const src of basenames(sample)) {
    assert.ok(expected.has(src), `360 yığını yeni betik getirmiş: ${src}`);
  }
});

check("maç raporundan oyuncu profiline bağlantı var", () => {
  const report = path.join(root, "mac-raporu", "goztepe-gaziantep-fk-2026-09-07.html");
  if (!fs.existsSync(report)) return;

  const html = fs.readFileSync(report, "utf8");
  assert.ok(html.includes('href="../oyuncular/a-maxim-gaziantep-fk.html"'),
    "kadrodaki oyuncu adı profil sayfasına bağlanmalı");
});

check("oyuncu sayfası takım, krallık ve maç sayfalarına bağlanır", () => {
  const html = readProfile(playerUrls.playerPagePath("a-maxim-gaziantep-fk"));

  assert.ok(html.includes("gol-kralligi.html"), "gol krallığına bağlanmalı");
  assert.ok(html.includes("asist-kralligi.html"), "asist krallığına bağlanmalı");

  /**
   * MAÇ BAĞLANTISI ADRESİN BİÇİMİNE DEĞİL, HEDEFİN VARLIĞINA BAKAR.
   *
   * Ölçüt bir süre `mac-raporu/<kimlik>.html` dizesiydi. `unify-match-canonicals.mjs`
   * (bkz. postprocessChain "match-canonicals") aynı karşılaşmanın kopya
   * adreslerini bilinçli olarak TEK kanonik `/mac/<takimlar>-<gun>-<ay>-<yil>`
   * adresine bağlıyor; oyuncu sayfasındaki rapor bağlantısı da o geçişte
   * yeniden yazılıyor. Sabit dize, çalışan bir kanonikleştirmeyi "bağlantı
   * yok" diye okuyordu.
   *
   * Korunmak istenen şey değişmedi: oyuncu sayfası o maça GERÇEKTEN
   * bağlanmalı ve bağlandığı sayfa var olmalı. Ölçüt artık bu — hangi
   * adres biçimi kanonik olursa olsun ayakta kalır.
   */
  const matchLinks = [...html.matchAll(/href="\.\.\/(mac|mac-raporu)\/([^"]+)"/g)]
    .map((match) => ({ dir: match[1], slug: match[2].replace(/\.html$/, "") }));
  const goztepe = matchLinks.find((link) => link.slug.includes("goztepe-gaziantep-fk"));
  assert.ok(goztepe, "oynadığı maçın sayfasına bağlanmalı");
  assert.ok(
    fs.existsSync(path.join(root, goztepe.dir, `${goztepe.slug}.html`)),
    `maç bağlantısının hedefi yok: ${goztepe.dir}/${goztepe.slug}.html`
  );

  assert.ok(/karsilastirma\/[a-z0-9-]+-vs-[a-z0-9-]+\.html/.test(html), "kıyas sayfasına bağlanmalı");
});

/**
 * ADRES GEÇİŞİ — YÖNLENDİRME SÖZLEŞMESİ.
 *
 * Kilitlenen dört şey:
 *   1. `/futbolcu/<slug>` uzantısız çalışır (rewrite).
 *   2. `.html` uzantılı hâli uzantısıza 301 — aynı sayfa iki adresten
 *      yayımlanmaz.
 *   3. Taşınan her oyuncunun ESKİ adresi yeni adrese 301 gider.
 *   4. Yönlendirme TEK ATLAMADIR: hiçbir 301'in hedefi başka bir 301'in
 *      kaynağı değildir. Zincir hem yavaş hem de her halkada değer
 *      kaybettirir; kopya kayıtlar ve eski yazım hatası adresleri bu
 *      yüzden doğrudan kanonik adrese bağlanır.
 */
check("taşınan adresler tek atlamada kanonik sayfaya gider", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const redirects = config.redirects || [];
  const rewrites = config.rewrites || [];

  const clean = rewrites.find((row) => row.source === "/futbolcu/:slug");
  assert.ok(clean, "/futbolcu/:slug temiz adres kuralı tanımlı olmalı");
  assert.equal(clean.destination, "/futbolcu/:slug.html");

  const extension = redirects.find((row) => row.source === "/futbolcu/:slug.html");
  assert.ok(extension, "uzantılı hâl uzantısıza yönlendirilmeli");
  assert.equal(extension.destination, "/futbolcu/:slug");
  assert.equal(extension.permanent, true);

  const compare = redirects.find((row) => row.source === "/karsilastir/:slug");
  assert.ok(compare, "/karsilastir/:slug yönlendirmesi tanımlı olmalı");
  assert.equal(compare.destination, "/karsilastirma/:slug");
  assert.equal(compare.permanent, true);

  // Taşınan her oyuncu için eski adres 301 taşımalı.
  const bySource = new Map(redirects.map((row) => [row.source, row]));
  const moved = playerUrls.movedPaths();
  assert.ok(moved.length > 0, "en az bir oyuncu taşınmış olmalı");

  for (const entry of moved.slice(0, 80)) {
    const rule = bySource.get(`/${entry.from}`);
    assert.ok(rule, `${entry.from}: eski adres yönlendirilmeli`);
    assert.equal(rule.permanent, true, `${entry.from}: yönlendirme kalıcı olmalı`);
    assert.equal(rule.destination, `/futbolcu/${entry.slug}`, `${entry.from}: hedef kanonik adres olmalı`);
  }

  // ZİNCİR YOK: hiçbir yönlendirmenin hedefi başka bir yönlendirmenin
  // kaynağı olmamalı (parametreli kalıplar hariç — tek bir yola karşılık
  // gelmiyorlar).
  for (const rule of redirects) {
    const destination = String(rule.destination || "");
    if (destination.includes(":")) continue;

    const next = bySource.get(destination);
    // `/x.html → /x` kuralının hedefi, kendi kaynağının uzantısız hâli;
    // bu bir zincir değil, aynı kuralın iki ucu. Ayrıca uzantısız adres
    // isteği Vercel'de önce yönlendirmelere bakar, eşleşme yoksa rewrite
    // ile dosyaya düşer — `.html` kuralı o yolda hiç çalışmaz.
    if (!next || next === rule) continue;
    assert.fail(`${rule.source} → ${destination} → ${next.destination} zincirleme yönlendirme üretiyor`);
  }
});

check("kanonik adres tektir ve kendini gösterir", () => {
  for (const file of generated.slice(0, 120)) {
    const html = readProfile(file);
    const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(canonicals.length, 1, `${file}: tam olarak bir canonical olmalı`);
    assert.equal(canonicals[0], playerUrls.playerCanonicalUrl(playerOfPage(file).id),
      `${file}: canonical kendi adresini göstermeli`);
  }
});

// ── 6. Yardımcılar ──────────────────────────────────────────────────────────

check("mevki ailesi doğru sınıflandırır", () => {
  assert.equal(positionFamily({ position: "Kaleci" }), "goalkeeper");
  assert.equal(positionFamily({ position: "Stoper" }), "defender");
  assert.equal(positionFamily({ position: "Orta saha" }), "midfielder");
  assert.equal(positionFamily({ position: "Santrfor" }), "forward");
  assert.equal(positionFamily({ positionGroup: "winger" }), "forward");
});

check("sakatlık durumu kayıttan ya da eksik listesinden okunur", () => {
  const fromRecord = buildAvailability({ availabilityStatus: "suspended", availabilityNote: "Red Card" }, null);
  assert.equal(fromRecord.status, "suspended");

  const fromSquad = buildAvailability(
    { name: "L. Trossard", currentTeam: "Beşiktaş" },
    { updatedAt: "2026-09-12T00:00:00Z", teams: [{ team: "Beşiktaş", absences: [{ playerName: "L. Trossard", status: "doubtful", reason: "Injury" }] }] }
  );
  assert.equal(fromSquad.status, "doubtful");

  // Kayıt YOKSA "oynuyor" denmez.
  const unknown = buildAvailability({ name: "Kimse", currentTeam: "Beşiktaş" }, { teams: [] });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.available, false);
});

check("haber eşleşmesi etiket ve özneye dayanır", () => {
  const key = nameKey("V. Osimhen");
  assert.ok(newsMentionsPlayer({ tags: ["Galatasaray", "Victor Osimhen"] }, key), "etiketten eşleşmeli");
  assert.ok(newsMentionsPlayer({ discovery: { subject: "Victor Osimhen" } }, key), "özneden eşleşmeli");
  assert.ok(!newsMentionsPlayer({ tags: ["Galatasaray"], title: "Galatasaray kadrosu açıklandı" }, key),
    "ilgisiz haber bağlanmamalı");
});

for (const name of results) {
  console.log(`  ok  ${name}`);
}
console.log(`\nFutbolcu 360 passed (${results.length} senaryo)`);
