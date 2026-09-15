/**
 * MAÇ SONUCU OLASILIĞI — ÜÇ KAYNAK, TEK ÖNCELİK ZİNCİRİ.
 *
 * SORUN. Maç detayındaki "Sağlayıcı Tahmini" kutusu yalnızca API-Football
 * `/predictions` yanıtı kayda yazılmışsa doluyordu. Sağlayıcı bir fikstür
 * için tahmin üretmediğinde (ya da lig kapsamı dışındaysa) bölüm boş
 * kalıyordu: 661 üretilmiş maç sayfasının yalnızca BİRİNDE tahmin kartı
 * vardı. Kullanıcı açısından bu "veri yok" değil, "site bozuk" demekti.
 *
 * ÇÖZÜM. Tahmin tek bir uç noktaya değil, sıralı üç kaynağa bağlanır ve
 * her kaynak EKRANDA KENDİ ADIYLA anılır:
 *
 *   1. provider_prediction — API-Football `/predictions`   → "Sağlayıcı Tahmini"
 *   2. market_probability  — API-Football `/odds` (1X2)    → "Piyasa Olasılığı"
 *   3. futbolradar_model   — kendi istatistik modelimiz    → "FutbolRadar Tahmini"
 *
 * Sıra pazarlık konusu değil: sağlayıcının kendi modeli varken piyasa
 * oranından olasılık türetmek, piyasa oranı varken kendi modelimizi öne
 * çıkarmak, elimizdeki en güçlü sinyali çöpe atmak olurdu.
 *
 * ---------------------------------------------------------------------
 * ÜÇ KURAL
 * ---------------------------------------------------------------------
 *
 * 1. KAYNAK ASLA KARIŞMAZ. Piyasa oranından hesaplanan yüzde hiçbir
 *    koşulda "Sağlayıcı Tahmini" diye etiketlenmez; kendi modelimizin
 *    çıktısı da sağlayıcıya mal edilmez. `source` alanı kaydın kendisinde
 *    durur ve başlık ondan türetilir — iki ayrı yerde yazılsaydı biri
 *    değiştiğinde diğeri sessizce yalan söylerdi.
 *
 * 2. UYDURMA YOK. Sağlayıcı yüzdesi tutarsızsa (toplam 100'den uzak)
 *    kayıt REDDEDİLİR, düzeltilmez. Oran yoksa oran uydurulmaz. Model
 *    girdisi yetersizse model `null` döner ve zincir orada biter: boş
 *    bölüm, sahte sayıdan iyidir.
 *
 * 3. TOPLAM TAM 100. Üç yüzde her kaynakta tam sayıya yuvarlanır ve
 *    toplamları tam 100 olur (en büyük kalan yöntemi). "%33 %33 %33"
 *    gibi 99 eden bir bar, okuyucuya veri kalitesi hakkında yanlış
 *    fikir verir.
 */

const SOURCES = Object.freeze({
  PROVIDER: "provider_prediction",
  MARKET: "market_probability",
  MODEL: "futbolradar_model"
});

/** Öncelik sırası — zincirin TEK yazılı hâli. */
const SOURCE_PRIORITY = Object.freeze([SOURCES.PROVIDER, SOURCES.MARKET, SOURCES.MODEL]);

/**
 * Kaynağa göre başlık, simge ve açıklama. Arayüz bu tablodan okur;
 * başlığı çağıran tarafta elle yazmak, 1. kuralın ihlal edildiği ilk
 * yerdir.
 */
const DISPLAY = Object.freeze({
  [SOURCES.PROVIDER]: {
    icon: "📊",
    tr: {
      title: "Sağlayıcı Tahmini",
      note: "API-Football'un maç öncesi tahmin modelinden alınmıştır."
    },
    en: {
      title: "Provider prediction",
      note: "Taken from API-Football's own pre-match prediction model."
    }
  },
  [SOURCES.MARKET]: {
    icon: "📊",
    tr: {
      title: "Piyasa Olasılığı",
      note: "Mevcut maç öncesi oranlarından hesaplanmıştır."
    },
    en: {
      title: "Market probability",
      note: "Derived from the current pre-match betting odds."
    }
  },
  [SOURCES.MODEL]: {
    icon: "⚡",
    tr: {
      title: "FutbolRadar Tahmini",
      note: "Form, iç/dış saha performansı, gol istatistikleri ve geçmiş karşılaşmalar kullanılarak hesaplanmıştır."
    },
    en: {
      title: "FutbolRadar prediction",
      note: "Calculated from form, home/away performance, goal statistics and previous meetings."
    }
  }
});

/**
 * VERİ TEMELİ AÇIKLAMALARI — modelin kademesi ekranda saklanmaz.
 *
 * `futbolradar_model` kaydı iki takımın geçmişine dayanmıyorsa kartın
 * içine bu satır yazılır. Yüzdeyi göstermek ile yüzdenin neye dayandığını
 * göstermek ayrılmaz: ikincisi olmadan okuyucu, turnuva taban oranını
 * takımların karşılaştırması sanır.
 */
const DATA_BASIS_NOTES = Object.freeze({
  "partial-history": {
    tr: "Bu maçta yalnızca bir takımın doğrulanmış maç geçmişi var; diğer takım turnuva ortalamasıyla temsil edildi. Güven düşük.",
    en: "Only one of these teams has verified match history; the other is represented by the competition average. Confidence is low."
  },
  // Taban hangi havuzdan ölçüldüyse o yazılır. Turnuvada hiç tamamlanmış
  // maç yokken "bu turnuvanın oranı" demek, olmayan bir ölçüme atıf olurdu.
  "competition-baseline": {
    tr: "Bu maçta iki takımın da model için yeterli doğrulanmış maç geçmişi yok. Yüzdeler bu turnuvanın ölçülmüş ev sahibi/beraberlik/deplasman taban oranlarıdır; takımların güncel formunu yansıtmaz.",
    en: "Neither team has enough verified match history for the model. These percentages are the competition's measured home/draw/away base rates, not a read on either team's current form."
  },
  "competition-baseline:pool": {
    tr: "Bu maçta iki takımın da model için yeterli doğrulanmış maç geçmişi yok; bu turnuvada tamamlanmış maç da bulunmuyor. Yüzdeler, takip edilen tüm maçlardan ölçülmüş ev sahibi/beraberlik/deplasman taban oranlarıdır; takımların güncel formunu yansıtmaz.",
    en: "Neither team has enough verified match history, and this competition has no completed matches yet. These percentages are the home/draw/away base rates measured across every tracked match, not a read on either team's current form."
  }
});

/** 1X2 pazarının sağlayıcıdaki adları — `/odds` yanıtı paket başına değişiyor. */
const MATCH_WINNER_BET_IDS = new Set(["1"]);
const MATCH_WINNER_BET_NAMES = /^(match winner|1x2|full time result|home\/draw\/away|3way result)$/i;

const OUTCOME_ALIASES = Object.freeze({
  home: new Set(["home", "1", "home team", "ev sahibi"]),
  draw: new Set(["draw", "x", "tie", "beraberlik"]),
  away: new Set(["away", "2", "away team", "deplasman"])
});

/** Sağlayıcı yüzdelerinin kabul edildiği toplam aralığı (yuvarlama payı). */
const PROVIDER_SUM_TOLERANCE = Object.freeze({ min: 95, max: 105 });

/** Oran, olasılığa çevrilebilmesi için 1'den büyük olmalı. */
const MIN_DECIMAL_ODD = 1.01;
const MAX_DECIMAL_ODD = 1000;

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Üç değeri toplamı TAM 100 olan tam sayılara çevirir (en büyük kalan).
 * Eşitlikte sıra indeksine göre çözülür — aynı girdi her koşuda aynı
 * çıktıyı versin diye; "deterministik ve tekrar üretilebilir" şartı
 * tam olarak burada karşılanıyor.
 */
function normalizeTriple(values) {
  if (!Array.isArray(values) || values.length !== 3) return null;
  const numbers = values.map(Number);
  if (!numbers.every((value) => Number.isFinite(value) && value >= 0)) return null;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;

  const scaled = numbers.map((value) => (value / total) * 100);
  const floors = scaled.map((value) => Math.floor(value));
  const deficit = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = scaled
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  const result = floors.slice();
  for (let step = 0; step < deficit; step += 1) {
    result[order[step % order.length].index] += 1;
  }
  return { home: result[0], draw: result[1], away: result[2] };
}

function parsePercentValue(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

/**
 * Sağlayıcı yüzdeleri ("45%") → sayısal üçlü.
 * Toplam 100'den fazla saparsa REDDEDİLİR: sağlayıcının kendi verisiyle
 * çelişen bir yüzdeyi düzeltmek, düzeltilmiş hâli sağlayıcıya mal etmek
 * olurdu.
 *
 * ---------------------------------------------------------------------
 * SIFIR BİR OLASILIK DEĞİLDİR
 * ---------------------------------------------------------------------
 * Sağlayıcının yüzdeleri kaba geliyor: 5'in katları, sık sık 0. Üretimden
 * ölçüldü (15 Eylül 14:21 koşusu, 10 kayıt): Ajax - Willem II 50/50/0,
 * Elche - Real Madrid 0/50/50, Altay - Söke 1970 0/50/50. Bunlar
 * ayrıştırma hatası DEĞİL — sağlayıcının kendi `predictedWinner` ve
 * `advice` alanlarıyla tutarlılar.
 *
 * Ama %0, ekranda "bu takımın kazanma ihtimali yok" demektir ve bu
 * futbolda yanlıştır. Kaynağı doğru etiketlenmiş olsa bile yanlış bir
 * iddiayı yayımlamış oluruz. Elimizde daha iyisi varken (piyasa oranı
 * konsensüsü, sonra kendi modelimiz) bunu basmak için sebep yok.
 *
 * Bu yüzden üçlüde 0 varsa kayıt reddedilir ve zincir bir alt kaynağa
 * geçer. Düzeltme YAPILMAZ (ör. 0'ı %2'ye çekmek): düzeltilmiş bir sayıyı
 * sağlayıcıya mal etmek, 1. kuralın ihlalidir. Sağlayıcının kalan
 * alanları (tavsiye, ikili karşılaştırma) ham yükte durmaya devam eder.
 */
function parseProviderPercent(percent) {
  return providerPercentIssue(percent) ? null : normalizeTriple([
    parsePercentValue(percent.home),
    parsePercentValue(percent.draw),
    parsePercentValue(percent.away)
  ]);
}

/**
 * Yükün NEDEN kullanılamadığı — `null` ise kullanılabilir. Günlükte ve
 * zincir nedeninde "kullanılamaz" demek yetmiyordu: kotanın bittiği bir
 * koşu ile sağlayıcının %0 verdiği bir koşu aynı satırı yazıyordu.
 */
function providerPercentIssue(percent) {
  if (!percent) return "missing";
  const values = [percent.home, percent.draw, percent.away].map(parsePercentValue);
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) return "unparsable";
  const sum = values[0] + values[1] + values[2];
  if (sum < PROVIDER_SUM_TOLERANCE.min || sum > PROVIDER_SUM_TOLERANCE.max) return "sum-out-of-tolerance";
  const normalized = normalizeTriple(values);
  if (!normalized) return "unparsable";
  if (hasZeroOutcome(normalized)) return "zero-outcome";
  return null;
}

/** Üçlüde 0 var mı — bkz. parseProviderPercent başlığı. */
function hasZeroOutcome(probabilities) {
  if (!probabilities) return false;
  return [probabilities.home, probabilities.draw, probabilities.away]
    .some((value) => Number(value) === 0);
}

function comparisonBlock(comparison) {
  if (!comparison || typeof comparison !== "object") return null;
  const keys = ["form", "att", "def", "poisson_distribution", "h2h", "goals", "total"];
  const rows = {};
  for (const key of keys) {
    const entry = comparison[key];
    if (!entry || typeof entry !== "object") continue;
    const home = parsePercentValue(entry.home);
    const away = parsePercentValue(entry.away);
    if (home === null && away === null) continue;
    rows[key] = { home, away };
  }
  return Object.keys(rows).length ? rows : null;
}

function goalLine(goals) {
  if (!goals || typeof goals !== "object") return null;
  const home = goals.home === null || goals.home === undefined || goals.home === "" ? null : String(goals.home);
  const away = goals.away === null || goals.away === undefined || goals.away === "" ? null : String(goals.away);
  if (home === null && away === null) return null;
  return { home, away };
}

/**
 * API-Football `/predictions` ham yükünü kayıt biçimine çevirir.
 * Yüzdeler okunamıyorsa `null` döner — çağıran taraf bir sonraki kaynağa
 * geçer. Sağlayıcının verdiği diğer alanlar (tavsiye, kazanan, alt/üst,
 * beklenen gol, karşılaştırma) yalnızca VARSA taşınır.
 */
function normalizeProviderPrediction(raw, options = {}) {
  if (!raw || typeof raw !== "object") return null;
  const block = raw.predictions || {};
  const probabilities = parseProviderPercent(block.percent);
  if (!probabilities) return null;

  const winner = block.winner && (block.winner.name || block.winner.id)
    ? {
      id: block.winner.id === undefined || block.winner.id === null ? null : String(block.winner.id),
      name: block.winner.name ? String(block.winner.name) : null,
      comment: block.winner.comment ? String(block.winner.comment) : null
    }
    : null;

  return {
    source: SOURCES.PROVIDER,
    probabilities,
    predictedWinner: winner,
    winOrDraw: typeof block.win_or_draw === "boolean" ? block.win_or_draw : null,
    advice: block.advice ? String(block.advice) : null,
    underOver: block.under_over === null || block.under_over === undefined || block.under_over === ""
      ? null
      : String(block.under_over),
    predictedGoals: goalLine(block.goals),
    comparison: comparisonBlock(raw.comparison),
    providerUpdatedAt: options.providerUpdatedAt || null,
    confidence: null
  };
}

/** Ondalık oran → örtük olasılık. Marj burada ÇIKARILMAZ; normalize eder. */
function impliedProbability(decimalOdd) {
  if (!isFiniteNumber(decimalOdd)) return null;
  const odd = Number(decimalOdd);
  if (odd < MIN_DECIMAL_ODD || odd > MAX_DECIMAL_ODD) return null;
  return 1 / odd;
}

function outcomeKeyFor(value) {
  const label = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
  if (!label) return null;
  for (const [key, aliases] of Object.entries(OUTCOME_ALIASES)) {
    if (aliases.has(label)) return key;
  }
  return null;
}

function isMatchWinnerBet(bet) {
  if (!bet) return false;
  if (bet.id !== undefined && bet.id !== null && MATCH_WINNER_BET_IDS.has(String(bet.id))) return true;
  return MATCH_WINNER_BET_NAMES.test(String(bet.name || "").trim());
}

/** Tek bir bahisçinin 1X2 satırı → marjdan arındırılmış olasılık üçlüsü. */
function bookmakerProbabilities(bet) {
  const values = Array.isArray(bet && bet.values) ? bet.values : [];
  const odds = { home: null, draw: null, away: null };
  for (const row of values) {
    const key = outcomeKeyFor(row && row.value);
    if (!key || odds[key] !== null) continue;
    const odd = Number(row && row.odd);
    if (!Number.isFinite(odd)) continue;
    odds[key] = odd;
  }
  const implied = {
    home: impliedProbability(odds.home),
    draw: impliedProbability(odds.draw),
    away: impliedProbability(odds.away)
  };
  // ÜÇ SONUCUN ÜÇÜ DE gerekli: eksik bir ayakla normalize etmek, eksik
  // olasılığı diğer ikisine dağıtmak olurdu — yani uydurmak.
  if (![implied.home, implied.draw, implied.away].every((value) => Number.isFinite(value))) return null;
  const gross = implied.home + implied.draw + implied.away;
  if (!(gross > 0)) return null;
  return {
    odds,
    // Bahisçi marjı: 1X2'nin örtük olasılık toplamı her zaman 1'i aşar.
    margin: gross - 1,
    probabilities: {
      home: implied.home / gross,
      draw: implied.draw / gross,
      away: implied.away / gross
    }
  };
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * API-Football `/odds` ham yükü → konsensüs 1X2 olasılığı.
 *
 * Tek bahisçi de yeter ama birden fazla varsa MEDYAN alınır: ortalama,
 * tek bir uç oranın (yanlış girilmiş ya da askıya alınmış bir satırın)
 * konsensüsü sürüklemesine izin verir; medyan vermez.
 *
 * Marj her bahisçide AYRI çıkarılır, sonra medyan alınır. Önce medyan
 * alıp sonra tek bir marj varsaymak, farklı marjla çalışan bahisçileri
 * aynı kefeye koymak olurdu.
 */
function consensusFromOdds(rawOdds, options = {}) {
  const items = Array.isArray(rawOdds) ? rawOdds : rawOdds ? [rawOdds] : [];
  const rows = [];
  let updatedAt = options.oddsUpdatedAt || null;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (!updatedAt && item.update) updatedAt = String(item.update);
    const bookmakers = Array.isArray(item.bookmakers) ? item.bookmakers : [];
    for (const bookmaker of bookmakers) {
      const bets = Array.isArray(bookmaker && bookmaker.bets) ? bookmaker.bets : [];
      const bet = bets.find(isMatchWinnerBet);
      if (!bet) continue;
      const parsed = bookmakerProbabilities(bet);
      if (!parsed) continue;
      rows.push({
        name: bookmaker.name ? String(bookmaker.name) : null,
        id: bookmaker.id === undefined || bookmaker.id === null ? null : String(bookmaker.id),
        ...parsed
      });
    }
  }

  if (!rows.length) return null;

  const consensus = normalizeTriple([
    median(rows.map((row) => row.probabilities.home)),
    median(rows.map((row) => row.probabilities.draw)),
    median(rows.map((row) => row.probabilities.away))
  ]);
  if (!consensus) return null;

  const margins = rows.map((row) => row.margin).filter(Number.isFinite);
  const bookmakers = rows
    .map((row) => row.name)
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .sort();

  return {
    source: SOURCES.MARKET,
    probabilities: consensus,
    bookmakerCount: rows.length,
    bookmakers,
    consensusMethod: rows.length > 1 ? "median" : "single",
    averageMargin: margins.length ? Number((margins.reduce((sum, value) => sum + value, 0) / margins.length).toFixed(4)) : null,
    oddsUpdatedAt: updatedAt,
    predictedWinner: null,
    advice: null,
    underOver: null,
    predictedGoals: null,
    comparison: null,
    // Konsensüs güveni bahisçi sayısıyla artar ama tek bahisçide bile
    // piyasa, kendi modelimizden daha çok bilgi taşır.
    confidence: clamp(55 + rows.length * 5, 55, 90)
  };
}

/**
 * ZİNCİRİ ÇÖZER. Girdilerden ilk KULLANILABİLİR olanı döner; hangi üst
 * kaynakların neden atlandığı kayıtta durur (`fallbackChain`), çünkü
 * "neden sağlayıcı tahmini yok" sorusunun cevabı üretim sonrası en çok
 * sorulan sorudur.
 */
function resolveFixtureProbability(candidates = {}) {
  const chain = [];
  const bySource = {
    [SOURCES.PROVIDER]: candidates.provider || null,
    [SOURCES.MARKET]: candidates.market || null,
    [SOURCES.MODEL]: candidates.model || null
  };
  const reasons = candidates.reasons || {};

  for (const source of SOURCE_PRIORITY) {
    const candidate = bySource[source];
    if (candidate && candidate.probabilities) {
      return { ...candidate, source, fallbackChain: chain.slice() };
    }
    chain.push({ source, reason: reasons[source] || "unavailable" });
  }

  return null;
}

/** Başlık/simge/açıklama — arayüzün TEK kaynağı. */
function displayFor(source, locale = "tr") {
  const entry = DISPLAY[source];
  if (!entry) return null;
  const text = entry[locale] || entry.tr;
  return { source, icon: entry.icon, title: text.title, note: text.note };
}

/**
 * Kaydın veri temeli sınırlıysa okunabilir açıklama, değilse `null`.
 * Yalnızca model kaynağı için anlamlı: sağlayıcı ve piyasa kayıtlarının
 * temeli zaten kendi başlıklarında yazılı.
 */
function dataBasisNote(record, locale = "tr") {
  if (!record || record.source !== SOURCES.MODEL) return null;
  const scoped = record.baselineScope === "pool" ? `${record.dataBasis}:pool` : null;
  const entry = (scoped && DATA_BASIS_NOTES[scoped]) || DATA_BASIS_NOTES[record.dataBasis];
  if (!entry) return null;
  return entry[locale] || entry.tr;
}

/**
 * Kartın üst açıklaması — kaydın gerçeğine göre.
 *
 * Model kaydının varsayılan açıklaması "form, iç/dış saha performansı, gol
 * istatistikleri ve geçmiş karşılaşmalar" diyor. Takım geçmişi olmadan
 * üretilmiş bir tahminde bunların HİÇBİRİ kullanılmadı; cümleyi olduğu gibi
 * basmak, kaydın sınırını başlığın hemen altında gizlemek olurdu.
 */
function displayNoteFor(record, locale = "tr") {
  const display = displayFor(record && record.source, locale);
  if (!display) return null;
  if (record && record.source === SOURCES.MODEL && record.dataBasis === "competition-baseline") {
    return locale === "en"
      ? "Calculated by FutbolRadar's own statistical model."
      : "FutbolRadar'ın kendi istatistik modelinden hesaplanmıştır.";
  }
  return display.note;
}

/** Bar sıralaması ve "öne çıkan" satırın belirlenmesi için yardımcı. */
function leadingOutcome(probabilities) {
  if (!probabilities) return null;
  const rows = [
    { key: "home", value: Number(probabilities.home) },
    { key: "draw", value: Number(probabilities.draw) },
    { key: "away", value: Number(probabilities.away) }
  ];
  if (!rows.every((row) => Number.isFinite(row.value))) return null;
  return rows.reduce((best, row) => (row.value > best.value ? row : best)).key;
}

/** Kayıt gerçekten gösterilebilir mi — üç yüzde var ve toplamı 100 mü. */
function isDisplayable(record) {
  if (!record || !record.probabilities) return false;
  const { home, draw, away } = record.probabilities;
  if (![home, draw, away].every((value) => Number.isFinite(Number(value)))) return false;
  return Number(home) + Number(draw) + Number(away) === 100;
}

module.exports = {
  SOURCES,
  SOURCE_PRIORITY,
  DISPLAY,
  DATA_BASIS_NOTES,
  dataBasisNote,
  displayNoteFor,
  normalizeTriple,
  parsePercentValue,
  parseProviderPercent,
  providerPercentIssue,
  hasZeroOutcome,
  normalizeProviderPrediction,
  impliedProbability,
  bookmakerProbabilities,
  consensusFromOdds,
  resolveFixtureProbability,
  displayFor,
  leadingOutcome,
  isDisplayable
};
