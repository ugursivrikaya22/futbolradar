/**
 * AI MAÇ MERKEZİ — DİLDEN BAĞIMSIZ OKUMA MOTORU.
 *
 * Bu dosya TEK BİR İŞ yapar: doğrulanmış maç verisini, ekranda
 * gösterilebilir YAPISAL bir okumaya çevirir. Çıktısı asla cümle değildir;
 * anahtar + sayıdır. Cümleyi `scripts/lib/aiMatchCenter.mjs` içindeki
 * sözlük yazar.
 *
 * NEDEN BÖYLE — İKİ DİLİN AYRIŞMASINI YAPISAL OLARAK İMKÂNSIZ KILMAK.
 *
 * Türkçe ve İngilizce maç sayfası aynı motoru çağırır, aynı anahtar
 * listesini alır ve aynı bileşenleri çizer. Bir dile "şunu da ekleyelim"
 * denemez: eklenecek şey burada üretilmiyorsa iki dilde de yoktur,
 * üretiliyorsa iki dilde de vardır. Dil yalnızca sözlükte değişir.
 * Bu, "TR ve EN sayfalarda aynı analiz" kuralının koda gömülmüş hâlidir.
 *
 * UYDURMA YASAĞI — MOTORUN BİRİNCİ KURALI.
 *
 * Her alan, kaynağı yoksa `null` döner ve çizen taraf o bileşeni HİÇ
 * basmaz. "Eksik yok", "form dengeli", "veri bekleniyor" gibi bir varsayım
 * ÜRETİLMEZ; bildirim yokluğu, olgunun yokluğu değildir. Bir sürücü
 * (driver) ancak ölçülmüş iki sayı karşılaştırılabildiğinde doğar.
 *
 * VERİ KAYNAKLARI — hepsi zaten sitede olan, doğrulanmış kayıtlar:
 *   - services/fixtureProbabilityModel.js `inputs`  → hücum/savunma, form,
 *     sıra, eksik sayısı, ikili rekabet, örneklem büyüklüğü, güven
 *   - services/fixtureProbabilityService.js          → gösterilen 1-X-2 ve kaynağı
 *   - data/squad-statuses.json                       → sakat/cezalı bildirimleri
 *   - data/predicted-lineups.json + sağlayıcı 11'i   → muhtemel/resmî kadro
 *   - bitmiş maç havuzu                              → son 5 maç, ikili rekabet
 *
 * GÖSTERİLEN YÜZDE İLE AÇIKLAMANIN İLİŞKİSİ — DÜRÜSTLÜK NOTU.
 *
 * Ekrandaki 1-X-2, mevcut zincirin çözdüğü kaynaktan gelir (sağlayıcı →
 * piyasa → FutbolRadar modeli). Açıklama ise HER ZAMAN ölçülmüş girdilerin
 * kendisini anlatır; sağlayıcının yüzdesini "şundan dolayı böyle" diye
 * geriye dönük gerekçelendirmez — o gerekçe bizim bilmediğimiz bir modele
 * ait olurdu ve uydurma sayılırdı. Bu yüzden `outcome.source` ile
 * `drivers` ayrı taşınır ve ekranda ayrı etiketlenir.
 */

"use strict";

/** Sürücü eşikleri. Modelin kendi ölçeğinden türetilmiştir, keyfi değil. */
const THRESHOLDS = Object.freeze({
  // attackStrength/defenseStrength ölçeği 0.65–1.50 (MIN_STRENGTH..MAX_STRENGTH):
  // 0.85 birimlik toplam aralıkta 0.20 fark belirgin, 0.08 fark okunur.
  strength: { strong: 0.2, slight: 0.08 },
  // formDelta maç başına puan sapmasıdır, ±1.5 ile sınırlı.
  form: { strong: 0.6, slight: 0.25 },
  // Bildirilmiş eksik oyuncu sayısı farkı.
  absence: { strong: 3, slight: 1 },
  // İkili rekabette maç başına ortalama gol farkı.
  h2h: { strong: 1, slight: 0.34 },
  // Lig sırası farkı, takım sayısına bölünerek -1..1 aralığına getirilmiş.
  rank: { strong: 0.35, slight: 0.12 }
});

/** Güven düzeyi sınırları — modelin `confidence` (0-100) alanı üzerinden. */
const CONFIDENCE_BANDS = Object.freeze({ high: 70, medium: 45 });

/** Sürücülerin ekrandaki sırası: etkisi en ölçülebilir olandan başlar. */
const DRIVER_ORDER = Object.freeze(["attack", "defense", "form", "absence", "h2h", "rank"]);

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * İki ölçülmüş sayıdan bir sürücü kurar.
 *
 * `higherIsBetter` false olduğunda düşük sayı üstünlüktür (savunmada
 * yenilen gol oranı, eksik oyuncu sayısı). Girdilerden biri bile yoksa
 * `null` döner — tek taraflı bir karşılaştırma yapılmaz.
 */
function driverFrom(key, homeValue, awayValue, bands, options = {}) {
  if (!isFiniteNumber(homeValue) || !isFiniteNumber(awayValue)) return null;
  const home = Number(homeValue);
  const away = Number(awayValue);
  const higherIsBetter = options.higherIsBetter !== false;
  const diff = higherIsBetter ? home - away : away - home;
  // Eşik, EKRANDA GÖRÜNEN farkla aynı sayıdan okunur. Ham kayan nokta
  // farkı kullanılsaydı "0,20" diye basılan bir fark, 0.19999999999999996
  // olduğu için "hafif" etiketini alabilirdi: okuyucunun gördüğü sayı ile
  // yanındaki etiket birbirini yalanlardı.
  const size = Math.abs(round2(diff));
  const strength = size >= bands.strong ? "strong" : size >= bands.slight ? "slight" : "balanced";
  return {
    key,
    lean: strength === "balanced" ? "balanced" : diff > 0 ? "home" : "away",
    strength,
    values: { home: round2(home), away: round2(away) },
    gap: round2(size),
    higherIsBetter
  };
}

/** Son 5 maç satırlarından puan ve galibiyet sayısı. Satır yoksa null. */
function formBlock(rows) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && row.result) : [];
  if (!list.length) return null;
  let points = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const row of list) {
    if (row.result === "W") { points += 3; wins += 1; } else if (row.result === "D") { points += 1; draws += 1; } else losses += 1;
  }
  return {
    results: list.map((row) => ({
      result: row.result,
      label: row.label || "",
      kickoff: (row.match && row.match.kickoff) || null
    })),
    played: list.length,
    points,
    wins,
    draws,
    losses,
    pointsPerGame: round2(points / list.length)
  };
}

/**
 * Eksik bildirimleri. `count` yalnızca BİLDİRİM varsa sayıdır; bildirim
 * hiç gelmemişse `null` kalır ve ekranda "eksik yok" denmez — bildirimin
 * yokluğu eksiğin yokluğu değildir.
 */
function absenceBlock(side) {
  if (!side) return null;
  const players = Array.isArray(side.players) ? side.players.filter((player) => player && player.name) : [];
  const count = isFiniteNumber(side.count) ? Number(side.count) : (players.length || null);
  if (count === null) return null;
  return {
    count,
    reported: true,
    players: players.map((player) => ({
      name: String(player.name),
      status: player.status ? String(player.status) : null,
      key: player.key ? String(player.key) : null
    }))
  };
}

/**
 * Kadro bloğu. `status` üç değer alır: "official" (sağlayıcı ilk 11'i),
 * "predicted" (basından derlenmiş muhtemel 11) ve "none". "none" ise
 * bölüm çizilmez; tahmini bir diziliş uydurulmaz.
 */
function lineupBlock(side) {
  if (!side || !side.status || side.status === "none") return null;
  const missing = Array.isArray(side.missingKeyPlayers)
    ? side.missingKeyPlayers.map((player) => (typeof player === "string" ? player : player && player.name)).filter(Boolean)
    : [];
  return {
    status: side.status === "official" ? "official" : "predicted",
    formation: side.formation ? String(side.formation) : null,
    count: isFiniteNumber(side.count) ? Number(side.count) : null,
    missingKeyPlayers: missing.map(String)
  };
}

/** İkili rekabet özeti. Sayfanın ev sahibi perspektifinden sayılır. */
function h2hBlock(entries, homeWins, draws, awayWins) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return null;
  const played = list.length;
  return {
    played,
    homeWins: isFiniteNumber(homeWins) ? Number(homeWins) : null,
    draws: isFiniteNumber(draws) ? Number(draws) : null,
    awayWins: isFiniteNumber(awayWins) ? Number(awayWins) : null,
    entries: list.slice(0, 5).map((entry) => ({
      date: entry.date || null,
      homeTeam: entry.homeTeam || "",
      awayTeam: entry.awayTeam || "",
      homeGoals: isFiniteNumber(entry.homeGoals) ? Number(entry.homeGoals) : null,
      awayGoals: isFiniteNumber(entry.awayGoals) ? Number(entry.awayGoals) : null,
      competition: entry.competition || null
    }))
  };
}

/** Güven: modelin kendi `confidence` sayısı + neye dayandığı. */
function confidenceBlock(modelInputs, modelConfidence, probability) {
  const score = isFiniteNumber(modelConfidence)
    ? Number(modelConfidence)
    : isFiniteNumber(probability && probability.confidence) ? Number(probability.confidence) : null;
  if (score === null) return null;
  const level = score >= CONFIDENCE_BANDS.high ? "high" : score >= CONFIDENCE_BANDS.medium ? "medium" : "low";
  const basis = {};
  if (modelInputs) {
    if (isFiniteNumber(modelInputs.home && modelInputs.home.matches)) basis.homeMatches = Number(modelInputs.home.matches);
    if (isFiniteNumber(modelInputs.away && modelInputs.away.matches)) basis.awayMatches = Number(modelInputs.away.matches);
    if (isFiniteNumber(modelInputs.home && modelInputs.home.venueMatches)) basis.homeVenueMatches = Number(modelInputs.home.venueMatches);
    if (isFiniteNumber(modelInputs.away && modelInputs.away.venueMatches)) basis.awayVenueMatches = Number(modelInputs.away.venueMatches);
    if (isFiniteNumber(modelInputs.h2h && modelInputs.h2h.sampleSize)) basis.h2hMatches = Number(modelInputs.h2h.sampleSize);
    if (modelInputs.baselineStatus) basis.baselineStatus = String(modelInputs.baselineStatus);
  }
  return { score: Math.round(score), level, basis: Object.keys(basis).length ? basis : null };
}

/** Gösterilen 1-X-2. Üç yüzde de yoksa blok hiç doğmaz. */
function outcomeBlock(probability) {
  const probabilities = probability && probability.probabilities;
  if (!probabilities) return null;
  const home = Number(probabilities.home);
  const draw = Number(probabilities.draw);
  const away = Number(probabilities.away);
  if (![home, draw, away].every(Number.isFinite)) return null;
  const top = Math.max(home, draw, away);
  const lean = top === home ? "home" : top === away ? "away" : "draw";
  const sorted = [home, draw, away].sort((left, right) => right - left);
  return {
    home: Math.round(home),
    draw: Math.round(draw),
    away: Math.round(away),
    source: probability.source ? String(probability.source) : null,
    lean,
    // İlk iki seçenek arasındaki fark: "açık favori" ile "başa baş" ayrımı
    // ekranda bu sayıdan okunur, gözle değil.
    margin: Math.round(sorted[0] - sorted[1])
  };
}

/**
 * MOTORUN GİRİŞ KAPISI.
 *
 * @param {object} input
 * @param {object} [input.probability]  zincirin çözdüğü gösterim kaydı
 * @param {object} [input.modelPrediction] modelFor() çıktısındaki prediction
 * @param {object} [input.forms]        { home: satırlar, away: satırlar }
 * @param {object} [input.absences]     { home: {count, players}, away: {...} }
 * @param {object} [input.lineups]      { home: {status, formation, ...}, away: {...} }
 * @param {object} [input.h2h]          { entries, homeWins, draws, awayWins }
 * @param {string} [input.state]        pre | live | post | pending | ...
 * @param {object} [input.result]       bitmiş maçta { home, away } skor
 * @returns {object} yapısal okuma; hiçbir bileşen yoksa `available:false`
 */
function buildAiMatchCenter(input = {}) {
  const probability = input.probability || null;
  const modelPrediction = input.modelPrediction || null;
  const modelInputs = modelPrediction && modelPrediction.inputs ? modelPrediction.inputs : null;
  const homeInputs = (modelInputs && modelInputs.home) || null;
  const awayInputs = (modelInputs && modelInputs.away) || null;

  const outcome = outcomeBlock(probability);
  const confidence = confidenceBlock(modelInputs, modelPrediction && modelPrediction.confidence, probability);

  const absences = {
    home: absenceBlock(input.absences && input.absences.home),
    away: absenceBlock(input.absences && input.absences.away)
  };
  const forms = {
    home: formBlock(input.forms && input.forms.home),
    away: formBlock(input.forms && input.forms.away)
  };
  const lineups = {
    home: lineupBlock(input.lineups && input.lineups.home),
    away: lineupBlock(input.lineups && input.lineups.away)
  };
  const h2h = h2hBlock(
    input.h2h && input.h2h.entries,
    input.h2h && input.h2h.homeWins,
    input.h2h && input.h2h.draws,
    input.h2h && input.h2h.awayWins
  );

  // ── SÜRÜCÜLER ────────────────────────────────────────────────────────
  // Her biri yalnızca iki tarafın da ölçülmüş sayısı varken doğar.
  const drivers = [];

  const attack = driverFrom("attack", homeInputs && homeInputs.attackStrength, awayInputs && awayInputs.attackStrength, THRESHOLDS.strength);
  if (attack) drivers.push(attack);

  // Savunmada DÜŞÜK sayı iyidir: defenseStrength yenilen gol oranıdır.
  const defense = driverFrom("defense", homeInputs && homeInputs.defenseStrength, awayInputs && awayInputs.defenseStrength, THRESHOLDS.strength, { higherIsBetter: false });
  if (defense) drivers.push(defense);

  // Form sapması modelde varsa oradan; yoksa son 5 maç satırlarından
  // maç başına puan olarak. İkisi de yoksa sürücü doğmaz.
  const formHome = isFiniteNumber(homeInputs && homeInputs.formDelta)
    ? Number(homeInputs.formDelta)
    : forms.home ? forms.home.pointsPerGame : null;
  const formAway = isFiniteNumber(awayInputs && awayInputs.formDelta)
    ? Number(awayInputs.formDelta)
    : forms.away ? forms.away.pointsPerGame : null;
  const form = driverFrom("form", formHome, formAway, THRESHOLDS.form);
  if (form) drivers.push(form);

  // Eksikte ÇOK olan taraf dezavantajlıdır.
  const absenceHome = absences.home ? absences.home.count : (homeInputs && homeInputs.absences);
  const absenceAway = absences.away ? absences.away.count : (awayInputs && awayInputs.absences);
  const absence = driverFrom("absence", absenceHome, absenceAway, THRESHOLDS.absence, { higherIsBetter: false });
  if (absence) drivers.push(absence);

  // İkili rekabet: en az 2 maçlık örneklem olmadan sürücü sayılmaz.
  const h2hSample = modelInputs && modelInputs.h2h ? modelInputs.h2h.sampleSize : (h2h ? h2h.played : null);
  const h2hDiff = modelInputs && modelInputs.h2h ? modelInputs.h2h.averageGoalDifference : null;
  if (isFiniteNumber(h2hSample) && Number(h2hSample) >= 2 && isFiniteNumber(h2hDiff)) {
    const value = Number(h2hDiff);
    const size = Math.abs(value);
    drivers.push({
      key: "h2h",
      lean: size < THRESHOLDS.h2h.slight ? "balanced" : value > 0 ? "home" : "away",
      strength: size >= THRESHOLDS.h2h.strong ? "strong" : size >= THRESHOLDS.h2h.slight ? "slight" : "balanced",
      values: { home: round2(value), away: round2(-value) },
      gap: round2(size),
      sample: Number(h2hSample),
      higherIsBetter: true
    });
  }

  // Lig sırası: tablo yoksa rankDelta null gelir, sürücü doğmaz.
  if (isFiniteNumber(modelInputs && modelInputs.rankDelta)) {
    const value = Number(modelInputs.rankDelta);
    const size = Math.abs(value);
    drivers.push({
      key: "rank",
      lean: size < THRESHOLDS.rank.slight ? "balanced" : value > 0 ? "home" : "away",
      strength: size >= THRESHOLDS.rank.strong ? "strong" : size >= THRESHOLDS.rank.slight ? "slight" : "balanced",
      values: {
        home: isFiniteNumber(homeInputs && homeInputs.rank) ? Number(homeInputs.rank) : null,
        away: isFiniteNumber(awayInputs && awayInputs.rank) ? Number(awayInputs.rank) : null
      },
      gap: round2(size),
      higherIsBetter: false
    });
  }

  drivers.sort((left, right) => DRIVER_ORDER.indexOf(left.key) - DRIVER_ORDER.indexOf(right.key));

  // ── HÜCUM-SAVUNMA KARŞILAŞTIRMASI ────────────────────────────────────
  // Sürücülerden ayrı bir blok: sürücü "kim önde"yi söyler, bu blok
  // sayıların kendisini gösterir. Biri olmadan diğeri çizilebilir.
  const attackDefense = homeInputs && awayInputs && (isFiniteNumber(homeInputs.attackStrength) || isFiniteNumber(homeInputs.defenseStrength))
    ? {
      leagueAverage: 1,
      home: {
        attack: isFiniteNumber(homeInputs.attackStrength) ? round2(homeInputs.attackStrength) : null,
        defense: isFiniteNumber(homeInputs.defenseStrength) ? round2(homeInputs.defenseStrength) : null,
        cleanSheetRate: isFiniteNumber(homeInputs.cleanSheetRate) ? round2(homeInputs.cleanSheetRate) : null,
        winRate: isFiniteNumber(homeInputs.winRate) ? round2(homeInputs.winRate) : null,
        pointsPerGame: isFiniteNumber(homeInputs.pointsPerGame) ? round2(homeInputs.pointsPerGame) : null,
        matches: isFiniteNumber(homeInputs.matches) ? Number(homeInputs.matches) : null
      },
      away: {
        attack: isFiniteNumber(awayInputs.attackStrength) ? round2(awayInputs.attackStrength) : null,
        defense: isFiniteNumber(awayInputs.defenseStrength) ? round2(awayInputs.defenseStrength) : null,
        cleanSheetRate: isFiniteNumber(awayInputs.cleanSheetRate) ? round2(awayInputs.cleanSheetRate) : null,
        winRate: isFiniteNumber(awayInputs.winRate) ? round2(awayInputs.winRate) : null,
        pointsPerGame: isFiniteNumber(awayInputs.pointsPerGame) ? round2(awayInputs.pointsPerGame) : null,
        matches: isFiniteNumber(awayInputs.matches) ? Number(awayInputs.matches) : null
      },
      expectedGoals: modelPrediction && modelPrediction.expectedGoals && isFiniteNumber(modelPrediction.expectedGoals.home)
        ? { home: round2(modelPrediction.expectedGoals.home), away: round2(modelPrediction.expectedGoals.away) }
        : null
    }
    : null;

  // ── KISA ÖZET ────────────────────────────────────────────────────────
  // Cümle DEĞİL, cümlenin iskeleti. Ekranda hangi kalıbın yazılacağını
  // dil sözlüğü seçer; burada yalnızca hangi olgunun anlatılacağı belli
  // olur. Bitmiş maçta özet, oynanmış skorun kendisidir.
  const decisive = drivers.filter((driver) => driver.strength !== "balanced");
  const finalScore = input.result && isFiniteNumber(input.result.home) && isFiniteNumber(input.result.away)
    ? { home: Number(input.result.home), away: Number(input.result.away) }
    : null;
  // Özet üç durumdan BİRİNDE doğar: gösterilecek yüzde var, ÖLÇÜLMÜŞ en
  // az bir sürücü var, ya da maç oynanmış ve skoru belli. Koşul "belirgin
  // sürücü" değil "ölçülmüş sürücü": ölçüp fark bulamamak da anlatmaya
  // değer bir sonuçtur, hiç ölçmemekle aynı şey değildir.
  const summary = outcome || drivers.length || finalScore
    ? {
      state: input.state || "pre",
      lean: outcome ? outcome.lean : null,
      margin: outcome ? outcome.margin : null,
      // Öne çıkan seçeneğin KENDİ yüzdesi. Özet cümlesi bunu yazar;
      // iki seçenek arasındaki farkı ("margin") yüzde diye sunmak,
      // olmayan bir büyüklüğü iddia etmek olurdu.
      topPercent: outcome ? Math.max(outcome.home, outcome.draw, outcome.away) : null,
      // İlk iki seçenek 10 puandan yakınsa okuma "dar fark"tır; bu, gözle
      // değil sayıyla verilen bir karardır.
      narrow: outcome ? outcome.margin < 10 : null,
      confidenceLevel: confidence ? confidence.level : null,
      topDrivers: decisive.slice(0, 2).map((driver) => ({ key: driver.key, lean: driver.lean, strength: driver.strength })),
      // "Başa baş" ancak ÖLÇTÜĞÜMÜZ sürücüler varken ve hepsi dengeliyken
      // söylenebilir. Hiç sürücü yokken aynı cümleyi kurmak, ölçmediğimiz
      // bir şey hakkında hüküm vermek olurdu: o durumda özet susar.
      balanced: drivers.length > 0 && decisive.length === 0,
      result: finalScore
    }
    : null;

  // ── KAPSAM ───────────────────────────────────────────────────────────
  // Hangi bileşen veriye sahip, hangisi değil. Ekranda "şu an elimizde
  // olan" ile "henüz gelmeyen" ayrımı bu listeden çizilir; testler de
  // iki dilin AYNI kapsamı ürettiğini buradan doğrular.
  const components = {
    outcome: Boolean(outcome),
    confidence: Boolean(confidence),
    drivers: drivers.length > 0,
    form: Boolean(forms.home || forms.away),
    absence: Boolean(absences.home || absences.away),
    lineup: Boolean(lineups.home || lineups.away),
    attackDefense: Boolean(attackDefense),
    h2h: Boolean(h2h),
    summary: Boolean(summary)
  };
  const present = Object.keys(components).filter((key) => components[key]);

  return {
    available: present.length > 0,
    outcome,
    confidence,
    drivers,
    form: forms.home || forms.away ? forms : null,
    absence: absences.home || absences.away ? absences : null,
    lineup: lineups.home || lineups.away ? lineups : null,
    attackDefense,
    h2h,
    summary,
    coverage: {
      components,
      present,
      missing: Object.keys(components).filter((key) => !components[key])
    }
  };
}

module.exports = {
  THRESHOLDS,
  CONFIDENCE_BANDS,
  DRIVER_ORDER,
  buildAiMatchCenter
};
