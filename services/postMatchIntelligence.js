/**
 * MAÇ SONRASI ANALİZ KATMANI — yalnızca ölçülmüş veriden.
 *
 * KURAL: her bölüm, dayandığı istatistikler mevcut değilse HİÇ ÜRETİLMEZ.
 * null döner ve sunum katmanı onu atlar. Yer tutucu, sıfır değer ya da
 * "veri yok" kartı basılmaz — boş bir bölüm, okuyucuya ölçüm yapılmış ama
 * sonuç çıkmamış izlenimi verir.
 *
 * TÜRETİLMİŞ ÖLÇÜLER AÇIKÇA İŞARETLENİR. "Pres yoğunluğu" ve "kuruluş
 * verimliliği" sağlayıcıdan hazır gelmiyor; burada tanımlı formüllerle
 * hesaplanıyor. Her türetilmiş bölüm formülünü ve girdilerini taşır, çünkü
 * belgelenmemiş bir formülden çıkan sayı, uydurma bir sayıdan ayırt
 * edilemez.
 *
 * VERİ KAYNAĞI: data/matches.json — sağlayıcının maç istatistikleri
 * (statistics[]) ve olay akışı (events[]). Başka hiçbir girdi yok.
 *
 * BULUNMAYAN BÖLÜMLER: geçiş oyunu analizi (top kaybı/kazanımı sonrası
 * atak verisi yok), pas ağı (oyuncu-oyuncu pas çifti verisi yok) ve en
 * zayıf performanslar (oyuncu bazlı derecelendirme yok). Bunlar
 * uydurulmuyor; sağlayıcı bu alanları döndürdüğünde eklenebilirler.
 */

const { normalizeText } = require("./matchRadarService");

/** Güven düzeyi: kaç girdinin gerçekten ölçülmüş olduğuna bağlı. */
function confidenceFor(available, required) {
  const ratio = required ? available / required : 0;
  if (ratio >= 1) return { level: "yüksek", ratio };
  if (ratio >= 0.66) return { level: "orta", ratio };
  return { level: "sınırlı", ratio };
}

function statRow(match, type) {
  const rows = Array.isArray(match.statistics) ? match.statistics : [];
  return rows.find((row) => normalizeText(row.type) === normalizeText(type)) || null;
}

function pair(match, type) {
  const row = statRow(match, type);
  if (!row) return null;
  const home = Number(row.home);
  const away = Number(row.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away, unit: row.unit || "", label: row.type };
}

/** İstenen ölçüleri toplar; kaçının bulunduğunu da döner. */
function collect(match, types) {
  const found = {};
  let available = 0;
  for (const [key, type] of Object.entries(types)) {
    const value = pair(match, type);
    if (value) {
      found[key] = value;
      available += 1;
    }
  }
  return { found, available, required: Object.keys(types).length };
}

function leaderOf(value, match) {
  if (!value || value.home === value.away) return null;
  return value.home > value.away ? match.homeTeam : match.awayTeam;
}

/**
 * YÜZDE döndürür (×100). Adı yanıltıcıydı: "şut başına pas" gibi düz bir
 * oranda kullanılınca 762/15 = 50,8 yerine 5080 yazdırdı ve sayfada
 * "5080,0 şut başına pas" göründü. Ölçümü doğrulayan testler geçmişti;
 * hatayı yalnızca sayfaya bakmak gösterdi.
 */
function percentage(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Düz oran (×100 YOK): "şut başına pas" gibi ölçüler için. */
function plainRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Math.round((numerator / denominator) * 10) / 10;
}

function section(id, title, body) {
  return body ? { id, title, ...body } : null;
}

// ── Hücum ───────────────────────────────────────────────────────────────────

function attackingAnalysis(match) {
  const { found, available, required } = collect(match, {
    shots: "Toplam şut",
    onTarget: "İsabetli şut",
    xg: "Gol beklentisi (xG)",
    bigChances: "Kaçan net pozisyon",
    boxTouches: "Rakip ceza sahasında topla buluşma"
  });

  // En az şut verisi olmadan hücum okuması yapılamaz.
  if (!found.shots) return null;

  const metrics = [];
  const readings = [];

  metrics.push({ label: "Toplam şut", home: found.shots.home, away: found.shots.away });
  if (found.onTarget) {
    metrics.push({ label: "İsabetli şut", home: found.onTarget.home, away: found.onTarget.away });
    const homeAccuracy = percentage(found.onTarget.home, found.shots.home);
    const awayAccuracy = percentage(found.onTarget.away, found.shots.away);
    if (homeAccuracy !== null && awayAccuracy !== null) {
      readings.push(`Şut isabeti ${match.homeTeam} %${homeAccuracy}, ${match.awayTeam} %${awayAccuracy}.`);
    }
  }
  if (found.xg) {
    metrics.push({ label: "xG", home: found.xg.home, away: found.xg.away, decimals: 2 });
  }
  if (found.boxTouches) {
    metrics.push({ label: "Ceza sahasında buluşma", home: found.boxTouches.home, away: found.boxTouches.away });
    const leader = leaderOf(found.boxTouches, match);
    if (leader) readings.push(`${leader} rakip ceza sahasında belirgin biçimde daha çok top buluşması üretti.`);
  }
  if (found.bigChances && (found.bigChances.home || found.bigChances.away)) {
    metrics.push({ label: "Kaçan net pozisyon", home: found.bigChances.home, away: found.bigChances.away });
  }

  return section("hucum", "Hücum analizi", {
    metrics,
    readings,
    confidence: confidenceFor(available, required),
    sources: ["Sağlayıcı maç istatistikleri"]
  });
}

// ── Savunma ─────────────────────────────────────────────────────────────────

function defensiveAnalysis(match) {
  const { found, available, required } = collect(match, {
    clearances: "Uzaklaştırma",
    interceptions: "Pasa müdahale",
    tackles: "Başarılı top kapma",
    aerials: "Kazanılan hava topu",
    fouls: "Faul"
  });

  if (!found.clearances && !found.interceptions && !found.tackles) return null;

  const metrics = [];
  const readings = [];

  for (const [key, label] of [["clearances", "Uzaklaştırma"], ["interceptions", "Pasa müdahale"],
    ["tackles", "Başarılı top kapma"], ["aerials", "Kazanılan hava topu"], ["fouls", "Faul"]]) {
    if (found[key]) metrics.push({ label, home: found[key].home, away: found[key].away });
  }

  if (found.clearances) {
    const leader = leaderOf(found.clearances, match);
    const gap = Math.abs(found.clearances.home - found.clearances.away);
    if (leader && gap >= 10) {
      readings.push(`${leader} ${Math.max(found.clearances.home, found.clearances.away)} uzaklaştırma yaptı; ` +
        "bu hacim, topu oyun alanından çıkarmaya dayalı bir savunmayı gösteriyor.");
    }
  }

  return section("savunma", "Savunma performansı", {
    metrics,
    readings,
    confidence: confidenceFor(available, required),
    sources: ["Sağlayıcı maç istatistikleri"]
  });
}

// ── Topa sahip olma kalitesi ────────────────────────────────────────────────

function possessionQuality(match) {
  const { found, available, required } = collect(match, {
    possession: "Topla oynama",
    passAccuracy: "Pas isabeti",
    totalPasses: "Toplam pas",
    boxTouches: "Rakip ceza sahasında topla buluşma"
  });

  if (!found.possession) return null;

  const metrics = [
    { label: "Topla oynama", home: found.possession.home, away: found.possession.away, unit: "%" }
  ];
  const readings = [];

  if (found.passAccuracy) {
    metrics.push({ label: "Pas isabeti", home: found.passAccuracy.home, away: found.passAccuracy.away, unit: "%" });
  }
  if (found.totalPasses) {
    metrics.push({ label: "Toplam pas", home: found.totalPasses.home, away: found.totalPasses.away });
  }

  // Sahiplik KALİTESİ: yüzde tek başına bir şey söylemiyor. Ceza sahasına
  // dönüşen sahiplik ile steril sahiplik farkı ölçülebiliyorsa yazılır.
  if (found.totalPasses && found.boxTouches) {
    const homeEfficiency = percentage(found.boxTouches.home, found.totalPasses.home);
    const awayEfficiency = percentage(found.boxTouches.away, found.totalPasses.away);
    if (homeEfficiency !== null && awayEfficiency !== null) {
      readings.push(`Yüz pas başına ceza sahası buluşması: ${match.homeTeam} ${homeEfficiency}, ` +
        `${match.awayTeam} ${awayEfficiency}. Sahiplik yüzdesi tek başına değil, ceza sahasına ` +
        "dönüşüm oranıyla birlikte okunmalı.");
    }
  }

  return section("sahiplik", "Topa sahip olma kalitesi", {
    metrics,
    readings,
    confidence: confidenceFor(available, required),
    sources: ["Sağlayıcı maç istatistikleri"]
  });
}

// ── Pres yoğunluğu (TÜRETİLMİŞ) ─────────────────────────────────────────────

function pressingIntensity(match) {
  const { found } = collect(match, {
    tackles: "Başarılı top kapma",
    interceptions: "Pasa müdahale",
    fouls: "Faul",
    possession: "Topla oynama"
  });

  // Üç savunma aksiyonu da yoksa pres okuması yapılamaz.
  if (!found.tackles || !found.interceptions) return null;

  const homeActions = found.tackles.home + found.interceptions.home + (found.fouls ? found.fouls.home : 0);
  const awayActions = found.tackles.away + found.interceptions.away + (found.fouls ? found.fouls.away : 0);

  // Rakibin topla oynadığı süreye göre normalize: az topa sahip olan takım
  // doğal olarak daha çok savunma aksiyonu yapar. Bu düzeltme olmadan
  // "pres yoğunluğu" yalnızca sahipliğin tersini ölçerdi.
  const homeOpponentShare = found.possession ? found.possession.away : 50;
  const awayOpponentShare = found.possession ? found.possession.home : 50;
  const homeIndex = homeOpponentShare ? Math.round((homeActions / homeOpponentShare) * 100) / 10 : null;
  const awayIndex = awayOpponentShare ? Math.round((awayActions / awayOpponentShare) * 100) / 10 : null;

  if (homeIndex === null || awayIndex === null) return null;

  return section("pres", "Pres yoğunluğu", {
    metrics: [
      { label: "Savunma aksiyonu", home: homeActions, away: awayActions },
      { label: "Pres endeksi", home: homeIndex, away: awayIndex, decimals: 1 }
    ],
    readings: [
      homeIndex === awayIndex
        ? "İki takımın pres endeksi eşit."
        : `${homeIndex > awayIndex ? match.homeTeam : match.awayTeam} rakibin topla oynadığı süre başına daha çok savunma aksiyonu üretti.`
    ],
    // TÜRETİLMİŞ ÖLÇÜ: formül açıkça bildirilir.
    derived: {
      formula: "(başarılı top kapma + pasa müdahale + faul) ÷ rakibin topla oynama yüzdesi × 10",
      inputs: ["Başarılı top kapma", "Pasa müdahale", "Faul", "Topla oynama"],
      note: "Sağlayıcı hazır bir pres ölçüsü döndürmüyor; bu endeks yukarıdaki dört ölçülmüş " +
        "girdiden hesaplanır. Rakibin sahiplik süresine bölünmesi, az topa sahip olan takımın " +
        "doğal aksiyon fazlasını düzeltmek içindir."
    },
    confidence: confidenceFor(found.fouls && found.possession ? 4 : 3, 4),
    sources: ["Sağlayıcı maç istatistikleri", "FutbolRadar türetilmiş endeks"]
  });
}

// ── Kuruluş verimliliği (TÜRETİLMİŞ) ────────────────────────────────────────

function buildUpEfficiency(match) {
  const { found } = collect(match, {
    totalPasses: "Toplam pas",
    accuratePasses: "İsabetli pas",
    boxTouches: "Rakip ceza sahasında topla buluşma",
    shots: "Toplam şut"
  });

  if (!found.totalPasses || !found.shots) return null;

  const homePassesPerShot = plainRatio(found.totalPasses.home, found.shots.home);
  const awayPassesPerShot = plainRatio(found.totalPasses.away, found.shots.away);
  if (homePassesPerShot === null || awayPassesPerShot === null) return null;

  const metrics = [
    { label: "Şut başına pas", home: homePassesPerShot, away: awayPassesPerShot, decimals: 1 }
  ];
  if (found.accuratePasses) {
    metrics.push({ label: "İsabetli pas", home: found.accuratePasses.home, away: found.accuratePasses.away });
  }
  if (found.boxTouches) {
    metrics.push({ label: "Ceza sahasında buluşma", home: found.boxTouches.home, away: found.boxTouches.away });
  }

  return section("kurulus", "Kuruluş verimliliği", {
    metrics,
    readings: [
      `Bir şut üretmek için ${match.homeTeam} ${homePassesPerShot}, ${match.awayTeam} ${awayPassesPerShot} pas kullandı. ` +
      "Düşük değer, daha az dokunuşla şuta ulaşan bir kuruluşu gösterir."
    ],
    derived: {
      formula: "toplam pas ÷ toplam şut",
      inputs: ["Toplam pas", "Toplam şut"],
      note: "Sağlayıcı hazır bir kuruluş ölçüsü döndürmüyor; oran iki ölçülmüş girdiden hesaplanır."
    },
    confidence: confidenceFor(found.accuratePasses && found.boxTouches ? 4 : 2, 4),
    sources: ["Sağlayıcı maç istatistikleri", "FutbolRadar türetilmiş oran"]
  });
}

// ── Duran top ───────────────────────────────────────────────────────────────

function setPieceEffectiveness(match) {
  const { found, available, required } = collect(match, {
    corners: "Korner",
    crosses: "Toplam orta",
    accurateCrosses: "İsabetli orta",
    throwIns: "Taç atışı"
  });

  if (!found.corners && !found.crosses) return null;

  const metrics = [];
  const readings = [];

  if (found.corners) metrics.push({ label: "Korner", home: found.corners.home, away: found.corners.away });
  if (found.crosses) metrics.push({ label: "Toplam orta", home: found.crosses.home, away: found.crosses.away });
  if (found.accurateCrosses) {
    metrics.push({ label: "İsabetli orta", home: found.accurateCrosses.home, away: found.accurateCrosses.away });
    if (found.crosses) {
      const homeRate = percentage(found.accurateCrosses.home, found.crosses.home);
      const awayRate = percentage(found.accurateCrosses.away, found.crosses.away);
      if (homeRate !== null && awayRate !== null) {
        readings.push(`Orta isabeti ${match.homeTeam} %${homeRate}, ${match.awayTeam} %${awayRate}.`);
      }
    }
  }
  if (found.throwIns) metrics.push({ label: "Taç atışı", home: found.throwIns.home, away: found.throwIns.away });

  return section("durantop", "Duran top ve orta oyunu", {
    metrics,
    readings,
    confidence: confidenceFor(available, required),
    sources: ["Sağlayıcı maç istatistikleri"]
  });
}

// ── Şut kalitesi ────────────────────────────────────────────────────────────

function shotQuality(match) {
  const { found } = collect(match, {
    shots: "Toplam şut",
    onTarget: "İsabetli şut",
    blocked: "Engellenen şut",
    offTarget: "İsabetsiz şut",
    woodwork: "Direkten dönen şut",
    xg: "Gol beklentisi (xG)"
  });

  if (!found.shots) return null;

  const metrics = [];
  const readings = [];

  for (const [key, label] of [["onTarget", "İsabetli"], ["offTarget", "İsabetsiz"],
    ["blocked", "Engellenen"], ["woodwork", "Direkten dönen"]]) {
    if (found[key]) metrics.push({ label, home: found[key].home, away: found[key].away });
  }

  // xG varsa şut BAŞINA xG: hacim değil, pozisyon kalitesi.
  if (found.xg) {
    const homePerShot = found.shots.home ? Math.round((found.xg.home / found.shots.home) * 1000) / 1000 : null;
    const awayPerShot = found.shots.away ? Math.round((found.xg.away / found.shots.away) * 1000) / 1000 : null;
    if (homePerShot !== null && awayPerShot !== null) {
      metrics.push({ label: "Şut başına xG", home: homePerShot, away: awayPerShot, decimals: 3 });
      readings.push(`Şut başına xG ${match.homeTeam} ${homePerShot}, ${match.awayTeam} ${awayPerShot}. ` +
        "Bu oran, şut hacminden bağımsız olarak pozisyonların kalitesini gösterir.");
    }
  }

  if (!metrics.length) return null;

  return section("sutkalitesi", "Şut kalitesi", {
    metrics,
    readings,
    confidence: confidenceFor(Object.keys(found).length, 6),
    sources: found.xg
      ? ["Sağlayıcı maç istatistikleri (xG dahil)"]
      : ["Sağlayıcı maç istatistikleri"]
  });
}

// ── Anahtar performanslar (olaylardan) ──────────────────────────────────────

/**
 * Oyuncu bazlı derecelendirme verisi YOK. Bu yüzden "en iyi/en zayıf oyuncu"
 * sıralaması üretilmiyor. Yalnızca olay akışında ADI GEÇEN katkılar
 * listeleniyor — gol ve asist gibi tartışmasız kayıtlar.
 *
 * "En zayıf performanslar" bölümü hiç üretilmiyor: bir oyuncuyu kötü ilan
 * etmek için ölçüm gerekir, olay akışında böyle bir ölçü yok.
 */
function keyPerformers(match) {
  const events = Array.isArray(match.events) ? match.events : [];
  const contributions = new Map();

  for (const event of events) {
    const type = normalizeText(event.type || "");
    if (!type.includes("gol")) continue;

    const detail = String(event.detail || "");
    const nameMatch = detail.match(/^([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,2})/u);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    const team = (event.team && event.team.name) || event.team || "";
    const key = `${name}|${team}`;
    const existing = contributions.get(key) || { name, team, goals: 0, minutes: [] };
    existing.goals += 1;
    if (event.time) existing.minutes.push(String(event.time));
    contributions.set(key, existing);
  }

  const performers = [...contributions.values()].filter((item) => item.goals > 0);
  if (!performers.length) return null;

  return section("performans", "Öne çıkan katkılar", {
    performers: performers.sort((left, right) => right.goals - left.goals),
    readings: [],
    confidence: confidenceFor(1, 1),
    note: "Yalnızca olay akışında adı geçen goller listelenir. Oyuncu bazlı derecelendirme " +
      "verisi bulunmadığı için performans sıralaması yapılmıyor.",
    sources: ["Sağlayıcı olay akışı"]
  });
}

// ── Taktik özet ve sonuç ────────────────────────────────────────────────────

/**
 * Taktik özet, YALNIZCA yukarıdaki bölümlerden üretilen cümlelerden oluşur.
 * Hiçbir cümle ölçülmemiş bir iddia taşımaz; her biri hangi bölümden
 * geldiğini belirtir.
 */
function tacticalSummary(sections, match) {
  const lines = [];

  const possession = sections.find((item) => item && item.id === "sahiplik");
  const attacking = sections.find((item) => item && item.id === "hucum");
  const pressing = sections.find((item) => item && item.id === "pres");

  if (possession) {
    const metric = possession.metrics.find((item) => item.label === "Topla oynama");
    if (metric && metric.home !== metric.away) {
      const leader = metric.home > metric.away ? match.homeTeam : match.awayTeam;
      lines.push({
        text: `${leader} topa sahip olma üstünlüğü kurdu (%${Math.max(metric.home, metric.away)}).`,
        basis: "Topla oynama"
      });
    }
  }

  if (attacking) {
    const shots = attacking.metrics.find((item) => item.label === "Toplam şut");
    if (shots && shots.home !== shots.away) {
      const leader = shots.home > shots.away ? match.homeTeam : match.awayTeam;
      lines.push({
        text: `Şut üretimi ${shots.home}-${shots.away} ile ${leader} lehine sonuçlandı.`,
        basis: "Toplam şut"
      });
    }
  }

  if (pressing) {
    const index = pressing.metrics.find((item) => item.label === "Pres endeksi");
    if (index && index.home !== index.away) {
      lines.push({
        text: `${index.home > index.away ? match.homeTeam : match.awayTeam} pres endeksinde önde.`,
        basis: "Pres endeksi (türetilmiş)"
      });
    }
  }

  if (!lines.length) return null;

  return section("taktik", "Taktik özet", {
    lines,
    confidence: confidenceFor(lines.length, 3),
    sources: ["Yukarıdaki bölümlerin ölçülmüş girdileri"]
  });
}

/**
 * Maç sonucu yorumu. Skor ve ölçülmüş üstünlük birlikte okunur; ikisi
 * ayrıştığında bu AÇIKÇA söylenir — "hak etti" gibi bir iddia yerine
 * ölçünün ne dediği yazılır.
 */
function matchConclusion(sections, match) {
  const score = match.score || {};
  if (!Number.isFinite(Number(score.home)) || !Number.isFinite(Number(score.away))) return null;

  const attacking = sections.find((item) => item && item.id === "hucum");
  const xg = attacking && attacking.metrics.find((item) => item.label === "xG");
  if (!xg) return null;

  const scoreDiff = Number(score.home) - Number(score.away);
  const xgDiff = xg.home - xg.away;
  const aligned = (scoreDiff > 0 && xgDiff > 0) || (scoreDiff < 0 && xgDiff < 0) ||
    (scoreDiff === 0 && Math.abs(xgDiff) < 0.5);

  const text = aligned
    ? `Skor ve gol beklentisi aynı yönü gösteriyor: xG ${xg.home}-${xg.away}, skor ${score.home}-${score.away}.`
    : `Skor ile gol beklentisi ayrışıyor: xG ${xg.home}-${xg.away} iken skor ${score.home}-${score.away}. ` +
      "Ölçüm, sonucun tek başına oyunun tamamını anlatmadığını gösteriyor.";

  return section("sonuc", "Maç sonucu okuması", {
    lines: [{ text, basis: "xG ve skor" }],
    confidence: confidenceFor(1, 1),
    sources: ["Sağlayıcı maç istatistikleri"]
  });
}

/**
 * Tüm bölümleri üretir. Verisi olmayan bölüm listeye HİÇ girmez.
 *
 * @returns {{sections: Array, omitted: string[], coverage: number}}
 */
function buildPostMatchIntelligence(match) {
  if (!match || String(match.status || "").toUpperCase() !== "FINISHED") {
    return { sections: [], omitted: [], coverage: 0 };
  }

  const builders = [
    ["hucum", attackingAnalysis],
    ["savunma", defensiveAnalysis],
    ["sahiplik", possessionQuality],
    ["pres", pressingIntensity],
    ["kurulus", buildUpEfficiency],
    ["durantop", setPieceEffectiveness],
    ["sutkalitesi", shotQuality],
    ["performans", keyPerformers]
  ];

  const sections = [];
  const omitted = [];

  for (const [id, builder] of builders) {
    const result = builder(match);
    if (result) sections.push(result);
    else omitted.push(id);
  }

  const tactical = tacticalSummary(sections, match);
  if (tactical) sections.push(tactical);
  else omitted.push("taktik");

  const conclusion = matchConclusion(sections, match);
  if (conclusion) sections.push(conclusion);
  else omitted.push("sonuc");

  // Veri olmadığı için hiç uygulanmayan analizler. Bunlar "eksik" değil,
  // sağlayıcının bu alanları döndürmediği anlamına gelir.
  const unsupported = ["gecis-oyunu", "pas-agi", "en-zayif-performans"];

  return {
    sections,
    omitted: omitted.concat(unsupported),
    coverage: Math.round((sections.length / (builders.length + 2)) * 100)
  };
}

module.exports = {
  buildPostMatchIntelligence,
  attackingAnalysis,
  defensiveAnalysis,
  possessionQuality,
  pressingIntensity,
  buildUpEfficiency,
  setPieceEffectiveness,
  shotQuality,
  keyPerformers,
  tacticalSummary,
  matchConclusion,
  confidenceFor
};
