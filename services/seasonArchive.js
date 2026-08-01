/**
 * SEZON ARŞİVİ — "geçmiş" bir iddiadır, uydurulmaz.
 *
 * Arşiv üç sorudan doğdu: hangi maçlar oynandı, o sezon kadrolar neydi, kim
 * çalıştırdı. Üçünün de tek bir ortak kuralı var:
 *
 *     ARŞİV YALNIZCA GERÇEKTEN KAYDEDİLMİŞ OLANI GÖSTERİR.
 *
 * Bu dosya yazıldığında depoda TEK sezonluk veri vardı (2026-2027 hazırlık
 * dönemi, 12 bitmiş maç). Arşivin boş görünmemesi için geçmiş sezon
 * uydurmak, tam olarak bu sitenin kaçındığı şey. Onun yerine yapı kuruldu:
 * yeni maçlar kaydedildikçe sezon kendiliğinden dolar, yeni sezon başladığında
 * yeni bir arşiv kaydı açılır.
 *
 * İSTATİSTİKTE SINIR NEREDE ÇİZİLİYOR — ve neden.
 *
 * Maç kayıtları skoru ve gol olaylarını taşıyor, ama gol olayının GOLCÜSÜ
 * yapılandırılmış bir alanda değil; serbest metnin içinde ("Anderson Talisca
 * serbest vuruştan skoru 1-0 yaptı"). Serbest metinden isim ayıklayıp
 * "sezonun gol kralı" ilan etmek, veriyi aşan bir iddia üretir.
 *
 * `data/players.json` içinde gol/asist alanları var ama 620 oyuncunun
 * yalnızca yedisinde dolu ve o kayıtların kendi notu değerlerin 2025/26
 * sezonundan geldiğini söylüyor. Yedi oyuncuyu "sezon özeti" diye sunmak
 * okuyucuya ligin tamamını gördüğünü düşündürür.
 *
 * Bu yüzden sezon özeti TAKIM ve MAÇ düzeyinde üretilir: maç sayısı, gol
 * sayısı, galibiyet/beraberlik/mağlubiyet, atılan/yenilen gol, averaj, gol
 * yemeden tamamlanan maç. Hepsi `score` ve olay sayımından doğrudan çıkar,
 * hiçbiri tahmin değil. Bireysel golcü dökümü yayımlanmaz; okuyucu maç
 * raporuna yönlendirilir — gollerin anlatımı orada zaten var.
 */

// 0 TABANLI: 6 = Temmuz. Hazırlık dönemi yeni sezona sayılır — Temmuz'daki
// hazırlık maçı Ağustos'ta başlayacak sezonun parçasıdır.
//
// Burada bir kez 7 yazıldı ve 7, Temmuz değil AĞUSTOS demek: Temmuz maçları
// bir önceki sezona düştü, teknik direktör kaydı da sezon eşleşmediği için
// hiç bağlanmadı. Sınır ayı sınanan bir davranış (scripts/test-season-archive.mjs).
const SEASON_START_MONTH = 6;

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/**
 * Bir tarihin ait olduğu sezon.
 *
 * Türkiye'de sezon yaza kurulur: Temmuz'daki hazırlık maçı Ağustos'ta
 * başlayacak sezonun parçasıdır, biten sezonun değil. Ocak-Haziran arası ise
 * bir önceki yaz başlayan sezona aittir.
 *
 * @returns {string|null} "2026-2027" biçiminde; okunamayan tarihte null.
 */
function seasonOf(value) {
  const parsed = Date.parse(text(value));
  if (Number.isNaN(parsed)) return null;

  const date = new Date(parsed);
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= SEASON_START_MONTH ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

/** Sezon etiketinin okunabilir hâli. */
function seasonLabel(season) {
  return text(season).replace("-", "/");
}

function slug(value) {
  return text(value)
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Skor GERÇEKTEN var mı? `0-0` geçerli, yarım skor değil.
 *
 * `Number(null)` sıfır döner ve `Number.isFinite(0)` doğrudur: yalnızca
 * sayıya çevirip kontrol etmek, eksik bir skoru "0" sayıp arşive uydurma bir
 * sonuç yazardı. Alanın DOLU olduğu ayrıca sınanıyor.
 */
function hasScore(match) {
  const score = match && match.score;
  if (!score) return false;

  const present = (value) => value !== null && value !== undefined && value !== "" &&
    Number.isFinite(Number(value));

  return present(score.home) && present(score.away);
}

const FINISHED = new Set(["FINISHED", "FT", "AET", "PEN"]);

/** Arşive girmeye uygun mu? Yalnızca BİTMİŞ ve skoru olan maç. */
function isArchivable(match) {
  if (!match || !match.homeTeam || !match.awayTeam) return false;
  if (!FINISHED.has(text(match.status).toUpperCase())) return false;
  return hasScore(match);
}

/** Maçın arşiv kaydı; rapor sayfası varsa bağlantısı da taşınır. */
function archiveMatch(match) {
  const season = seasonOf(match.kickoff);
  return {
    id: text(match.id),
    season,
    kickoff: text(match.kickoff),
    league: text(match.league) || "Belirtilmedi",
    competitionId: text(match.competitionId) || null,
    stage: text(match.stage) || null,
    venue: text(match.venue) || null,
    homeTeam: text(match.homeTeam),
    awayTeam: text(match.awayTeam),
    score: { home: Number(match.score.home), away: Number(match.score.away) },
    goalEvents: (Array.isArray(match.events) ? match.events : [])
      .filter((event) => /gol/i.test(text(event && event.type))).length,
    coaches: match.coaches && (match.coaches.home || match.coaches.away)
      ? { home: text(match.coaches.home) || null, away: text(match.coaches.away) || null }
      : null,
    reportPage: `mac-raporu/${text(match.id)}.html`,
    sourceUrls: Array.isArray(match.sourceUrls) ? match.sourceUrls.slice() : [],
    lastVerifiedAt: text(match.lastVerifiedAt) || text(match.fetchedAt) || null
  };
}

/**
 * Takım tablosu — yalnızca skordan çıkan büyüklükler.
 *
 * Bu tablo bir PUAN DURUMU DEĞİLDİR: içinde hazırlık ve Avrupa maçları da
 * olabilir. `competition` kırılımı bu yüzden ayrıca veriliyor; okuyucu neyin
 * toplandığını görebilmeli.
 */
function teamTable(matches) {
  const rows = new Map();

  const row = (team) => {
    if (!rows.has(team)) {
      rows.set(team, {
        team, played: 0, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, cleanSheets: 0
      });
    }
    return rows.get(team);
  };

  for (const match of matches) {
    const home = row(match.homeTeam);
    const away = row(match.awayTeam);
    const hs = match.score.home;
    const as = match.score.away;

    home.played += 1; away.played += 1;
    home.goalsFor += hs; home.goalsAgainst += as;
    away.goalsFor += as; away.goalsAgainst += hs;
    if (as === 0) home.cleanSheets += 1;
    if (hs === 0) away.cleanSheets += 1;

    if (hs > as) { home.won += 1; away.lost += 1; }
    else if (hs < as) { away.won += 1; home.lost += 1; }
    else { home.drawn += 1; away.drawn += 1; }
  }

  return [...rows.values()]
    .map((entry) => ({ ...entry, goalDifference: entry.goalsFor - entry.goalsAgainst }))
    .sort((left, right) =>
      right.won - left.won ||
      right.goalDifference - left.goalDifference ||
      right.goalsFor - left.goalsFor ||
      left.team.localeCompare(right.team, "tr"));
}

/**
 * Sezonun istatistiksel özeti.
 *
 * `individualStatsAvailable: false` bilinçli ve KALICI bir alan: sayfa
 * "golcü listesi neden yok?" sorusunu kendi içinde yanıtlayabilsin diye.
 * Maç kayıtları yapılandırılmış golcü alanı taşımaya başladığında bu alan
 * true olur ve döküm eklenir; o güne kadar boş bir bölüm çizilmez.
 */
function seasonSummary(matches) {
  const totalGoals = matches.reduce((sum, match) => sum + match.score.home + match.score.away, 0);
  const competitions = new Map();

  for (const match of matches) {
    const key = match.league || "Belirtilmedi";
    if (!competitions.has(key)) competitions.set(key, { competition: key, matches: 0, goals: 0 });
    const entry = competitions.get(key);
    entry.matches += 1;
    entry.goals += match.score.home + match.score.away;
  }

  const highest = matches
    .slice()
    .sort((left, right) =>
      (right.score.home + right.score.away) - (left.score.home + left.score.away) ||
      String(right.kickoff).localeCompare(String(left.kickoff)))[0] || null;

  return {
    matchCount: matches.length,
    totalGoals,
    goalsPerMatch: matches.length ? Math.round((totalGoals / matches.length) * 100) / 100 : 0,
    drawCount: matches.filter((match) => match.score.home === match.score.away).length,
    cleanSheetMatches: matches.filter((match) => match.score.home === 0 || match.score.away === 0).length,
    competitions: [...competitions.values()].sort((left, right) => right.matches - left.matches),
    highestScoring: highest
      ? { id: highest.id, label: `${highest.homeTeam} ${highest.score.home}-${highest.score.away} ${highest.awayTeam}`, goals: highest.score.home + highest.score.away, reportPage: highest.reportPage }
      : null,
    teamTable: teamTable(matches),
    // Bireysel döküm yayımlanmıyor; gerekçe sayfada da görünsün diye veride.
    individualStatsAvailable: false,
    individualStatsNote:
      "Maç kayıtlarındaki gol olayları golcüyü yapılandırılmış bir alanda taşımıyor; " +
      "serbest metinden isim çıkarıp gol krallığı üretmek veriyi aşan bir iddia olurdu. " +
      "Gollerin kim tarafından atıldığı maç raporlarında anlatılıyor."
  };
}

/**
 * Maç listesini sezonlara böler.
 * @returns {Map<string, Array>} sezon -> arşiv maçları (yeniden eskiye)
 */
function groupBySeason(matches) {
  const grouped = new Map();

  for (const match of Array.isArray(matches) ? matches : []) {
    if (!isArchivable(match)) continue;
    const entry = archiveMatch(match);
    if (!entry.season) continue;
    if (!grouped.has(entry.season)) grouped.set(entry.season, []);
    grouped.get(entry.season).push(entry);
  }

  for (const list of grouped.values()) {
    list.sort((left, right) => String(right.kickoff).localeCompare(String(left.kickoff)));
  }

  return grouped;
}

/** Kadro anlık görüntüsünü arşiv biçimine indirger. */
function archiveSquad(squad, season) {
  return {
    season,
    teamId: text(squad.teamId) || slug(squad.teamName),
    teamName: text(squad.teamName),
    capturedAt: text(squad.syncedAt) || null,
    status: text(squad.status) || null,
    playerCount: Array.isArray(squad.players) ? squad.players.length : 0,
    players: (Array.isArray(squad.players) ? squad.players : []).map((player) => ({
      name: text(player.name) || text(player.fullName),
      position: text(player.position) || null,
      number: player.number === null || player.number === undefined ? null : Number(player.number),
      nationality: text(player.nationality) || null
    })).filter((player) => player.name)
  };
}

module.exports = {
  SEASON_START_MONTH,
  archiveMatch,
  archiveSquad,
  groupBySeason,
  isArchivable,
  seasonLabel,
  seasonOf,
  seasonSummary,
  slug,
  teamTable
};
