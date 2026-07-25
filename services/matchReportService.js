/**
 * Tamamlanan maçlar için otomatik maç raporu üretir.
 *
 * Tasarım kuralı: her cümle maçın gerçek verisinden türer. Veri yoksa bölüm
 * "unavailable" döner ve sayfa bunu açıkça yazar — model, eksik veriyi
 * doldurmak için tahmin üretmez. Bu, sitenin geri kalanındaki "doğrulanmamış
 * veri yayımlanmaz" kuralının rapor katmanındaki karşılığıdır.
 *
 * Üretim deterministiktir: aynı maç verisi her zaman aynı raporu verir, bu
 * yüzden build çıktısı tekrarlanabilir ve diff'ler gürültüsüzdür.
 */

const VOICELESS = new Set(["f", "s", "t", "k", "ç", "ş", "h", "p"]);
const BACK_VOWELS = new Set(["a", "ı", "o", "u"]);
const VOWELS = "aeıioöuüAEIİOÖUÜ";

function lastVowel(word) {
  const clean = String(word || "").toLocaleLowerCase("tr-TR");
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    if (VOWELS.includes(clean[i])) return clean[i];
  }
  return "";
}

function endsWithVowel(word) {
  const clean = String(word || "").trim().toLocaleLowerCase("tr-TR");
  const last = clean[clean.length - 1] || "";
  // Yabancı adlarda sondaki "y" sesli okunur (Hull City -> City'yi, Derby ->
  // Derby'yi); Türkçe ek pratiği yazıma değil okunuşa bakar.
  if (last === "y" && clean.length > 1 && !VOWELS.includes(clean[clean.length - 2])) return true;
  return VOWELS.includes(last);
}

/**
 * 3. tekil iyelik eki taşıyan yer adları ("... Stadyumu", "... Parkı") hâl
 * eki almadan önce kaynaştırma "n"si ister: Stadyumu'nda, Parkı'nda.
 */
function isPossessivePlace(name) {
  return /(stadyum|stad|park|saha|tesis|kompleks|arena)\w*[uüıi]$/i.test(String(name || "").trim());
}

function lastLetter(word) {
  const clean = String(word || "").trim().toLocaleLowerCase("tr-TR");
  return clean[clean.length - 1] || "";
}

/** Belirtme hâli: "Galatasaray'ı", "Fenerbahçe'yi". */
function accusative(name) {
  const vowel = lastVowel(name);
  const suffix = BACK_VOWELS.has(vowel)
    ? (vowel === "o" || vowel === "u" ? "u" : "ı")
    : (vowel === "ö" || vowel === "ü" ? "ü" : "i");
  return `${name}'${endsWithVowel(name) ? "y" : ""}${suffix}`;
}

/** Yönelme hâli: "Trabzonspor'a", "Beşiktaş'a", "Monza'ya". */
function dative(name) {
  const suffix = BACK_VOWELS.has(lastVowel(name)) ? "a" : "e";
  return `${name}'${endsWithVowel(name) ? "y" : ""}${suffix}`;
}

/** Bulunma hâli: "Kadıköy'de", "Linz'de", "Tüpraş Stadyumu'nda". */
function locative(name) {
  const back = BACK_VOWELS.has(lastVowel(name));
  if (isPossessivePlace(name)) {
    return `${name}'n${back ? "da" : "de"}`;
  }
  const hard = VOICELESS.has(lastLetter(name));
  return `${name}'${hard ? "t" : "d"}${back ? "a" : "e"}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

/** "2026-07-27" -> "27 Temmuz 2026". Geçersiz girdide ham değeri döndürür. */
function formatTrDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  }).format(date);
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, decimals) {
  const factor = 10 ** (decimals || 0);
  return Math.round(Number(value) * factor) / factor;
}

/** Türkçe ondalık gösterim: 1.54 -> "1,54". */
function tr(value, decimals) {
  if (!isNumber(Number(value))) return null;
  const fixed = decimals === undefined ? String(round(value, 2)) : Number(value).toFixed(decimals);
  return fixed.replace(".", ",");
}

/**
 * Rapor cümlelerinin her maçta birebir aynı kalmaması için maç kimliğine
 * göre deterministik varyant seçer. Rastgelelik yok: aynı maç her build'de
 * aynı varyantı alır, ama farklı maçlar farklı kalıpla yazılır.
 */
function seedFrom(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function variant(seed, options) {
  if (!Array.isArray(options) || !options.length) return "";
  return options[seed % options.length];
}

function statValue(match, type, side) {
  const row = (match.statistics || []).find((item) => normalizeText(item.type) === normalizeText(type));
  if (!row) return null;
  const value = row[side];
  return isNumber(Number(value)) && value !== null && value !== "" ? Number(value) : null;
}

function statPair(match, type) {
  const home = statValue(match, type, "home");
  const away = statValue(match, type, "away");
  return home === null && away === null ? null : { home, away };
}

function minuteOf(event) {
  const raw = String((event && event.time) || "").match(/\d+/);
  return raw ? Number(raw[0]) : null;
}

function eventTeamName(event) {
  if (!event || !event.team) return "";
  return typeof event.team === "string" ? event.team : event.team.name || "";
}

function isType(event, ...needles) {
  const type = normalizeText(event && event.type);
  return needles.some((needle) => type.includes(normalizeText(needle)));
}

function goalEvents(match) {
  return (match.events || []).filter((event) => isType(event, "gol") && !isType(event, "iptal"));
}

/**
 * Olay metninden oyuncu adını çıkarır: "Anderson Talisca serbest vuruştan...".
 * Ada eklenmiş Türkçe hâl eki ("Kökçü'nün") kırpılır; ad içinde geçen
 * kesme işareti ("N'Golo") korunur — ayrım, kesmeden sonraki harfin küçük
 * olup olmadığına bakılarak yapılır.
 */
function stripTurkishSuffix(token) {
  return token.replace(/['’](?=\p{Ll})\p{Ll}+$/u, "");
}

function playerFromDetail(detail) {
  const text = String(detail || "").trim();
  if (!text) return null;
  const match = text.match(/^([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3})/u);
  if (!match) return null;
  const name = match[1]
    .trim()
    .replace(/[.,;:]$/, "")
    .split(/\s+/)
    .map(stripTurkishSuffix)
    .join(" ")
    .trim();
  return name.split(/\s+/).length >= 2 ? name : null;
}

function outcome(match) {
  const home = match.score && match.score.home;
  const away = match.score && match.score.away;
  if (!isNumber(home) || !isNumber(away)) return null;
  if (home > away) return { winner: match.homeTeam, loser: match.awayTeam, draw: false, margin: home - away };
  if (away > home) return { winner: match.awayTeam, loser: match.homeTeam, draw: false, margin: away - home };
  return { winner: null, loser: null, draw: true, margin: 0 };
}

function scoreLine(match) {
  const home = match.score && match.score.home;
  const away = match.score && match.score.away;
  return isNumber(home) && isNumber(away) ? `${home}-${away}` : null;
}

// ── 1. Maç özeti ────────────────────────────────────────────────────────────
function buildSummary(match, seed) {
  const result = outcome(match);
  const score = scoreLine(match);
  if (!result || !score) {
    return { status: "unavailable", reason: "Maç sonucu henüz doğrulanmadı." };
  }

  const goals = goalEvents(match);
  const where = match.venue && match.venue !== "Açıklanmadı" ? `${locative(match.venue)} ` : "";
  // Aşama etiketi yalnızca lig adına bilgi katıyorsa eklenir; "Hazırlık Maçı
  // sezon öncesi hazırlık" gibi kendini tekrar eden ifadeler ayıklanır. Özel
  // adlar ("Summer Series Upper Austria") küçültülmez.
  const leagueWords = new Set(normalizeText(match.league).split(/\s+/).filter((word) => word.length > 3));
  const rawStage = String(match.stage || "").replace(/,\s*/g, " ").trim();
  const stageAddsInfo = rawStage
    && !normalizeText(rawStage).split(/\s+/).filter((word) => word.length > 3).some((word) => leagueWords.has(word));
  let stage = stageAddsInfo ? `${match.league} ${rawStage}` : match.league;
  // Cümle zaten "karşılaşma" sözcüğünü getiriyor; etiket "... Maçı" ile
  // bitiyorsa o sözcük düşer ("Hazırlık Maçı maçını" -> "hazırlık maçını").
  // Tek sözcük kalırsa cins isimdir, küçültülür; çok sözcüklüler özel ad
  // olabileceği için yazımı korunur.
  const trimmed = stage.replace(/\s*ma[çc][ıi]$/i, "").trim();
  if (trimmed && trimmed !== stage) {
    stage = trimmed.includes(" ") ? trimmed : trimmed.toLocaleLowerCase("tr-TR");
  }

  // Kazanan anıldığında skor kazananın gol sayısı önce gelecek şekilde
  // yazılır; ev-deplasman sırası korunursa "Galatasaray 1-5 kazandı" gibi
  // yanıltıcı bir cümle çıkıyor.
  const home = match.score.home;
  const away = match.score.away;
  const winnerFirst = result.draw
    ? score
    : `${Math.max(home, away)}-${Math.min(home, away)}`;

  const headline = result.draw
    ? `${match.homeTeam} ile ${match.awayTeam} ${score} berabere kaldı`
    : `${result.winner}, ${accusative(result.loser)} ${winnerFirst} yendi`;

  const opening = result.draw
    ? variant(seed, [
        `${match.homeTeam} ile ${match.awayTeam}, ${where}oynanan ${stage} karşılaşmasında ${score} berabere kaldı.`,
        `${where}oynanan ${stage} maçında ${match.homeTeam} ile ${match.awayTeam} birbirini geçemedi: ${score}.`
      ])
    : variant(seed, [
        `${result.winner}, ${where}oynanan ${stage} karşılaşmasında ${accusative(result.loser)} ${winnerFirst} mağlup etti.`,
        `${where}oynanan ${stage} maçını ${result.winner} ${winnerFirst} kazandı; ${result.loser} sahadan puansız ayrıldı.`
      ]);

  const sentences = [opening];

  if (goals.length) {
    const scorers = goals
      .map((event) => {
        const minute = minuteOf(event);
        const player = playerFromDetail(event.detail);
        const team = eventTeamName(event);
        if (!player) return minute ? `${minute}. dakikada ${team}` : team;
        return minute ? `${minute}. dakikada ${player} (${team})` : `${player} (${team})`;
      })
      .filter(Boolean);
    if (scorers.length) {
      sentences.push(`${scorers.length === 1 ? "Tek golü" : "Golleri"} ${scorers.join(", ")} kaydetti.`);
    }
  } else if (home === 0 && away === 0) {
    // Golsüz maçta "gol bilgisi doğrulanmadı" demek yanlış olur: eksik veri
    // değil, gerçekten gol yok.
    sentences.push("İki takım da gol bulamadı.");
  } else {
    sentences.push("Gol dakikaları ve golcü bilgisi henüz doğrulanmadı.");
  }

  const htHome = match.score && match.score.halftimeHome;
  const htAway = match.score && match.score.halftimeAway;
  if (isNumber(htHome) && isNumber(htAway)) {
    const htLine = `${htHome}-${htAway}`;
    sentences.push(
      htLine === score
        ? `İlk yarı da ${htLine} tamamlanmıştı; ikinci yarıda skor değişmedi.`
        : `Devre ${htLine} kapanmıştı.`
    );
  }

  return {
    status: "ready",
    headline,
    paragraph: sentences.join(" "),
    score,
    result
  };
}

// ── 2. Öne çıkan oyuncular ──────────────────────────────────────────────────
function buildStandoutPlayers(match) {
  const contributions = new Map();

  function add(name, team, weight, note) {
    if (!name) return;
    const key = `${normalizeText(name)}|${normalizeText(team)}`;
    const entry = contributions.get(key) || { name, team, score: 0, notes: [] };
    entry.score += weight;
    if (note) entry.notes.push(note);
    contributions.set(key, entry);
  }

  for (const event of match.events || []) {
    const team = eventTeamName(event);
    const player = playerFromDetail(event.detail);
    const minute = minuteOf(event);
    const stamp = minute ? `${minute}'` : "";

    if (isType(event, "gol")) add(player, team, 5, `${stamp} gol`.trim());
    else if (isType(event, "asist")) add(player, team, 3, `${stamp} asist`.trim());
    // "Kurtarış" olayında olay takımı hücum eden taraf, metinde önce anılan
    // isim de şutu çeken oyuncudur; kurtaran kaleci ikinci sırada geçer.
    // Bu yüzden katkı, kurtarış değil isabetli şut olarak yazılır.
    else if (isType(event, "kurtarış")) add(player, team, 2, `${stamp} kaleciden dönen isabetli şut`.trim());
    else if (isType(event, "direk")) add(player, team, 2, `${stamp} direkten dönen şut`.trim());
    else if (isType(event, "kırmızı")) add(player, team, -4, `${stamp} kırmızı kart`.trim());
    else if (isType(event, "sarı")) add(player, team, -1, `${stamp} sarı kart`.trim());
  }

  const ranked = [...contributions.values()]
    .filter((entry) => entry.notes.length)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "tr"))
    .slice(0, 4);

  if (!ranked.length) {
    return {
      status: "unavailable",
      reason: "Bu maç için oyuncu bazlı katkı verisi (gol, asist, kart, kurtarış) henüz doğrulanmadı."
    };
  }

  return {
    status: "ready",
    players: ranked.map((entry) => ({
      name: entry.name,
      team: entry.team,
      contribution: entry.notes.join(" · "),
      impact: entry.score >= 5 ? "yüksek" : entry.score > 0 ? "orta" : "olumsuz"
    }))
  };
}

// ── 3. İstatistik analizi ───────────────────────────────────────────────────
function buildStatisticsAnalysis(match, seed) {
  const stats = match.statistics || [];
  if (!stats.length) {
    return {
      status: "unavailable",
      reason: "Maçın istatistik dökümü sağlayıcıdan henüz alınmadı. Veri geldiğinde bu bölüm otomatik dolar."
    };
  }

  const possession = statPair(match, "Topla oynama");
  const shots = statPair(match, "Toplam şut");
  const onTarget = statPair(match, "İsabetli şut");
  const xg = statPair(match, "Gol beklentisi (xG)");
  const passAccuracy = statPair(match, "Pas isabeti");
  const corners = statPair(match, "Korner");

  const readings = [];
  const home = match.homeTeam;
  const away = match.awayTeam;

  if (possession && isNumber(possession.home)) {
    const leader = possession.home >= possession.away ? home : away;
    const value = Math.max(possession.home, possession.away);
    readings.push(
      value >= 65
        ? `${leader} topa yüzde ${value} sahip olarak oyunun ritmini tek başına belirledi.`
        : `Topla oynama yüzde ${possession.home}-${possession.away} dağıldı; ${leader} hafif üstünlük kurdu.`
    );
  }

  if (shots && isNumber(shots.home) && isNumber(shots.away)) {
    const detail = onTarget && isNumber(onTarget.home)
      ? ` İsabetli şutta tablo ${onTarget.home}-${onTarget.away}.`
      : "";
    readings.push(`Şut üretimi ${shots.home}-${shots.away} sonuçlandı.${detail}`);
  }

  if (xg && isNumber(xg.home) && isNumber(xg.away)) {
    const actualHome = match.score && match.score.home;
    const actualAway = match.score && match.score.away;
    readings.push(`Gol beklentisi (xG) ${tr(xg.home, 2)}-${tr(xg.away, 2)} oldu.`);
    if (isNumber(actualHome) && isNumber(actualAway)) {
      const homeDelta = actualHome - xg.home;
      const awayDelta = actualAway - xg.away;
      const bigger = Math.abs(homeDelta) >= Math.abs(awayDelta) ? { team: home, delta: homeDelta } : { team: away, delta: awayDelta };
      if (Math.abs(bigger.delta) >= 0.5) {
        readings.push(
          bigger.delta < 0
            ? `${bigger.team} ürettiği pozisyonun gerisinde kaldı; xG ile gerçek skor arasında ${tr(Math.abs(bigger.delta), 2)} fark var.`
            : `${bigger.team} beklentinin üzerinde bitiricilik gösterdi (+${tr(bigger.delta, 2)}).`
        );
      }
    }
  }

  if (passAccuracy && isNumber(passAccuracy.home)) {
    readings.push(`Pas isabeti yüzde ${passAccuracy.home}-${passAccuracy.away} ölçüldü.`);
  }

  if (corners && isNumber(corners.home)) {
    readings.push(`Korner sayısı ${corners.home}-${corners.away}.`);
  }

  // Şut başına gol: bitiricilik verimliliği
  const conversion = [];
  for (const [side, team] of [["home", home], ["away", away]]) {
    const teamShots = shots && shots[side];
    const goals = match.score && match.score[side];
    if (isNumber(teamShots) && teamShots > 0 && isNumber(goals)) {
      conversion.push({ team, rate: round((goals / teamShots) * 100, 1), shots: teamShots, goals });
    }
  }

  return {
    status: "ready",
    readings,
    conversion,
    highlights: stats
      .filter((row) => isNumber(Number(row.home)) && isNumber(Number(row.away)))
      .slice(0, 12)
      .map((row) => ({
        type: row.type,
        home: row.decimals ? tr(row.home, row.decimals) : row.home,
        away: row.decimals ? tr(row.away, row.decimals) : row.away,
        unit: row.unit || ""
      })),
    lead: variant(seed, [
      "Sayısal tablo maçın hangi bölümlerinde üstünlük kurulduğunu gösteriyor.",
      "Rakamlar, skorun oyunun akışını ne kadar yansıttığını ortaya koyuyor."
    ])
  };
}

// ── 4. Taktik değerlendirme ─────────────────────────────────────────────────
function buildTacticalRead(match) {
  const lineups = match.lineups || [];
  const formations = lineups.filter((row) => row && row.formation);
  const possession = statPair(match, "Topla oynama");
  const duels = statPair(match, "Kazanılan ikili mücadele");
  const crosses = statPair(match, "Toplam orta");
  const clearances = statPair(match, "Uzaklaştırma");
  const boxTouches = statPair(match, "Rakip ceza sahasında topla buluşma");

  const notes = [];

  for (const row of formations) {
    notes.push(`${row.team} sahaya ${row.formation} dizilişiyle çıktı.`);
  }

  if (possession && isNumber(possession.home) && Math.abs(possession.home - possession.away) >= 20) {
    const dominant = possession.home > possession.away ? match.homeTeam : match.awayTeam;
    const other = possession.home > possession.away ? match.awayTeam : match.homeTeam;
    notes.push(`${dominant} topu elinde tutarken ${other} derin blokta savunma yapmayı tercih etti.`);
  }

  if (clearances && isNumber(clearances.home) && isNumber(clearances.away)) {
    const high = clearances.home >= clearances.away ? { team: match.homeTeam, value: clearances.home } : { team: match.awayTeam, value: clearances.away };
    if (high.value >= 25) {
      notes.push(`${high.team} ${high.value} uzaklaştırma yaptı; bu, uzun süre kendi yarı alanında baskı altında kaldığını gösteriyor.`);
    }
  }

  if (boxTouches && isNumber(boxTouches.home) && isNumber(boxTouches.away)) {
    const leader = boxTouches.home >= boxTouches.away ? match.homeTeam : match.awayTeam;
    notes.push(`Rakip ceza sahasında topla buluşmada ${leader} önde (${boxTouches.home}-${boxTouches.away}); hücum yükü bu tarafta toplandı.`);
  }

  if (crosses && isNumber(crosses.home) && isNumber(crosses.away) && Math.max(crosses.home, crosses.away) >= 20) {
    const leader = crosses.home >= crosses.away ? match.homeTeam : match.awayTeam;
    notes.push(`${leader} ${Math.max(crosses.home, crosses.away)} orta denedi; kanat merkezli bir kırma tercihi öne çıktı.`);
  }

  if (duels && isNumber(duels.home) && isNumber(duels.away)) {
    const leader = duels.home >= duels.away ? match.homeTeam : match.awayTeam;
    notes.push(`İkili mücadelelerde ${leader} üstün geldi (${duels.home}-${duels.away}).`);
  }

  const subs = match.substitutions || [];
  if (subs.length) {
    const early = subs.filter((row) => {
      const minute = minuteOf(row);
      return minute !== null && minute <= 60;
    });
    notes.push(
      early.length >= 3
        ? `Teknik heyetler 60. dakikaya kadar ${early.length} değişiklik yaparak oyuna erken müdahale etti.`
        : `Maç boyunca ${subs.length} oyuncu değişikliği yapıldı.`
    );
  }

  if (!notes.length) {
    return {
      status: "unavailable",
      reason: "Diziliş ve oyun yapısı verisi (formasyon, topla oynama, mücadele dağılımı) bu maç için henüz doğrulanmadı."
    };
  }

  return { status: notes.length >= 3 ? "ready" : "partial", notes };
}

// ── 5. Maçın kırılma anları ─────────────────────────────────────────────────
function buildTurningPoints(match) {
  const events = (match.events || []).filter((event) => event && (event.type || event.detail));
  if (!events.length) {
    return { status: "unavailable", reason: "Maçın olay akışı henüz doğrulanmadı." };
  }

  const weighted = events.map((event) => {
    let weight = 1;
    if (isType(event, "kırmızı")) weight = 10;
    else if (isType(event, "penaltı")) weight = 8;
    else if (isType(event, "gol")) weight = 7;
    else if (isType(event, "direk")) weight = 4;
    else if (isType(event, "kurtarış")) weight = 3;
    else if (isType(event, "sarı")) weight = 2;
    return { event, weight, minute: minuteOf(event) };
  });

  const picked = weighted
    .filter((row) => row.weight >= 3)
    .sort((left, right) => right.weight - left.weight || (left.minute || 0) - (right.minute || 0))
    .slice(0, 5)
    .sort((left, right) => (left.minute || 0) - (right.minute || 0));

  const chosen = picked.length ? picked : weighted.slice(0, 3);

  return {
    status: picked.length ? "ready" : "partial",
    moments: chosen.map((row) => ({
      minute: row.minute === null ? "-" : `${row.minute}'`,
      team: eventTeamName(row.event),
      type: row.event.type || "Olay",
      detail: row.event.detail || "",
      pivotal: row.weight >= 7
    }))
  };
}

// ── 6. AI puanlaması ────────────────────────────────────────────────────────
/**
 * Takım performans puanı yalnızca ölçülmüş istatistiklerden hesaplanır.
 * İstatistik yoksa puan üretilmez (null döner) — oyuncu rating'lerinde
 * uygulanan "veri yoksa puan yok" kuralının maç seviyesindeki karşılığı.
 */
function buildAiRating(match) {
  const stats = match.statistics || [];
  const score = match.score || {};
  if (!stats.length || !isNumber(score.home) || !isNumber(score.away)) {
    return {
      status: "unavailable",
      reason: "Performans puanı yalnızca doğrulanmış istatistiklerden hesaplanır; bu maçın istatistik dökümü henüz yok."
    };
  }

  const possession = statPair(match, "Topla oynama");
  const shots = statPair(match, "Toplam şut");
  const onTarget = statPair(match, "İsabetli şut");
  const xg = statPair(match, "Gol beklentisi (xG)");
  const passAccuracy = statPair(match, "Pas isabeti");

  function sideScore(side, opponent) {
    const parts = [];
    const weights = [];

    if (possession && isNumber(possession[side])) {
      parts.push(Math.min(100, possession[side] * 1.25));
      weights.push(15);
    }
    if (shots && isNumber(shots[side])) {
      parts.push(Math.min(100, shots[side] * 6));
      weights.push(20);
    }
    if (onTarget && isNumber(onTarget[side])) {
      parts.push(Math.min(100, onTarget[side] * 14));
      weights.push(20);
    }
    if (xg && isNumber(xg[side])) {
      parts.push(Math.min(100, xg[side] * 42));
      weights.push(25);
    }
    if (passAccuracy && isNumber(passAccuracy[side])) {
      parts.push(passAccuracy[side]);
      weights.push(10);
    }

    const goals = score[side];
    const conceded = score[opponent];
    if (isNumber(goals) && isNumber(conceded)) {
      const margin = goals - conceded;
      parts.push(Math.max(0, Math.min(100, 50 + margin * 18)));
      weights.push(30);
    }

    if (!parts.length) return null;
    const total = weights.reduce((sum, value) => sum + value, 0);
    const weighted = parts.reduce((sum, value, index) => sum + value * weights[index], 0);
    return Math.round(weighted / total);
  }

  const homeScore = sideScore("home", "away");
  const awayScore = sideScore("away", "home");
  if (homeScore === null || awayScore === null) {
    return { status: "unavailable", reason: "Puan için yeterli ölçülmüş istatistik yok." };
  }

  // Kaç ayrı metrik hesaba girdi -> güven göstergesi
  const available = ["Topla oynama", "Toplam şut", "İsabetli şut", "Gol beklentisi (xG)", "Pas isabeti"]
    .filter((type) => statPair(match, type)).length;
  const confidence = Math.round((available / 5) * 100);

  return {
    status: "ready",
    home: { team: match.homeTeam, score: homeScore },
    away: { team: match.awayTeam, score: awayScore },
    confidence,
    basis: `Puan; topla oynama, şut, isabetli şut, xG, pas isabeti ve skor farkından ağırlıklı olarak hesaplandı (${available}/5 metrik mevcut).`
  };
}

// ── 7. Sonraki maç öngörüsü ─────────────────────────────────────────────────
function buildNextMatchOutlook(match, context) {
  const fixtures = (context && context.fixtures) || [];
  const played = new Date(match.kickoff || match.date || 0).getTime();
  const result = outcome(match);

  function nextFor(team) {
    return fixtures
      .filter((row) => {
        if (normalizeText(row.id) === normalizeText(match.id)) return false;
        const when = new Date(row.kickoff || row.date || 0).getTime();
        if (!Number.isFinite(when) || when <= played) return false;
        return normalizeText(row.homeTeam) === normalizeText(team) || normalizeText(row.awayTeam) === normalizeText(team);
      })
      .sort((left, right) => new Date(left.kickoff).getTime() - new Date(right.kickoff).getTime())[0] || null;
  }

  const entries = [];
  for (const team of [match.homeTeam, match.awayTeam]) {
    const next = nextFor(team);
    const won = result && !result.draw && normalizeText(result.winner) === normalizeText(team);
    const lost = result && !result.draw && normalizeText(result.loser) === normalizeText(team);
    const form = won ? "galibiyetin moraliyle" : lost ? "mağlubiyetin ardından" : "beraberliğin ardından";

    if (!next) {
      entries.push({
        team,
        status: "unavailable",
        text: `${team} için doğrulanmış bir sonraki karşılaşma henüz takvimde yok; fikstür açıklandığında bu alan güncellenecek.`
      });
      continue;
    }

    const opponent = normalizeText(next.homeTeam) === normalizeText(team) ? next.awayTeam : next.homeTeam;
    const homeAway = normalizeText(next.homeTeam) === normalizeText(team) ? "sahasında" : "deplasmanda";
    const date = String(next.kickoff || next.date || "").slice(0, 10);
    entries.push({
      team,
      status: "ready",
      opponent,
      date,
      text: `${team}, ${form} ${formatTrDate(next.kickoff || next.date)} tarihinde ${homeAway} ${opponent} ile karşılaşacak.`
    });
  }

  const ready = entries.filter((entry) => entry.status === "ready");
  const status = ready.length ? (ready.length === entries.length ? "ready" : "partial") : "unavailable";
  return {
    status,
    entries,
    // Diğer bölümlerle aynı sözleşme: "unavailable" ise gerekçe yazılır.
    reason: status === "unavailable"
      ? "İki takım için de doğrulanmış bir sonraki karşılaşma takvimde yok; fikstür açıklandığında bu bölüm otomatik dolar."
      : undefined,
    note: "Öngörü, doğrulanmış fikstür ve bu maçın sonucuna dayanır; skor tahmini içermez."
  };
}

// ── SEO ─────────────────────────────────────────────────────────────────────
function buildSeo(match, summary) {
  const score = scoreLine(match) || "";
  const competition = match.league || "Futbol";
  const title = `${match.homeTeam} ${score} ${match.awayTeam} Maç Raporu ve İstatistikleri | FutbolRadar`;

  const parts = [];
  if (summary.status === "ready") {
    parts.push(`${match.homeTeam} ${score} ${match.awayTeam} maç raporu`);
    const goals = goalEvents(match)
      .map((event) => playerFromDetail(event.detail))
      .filter(Boolean);
    if (goals.length) parts.push(`goller: ${[...new Set(goals)].join(", ")}`);
    if ((match.statistics || []).length) parts.push("xG, şut ve pas istatistikleri");
    parts.push("kırılma anları ve sonraki maç");
  } else {
    parts.push(`${match.homeTeam} - ${match.awayTeam} maç raporu ve doğrulanmış maç verileri`);
  }

  let description = `${parts.join(", ")}.`;
  if (description.length > 158) description = `${description.slice(0, 155).replace(/[\s,;:]+$/, "")}...`;

  const dateStamp = String(match.kickoff || match.date || "").slice(0, 10);
  const path = match.analysisPage || `mac-raporu/${slug(match.homeTeam)}-${slug(match.awayTeam)}-${dateStamp}.html`;

  return { title, description, path, competition };
}

/** Tüm bölümleri tek raporda toplar. */
function buildMatchReport(match, context) {
  if (!match || String(match.status || "").toUpperCase() !== "FINISHED") {
    return null;
  }

  const seed = seedFrom(match.id || `${match.homeTeam}-${match.awayTeam}`);
  const summary = buildSummary(match, seed);
  const sections = {
    summary,
    standoutPlayers: buildStandoutPlayers(match),
    statistics: buildStatisticsAnalysis(match, seed),
    tactical: buildTacticalRead(match),
    turningPoints: buildTurningPoints(match),
    aiRating: buildAiRating(match),
    nextMatch: buildNextMatchOutlook(match, context)
  };

  const readyCount = Object.values(sections).filter((section) => section.status === "ready").length;
  const coverage = Math.round((readyCount / Object.keys(sections).length) * 100);

  return {
    matchId: match.id,
    generatedAt: (context && context.generatedAt) || null,
    seo: buildSeo(match, summary),
    sections,
    coverage,
    dataStatus: coverage >= 70 ? "complete" : coverage >= 35 ? "partial" : "minimal"
  };
}

module.exports = {
  buildMatchReport,
  buildSummary,
  buildStandoutPlayers,
  buildStatisticsAnalysis,
  buildTacticalRead,
  buildTurningPoints,
  buildAiRating,
  buildNextMatchOutlook,
  buildSeo,
  accusative,
  dative,
  locative,
  slug
};
