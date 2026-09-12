/**
 * "BUGÜNKÜ MAÇLAR HANGİ KANALDA" SAYFASININ SEÇİM KURALI.
 *
 * Sayfa kasıtlı olarak DAR kapsamlı: Süper Lig, dört büyük kulüp (hangi
 * turnuvada oynarlarsa oynasınlar) ve büyük Avrupa yarışmaları/ligleri.
 * Kural burada tek yerde — sayfa üreticisi yalnızca çağırır, kendi süzgeç
 * mantığını taşımaz.
 *
 * YAYIN KANALI UYDURULMAZ. `match.broadcast` sağlayıcıdan (TheSportsDB
 * `strTVStation`) geliyor ve çoğu maçta boş — bu BEKLENEN bir durum, arıza
 * değil. Kanal bilinmiyorsa alan boş dize döner; sayfa bunu "henüz
 * açıklanmadı" gibi nötr bir ifadeyle gösterir, asla bir kanal adı tahmin
 * etmez.
 */
const { resolveCompetitionId, findCompetition } = require("./competitionCatalog.js");
const { sameClub, fixtureTeamNames } = require("./superLigTeams.js");
const { istanbulDay, kickoffMs, canonicalStatus, PLAYED_STATES } = require("./matchStatus.js");
const broadcastVerifications = require("../data/broadcast-verifications.json");
const broadcastScan = require("../data/broadcast-schedule.json");

/**
 * İKİ KAYNAK, TEK SIRALAMA: ELLE DOĞRULAMA HER ZAMAN ÖNCE.
 *
 * `data/broadcast-verifications.json` bir insanın yayıncının akışını açıp
 * gözüyle doğruladığı kayıttır; `data/broadcast-schedule.json` ise günlük
 * taramanın çıktısıdır ve her koşuda sıfırdan yazılır. Tarama bir maçı
 * yanlış eşleştirirse (aynı isimli iki kulüp, akışta geçen bir tekrar
 * yayını) elle girilen kayıt onu ezer — düzeltmenin otomasyona yenilmesi,
 * düzeltmeyi anlamsız kılardı.
 */
function scanRecords() {
  const rows = broadcastScan && Array.isArray(broadcastScan.records) ? broadcastScan.records : [];
  return rows;
}

function matchesRecord(match, record) {
  if (!record || istanbulDay(match.kickoff) !== record.date) return false;
  const ids = [match.id, match.fixtureId, match.providerId, match.providerIds && match.providerIds.apiFootball].map(String);
  if (record.providerId && ids.includes(String(record.providerId))) return true;
  return sameClub(match.homeTeam, record.homeTeam) && sameClub(match.awayTeam, record.awayTeam);
}

function verifiedBroadcast(match) {
  if (!match) return null;
  const manual = broadcastVerifications.find((record) => matchesRecord(match, record));
  if (manual) return manual;
  return scanRecords().find((record) => matchesRecord(match, record) && text(record.turkey)) || null;
}

/**
 * TARAMANIN KENDİ ÇIKTISINI GÖRMEDEN OKUDUĞU KANAL.
 *
 * `verifiedBroadcast` günlük tarama dosyasını da okur; bu, sayfalar için
 * doğru ama TARAYICI için felakettir. Tarayıcı `broadcastChannel` çağırıp
 * kendi bir önceki koşusunun kaydını "sağlayıcıdan gelen kanal" sanıyordu:
 *
 *   1. Kayıt kaynağını kaybediyordu — ikinci koşuda `sourceUrl` boş
 *      yazılıyor, doğrulanamayan bir kanal adı yayımlanıyordu.
 *   2. Kayıt ÖLÜMSÜZLEŞİYORDU — yayıncı maçı akıştan kaldırsa bile
 *      tarayıcı kendi eski kaydını yeniden onaylıyor, "yayıncı değişirse
 *      eskisini düzelt" kuralı hiç çalışmıyordu.
 *
 * Bu yüzden tarayıcı yalnızca İKİ birincil kaynağı görür: elle doğrulama
 * ve maç kaydının kendi `broadcast` alanı (sağlayıcı verisi). Kendi
 * çıktısını asla girdi saymaz.
 */
function primaryBroadcast(match) {
  if (!match) return null;
  const manual = broadcastVerifications.find((record) => matchesRecord(match, record));
  if (manual && text(manual.turkey)) {
    return { channel: text(manual.turkey), sourceUrl: text(manual.sourceUrl) };
  }
  const broadcast = match.broadcast;
  const channel = typeof broadcast === "string"
    ? text(broadcast)
    : (broadcast && typeof broadcast === "object" ? (text(broadcast.turkey) || text(broadcast.tr)) : "");
  if (!channel) return null;
  return { channel, sourceUrl: text(match.broadcastSourceUrl) };
}

function applyVerifiedBroadcast(match) {
  const record = verifiedBroadcast(match);
  if (!record) return match;
  return { ...match, broadcast: { ...(typeof match.broadcast === "object" ? match.broadcast : {}), turkey: record.turkey },
    broadcastSourceUrl: record.sourceUrl, broadcastVerifiedAt: record.verifiedAt };
}

/**
 * Öncelikli turnuva kimlikleri — data/competitions.json'daki `id` alanı.
 *
 * SIRA ANLAMLIDIR. Dizideki konum hem sayfadaki blok sırasını hem de yer
 * darsa hangi maçın kesileceğini belirler (bkz. `priorityRank`). Türkiye
 * ligleri en üstte; ardından Türk kulüplerinin oynadığı Avrupa kupaları,
 * sonra büyük Avrupa ligleri.
 */
const PRIORITY_COMPETITION_IDS = Object.freeze([
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
]);

/** Turnuvadan bağımsız her zaman gösterilecek dört büyük kulüp. */
const PRIORITY_CLUBS = Object.freeze(["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"]);

/**
 * AVRUPA'DAKİ TÜM TÜRK TAKIMLARI — dört büyükle sınırlı değil.
 *
 * Kural "dört büyük + öncelikli turnuva" olarak yazıldığında Samsunspor'un
 * Konferans Ligi ön elemesi ya da Başakşehir'in Avrupa Ligi maçı sayfaya
 * hiç girmiyordu: kulüp dört büyükten değil, turnuva da o gün öncelikli
 * listede olsa bile maç Türk okuyucu için asıl merak edilen maçtı. Türk
 * kulübü sahadaysa maç her turnuvada öncelikli sayılır.
 *
 * Liste Süper Lig ve 1. Lig fikstür adlarından türetilir (tek kaynak:
 * services/superLigTeams.js), böylece kadro değiştikçe elle bakım
 * gerekmez. Avrupa'da oynayan bir kulüp o sezon hangi ligdeyse listede
 * zaten vardır.
 */
function turkishClubNames() {
  const names = new Set();
  for (const name of fixtureTeamNames()) {
    const value = text(name);
    if (value) names.add(value);
  }
  return names;
}

function involvesTurkishClub(match) {
  if (!match || typeof match !== "object") return false;
  const names = turkishClubNames();
  for (const name of names) {
    if (sameClub(name, match.homeTeam) || sameClub(name, match.awayTeam)) return true;
  }
  return false;
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return "";
}

function involvesPriorityClub(match) {
  return PRIORITY_CLUBS.some((club) => sameClub(club, match.homeTeam) || sameClub(club, match.awayTeam));
}

/**
 * `resolveCompetitionId` bazen sağlayıcı numarasıyla ÇELİŞEN, önceden
 * senkronda yazılmış bir `competitionId`ye güvenir (bkz. Uganda'nın
 * "Premier League"i — kayıtta `competitionId: "premier-league"` duruyor
 * ama `providerLeagueId: "585"`, İngiltere'nin 39 değil). Kayıt gerçek bir
 * sağlayıcı lig numarası taşıyorsa o numara katalogdaki BEKLENEN numarayla
 * eşleşmek ZORUNDA; eşleşmiyorsa çözülmüş kimlik reddedilir. Numara yoksa
 * (elle girilmiş kayıt) çözülen kimliğe güvenilir.
 */
function isPriorityCompetition(match) {
  const id = resolveCompetitionId(match);
  if (!id || !PRIORITY_COMPETITION_IDS.includes(id)) return false;

  const providerLeagueId = match && match.providerLeagueId;
  if (providerLeagueId === undefined || providerLeagueId === null || providerLeagueId === "") return true;

  const competition = findCompetition(id);
  const expected = competition && competition.providers && competition.providers.apiFootball;
  if (expected === undefined || expected === null) return true;

  return String(providerLeagueId) === String(expected);
}

/** Sayfanın gösterme kuralı: öncelikli turnuva, Türk kulübü ya da dört büyük. */
function isPriorityMatch(match) {
  if (!match || typeof match !== "object") return false;
  return isPriorityCompetition(match) || involvesPriorityClub(match) || involvesTurkishClub(match);
}

/**
 * Maçın öncelik basamağı — küçük sayı önce gelir.
 *
 * Dört büyük ve Avrupa'daki Türk takımları, hangi turnuvada oynarlarsa
 * oynasınlar Türkiye ligleriyle Avrupa kupaları ARASINA yerleşir: bir
 * Türk kulübünün Konferans Ligi maçı, okuyucu için Bundesliga'nın
 * herhangi bir maçından önce gelir.
 */
function priorityRank(match) {
  const id = isPriorityCompetition(match) ? resolveCompetitionId(match) : "";
  const competitionRank = id ? PRIORITY_COMPETITION_IDS.indexOf(id) : -1;

  // Türk ligleri (super-lig, 1-lig) kendi sıralarında kalır.
  if (competitionRank === 0 || competitionRank === 1) return competitionRank;

  // Türk kulübü sahadaysa Avrupa kupalarının hemen önüne alınır.
  if (involvesPriorityClub(match) || involvesTurkishClub(match)) return 2;

  return competitionRank >= 0 ? competitionRank + 3 : PRIORITY_COMPETITION_IDS.length + 3;
}

/**
 * Belirli bir günün öncelikli maçları.
 *
 * `day` (YYYY-MM-DD) verilmezse Europe/Istanbul takvim günü kullanılır —
 * sitenin geri kalanıyla aynı gün sınırı (services/matchStatus.js#istanbulDay).
 * `today` eski çağrı adıdır ve `day` ile eşdeğerdir.
 *
 * Sıralama önce SAATE göredir: "hangi maç kaçta" sorusunun cevabı
 * kronolojik bir listede okunur. Öncelik basamağı yalnızca aynı saatte
 * başlayan maçları ayırır — 20.00'de dört maç varsa Süper Lig maçı
 * Bundesliga maçından önce yazılır.
 */
function selectBroadcastMatches(matches, options = {}) {
  const day = text(options.day) || text(options.today) || istanbulDay(new Date().toISOString());
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => match && typeof match === "object" && istanbulDay(match.kickoff) === day)
    .filter(isPriorityMatch)
    .sort((left, right) => {
      const byKickoff = (kickoffMs(left) ?? 0) - (kickoffMs(right) ?? 0);
      if (byKickoff !== 0) return byKickoff;
      return priorityRank(left) - priorityRank(right);
    });
}

/** Europe/Istanbul takviminde bugünden `offset` gün sonrası (YYYY-MM-DD). */
function istanbulDayOffset(offsetDays, now = new Date()) {
  const base = new Date(now.getTime() + Number(offsetDays || 0) * 86400000);
  return istanbulDay(base.toISOString());
}

/**
 * KARTTA GÖRÜNECEK YAYIN SATIRI.
 *
 * İki durum vardır ve üçüncüsü YOKTUR:
 *
 *   verified → kanal gerçekten doğrulandı, adı yazılır.
 *   pending  → doğrulanmadı, "Yayın bilgisi bekleniyor" yazılır.
 *
 * Tahmin diye bir durum bilerek yok. `services/broadcastRights.js`
 * turnuva bazlı hak haritası taşır ama o harita yalnızca hangi akışın
 * taranacağını söyler; buraya kadar gelen kanal adı her zaman ya
 * sağlayıcıdan ya da doğrulama kaydından, yani maç düzeyinde bir
 * kaynaktan gelir.
 *
 * Boş dize DÖNMEZ. Eski davranışta kanal bilinmiyorsa `broadcastChannel`
 * boş dize döndürüyor ve her çağıran "boşsa ne yazayım" sorusunu kendi
 * cevaplıyordu; satır kimi sayfada hiç çizilmiyordu. Artık cevap tek
 * yerde: bilinmiyorsa da bir satır vardır ve okuyucuya beklemesi
 * gerektiğini söyler.
 */
function broadcastLabel(match, locale) {
  const en = String(locale || "").toLowerCase().startsWith("en");
  const channel = broadcastChannel(match);
  if (channel) {
    return {
      state: "verified",
      channel,
      text: `${en ? "TV" : "Yayın"}: ${channel}`,
      sourceUrl: (verifiedBroadcast(match) || {}).sourceUrl || text(match && match.broadcastSourceUrl)
    };
  }
  return {
    state: "pending",
    channel: "",
    text: en ? "Broadcast to be confirmed" : "Yayın bilgisi bekleniyor",
    sourceUrl: ""
  };
}

/**
 * Yayın kanalı — YALNIZCA sağlayıcı verdiyse. `broadcast` ya düz bir dize
 * ya da `{ turkey, ... }` biçiminde ülke bazlı bir nesne olabilir
 * (bkz. data/matches.json). Türkiye'deki okuyucu için Türkiye kanalı
 * öncelikli; yoksa boş dize döner ve sayfa bunu uydurmaz.
 */
function broadcastChannel(match) {
  const verified = verifiedBroadcast(match);
  if (verified) return verified.turkey;
  const broadcast = match && match.broadcast;
  if (!broadcast) return "";
  if (typeof broadcast === "string") return text(broadcast);
  if (typeof broadcast === "object") return text(broadcast.turkey) || text(broadcast.tr) || "";
  return "";
}

/**
 * KARTA YAYIN SATIRI GİRECEK Mİ?
 *
 * Oynanmış maçta girmez. "Dün akşamki maç beIN Sports 1'deydi" bilgisi
 * doğru ama işe yaramaz; ana sayfada yer kaplar ve okuyucuya hâlâ
 * izlenebilecekmiş izlenimi verir. Kullanıcı isteği de açık: geçmiş
 * maçların kanal bilgisi ana sayfada tutulmaz.
 *
 * Oynanmakta olan maçta GİRER: "şu an hangi kanalda" tam da o anda
 * sorulan sorudur.
 *
 * Yayın satırının anlamlı olduğu her yerde tek çağrı bu olmalı — kural iki
 * dilde ve dört yüzeyde ayrı ayrı yazılırsa biri eskir.
 */
function cardBroadcastLabel(match, locale) {
  if (!match || typeof match !== "object") return null;
  if (PLAYED_STATES.has(canonicalStatus(match.status))) return null;
  return broadcastLabel(match, locale);
}

/** Turnuvanın kanonik görünen adı; katalogda yoksa kayıttaki ham ad. */
function competitionDisplayName(match) {
  const id = resolveCompetitionId(match);
  const competition = id ? findCompetition(id) : null;
  return (competition && competition.name) || text(match && match.league) || "";
}

module.exports = {
  applyVerifiedBroadcast,
  verifiedBroadcast,
  PRIORITY_CLUBS,
  PRIORITY_COMPETITION_IDS,
  broadcastChannel,
  broadcastLabel,
  cardBroadcastLabel,
  primaryBroadcast,
  competitionDisplayName,
  involvesTurkishClub,
  istanbulDayOffset,
  isPriorityMatch,
  priorityRank,
  selectBroadcastMatches
};
