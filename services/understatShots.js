/**
 * UNDERSTAT ŞUT VERİSİ — ŞUT HARİTASI VE ŞUT BAZINDA xG.
 * ----------------------------------------------------------------------------
 * NEDEN İKİNCİ BİR KAYNAK VAR.
 *
 * Şut haritası ve dakika dakika xG eğrisi için ŞUTUN NEREDEN ÇEKİLDİĞİ
 * gerekiyor. Ana sağlayıcı (API-Football) şut koordinatı göndermiyor:
 * `/fixtures/players` yalnızca toplamları veriyor ("3 şut çekti"),
 * konumu vermiyor. Bu, plan meselesi değil — o API'de böyle bir alan yok.
 *
 * Understat şut başına `X`, `Y` ve `xG` yayımlıyor; karşılığında KAPSAMI
 * DAR: yalnızca beş büyük lig (+ RFPL). Süper Lig, kupalar ve Avrupa
 * kupaları YOK. Bu yüzden burası ana sağlayıcının YERİNE geçmez, yalnızca
 * kapsadığı maçlarda şut haritasını açar; kapsamadığı her maçta bölüm
 * bugünkü gibi gizli kalır.
 *
 * KAYNAK SINIRI DÜRÜSTÇE YAZILI. Understat'ın belgelenmiş bir API'si yok;
 * veri, sitenin kendi sayfasının kullandığı uç noktadan (`getMatchData`)
 * okunuyor. Bu yüzden:
 *   • İstek hacmi asgaride tutulur — BİTMİŞ maç bir kez çekilir ve depoda
 *     kalır (bitmiş maçın şutları değişmez), lig fikstürü lig başına tek
 *     istektir.
 *   • Çekim DERLEME anında yapılır, okuyucunun isteğinde değil: sayfa
 *     Understat'a bağımlı değildir ve okuyucu başına istek oluşmaz.
 *   • Kaynak erişilemezse hiçbir şey kırılmaz; depo neyse o kalır, yeni
 *     maçlarda bölüm gizli doğar.
 *
 * Bu dosya AĞA ÇIKMAZ ve DOSYA OKUMAZ: yalnızca gelen yükü bizim
 * `detail.shots` sözleşmemize çeviren ve fikstür eşleştiren saf
 * işlevlerden oluşur — böylece `scripts/test-understat-shots.mjs`
 * gerçek ağ olmadan denetleyebiliyor.
 */

"use strict";

/** Understat lig kodu → depodaki yarışma kimliği. */
const LEAGUE_BY_COMPETITION = Object.freeze({
  "premier-league": "EPL",
  "la-liga": "La_liga",
  "serie-a": "Serie_A",
  bundesliga: "Bundesliga",
  "ligue-1": "Ligue_1"
});

/** Understat'ın kapsadığı yarışmalar — bunun dışında hiç istek atılmaz. */
function understatLeagueFor(competitionId) {
  return LEAGUE_BY_COMPETITION[String(competitionId || "").trim().toLowerCase()] || null;
}

function supportedCompetitions() {
  return Object.keys(LEAGUE_BY_COMPETITION);
}

/**
 * ŞUT SONUCU EŞLEMESİ.
 *
 * `OwnGoal` BİLEREK DIŞARIDA. Understat kendi kalesine golü, kaydı tutulan
 * takımın şutu olarak işaretliyor; haritaya koyduğumuzda o takımın rakip
 * kaleye çektiği bir gol gibi görünürdü. Kendi kalesine goller zaten maç
 * zaman çizgisinde doğru tarafla gösteriliyor — haritada YANLIŞ göstermek
 * yerine hiç göstermemek doğrusu.
 */
const RESULT_MAP = Object.freeze({
  Goal: "goal",
  SavedShot: "on",
  ShotOnPost: "off",
  MissedShots: "off",
  BlockedShot: "blocked"
});

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  const out = String(value === null || value === undefined ? "" : value).trim();
  return out && !/^(null|undefined|nan)$/i.test(out) ? out : null;
}

/**
 * Bir Understat şut kaydını `detail.shots` sözleşmesine çevirir.
 *
 * KOORDİNAT: Understat `X`/`Y` değerlerini 0-1 aralığında ve HER İKİ TAKIM
 * İÇİN de "kendi kalesinden rakip kaleye doğru" verir (X=1 rakip kale
 * çizgisi). Bizim sözleşmemiz de aynı yönde 0-100 bekliyor; yüzeydeki
 * ayna çevirmesini (deplasmanın sağdan sola hücum etmesi) çizim katmanı
 * yapıyor. Bu yüzden burada yalnızca ölçek büyütülür, yön DEĞİŞTİRİLMEZ.
 *
 * @returns {object|null} ölçülemeyen kayıt için `null`
 */
function normalizeShot(raw) {
  if (!raw) return null;
  const outcome = RESULT_MAP[String(raw.result || "").trim()];
  if (!outcome) return null;

  const x = toNumber(raw.X);
  const y = toNumber(raw.Y);
  if (x === null || y === null) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;

  const side = raw.h_a === "h" ? "home" : raw.h_a === "a" ? "away" : null;
  if (!side) return null;

  const xg = toNumber(raw.xG);
  const minute = toNumber(raw.minute);

  return {
    x: Math.round(x * 1000) / 10,
    y: Math.round(y * 1000) / 10,
    side,
    team: text(side === "home" ? raw.h_team : raw.a_team),
    outcome,
    minute: minute === null || minute < 0 || minute > 130 ? null : minute,
    player: text(raw.player),
    assist: text(raw.player_assisted),
    // xG bir olasılıktır: 0-1 dışına çıkan bir değer ölçüm değil, bozuk
    // alandır ve taşınmaz.
    xg: xg === null || xg < 0 || xg > 1 ? null : Math.round(xg * 1000) / 1000,
    situation: text(raw.situation),
    shotType: text(raw.shotType)
  };
}

/**
 * `getMatchData/<id>` yükündeki iki tarafı tek listeye indirir.
 * Sıralama dakikaya göre: xG eğrisi kümülatif toplandığı için giriş
 * sırasının kronolojik olması gerekiyor.
 */
function normalizeMatchShots(payload) {
  const shots = payload && payload.shots;
  if (!shots) return [];
  const rows = []
    .concat(Array.isArray(shots.h) ? shots.h : [])
    .concat(Array.isArray(shots.a) ? shots.a : [])
    .map(normalizeShot)
    .filter(Boolean);
  return rows.sort((left, right) => {
    const a = left.minute === null ? 999 : left.minute;
    const b = right.minute === null ? 999 : right.minute;
    return a - b;
  });
}

/* ------------------------------------------------------------------ */
/* FİKSTÜR EŞLEŞTİRME                                                  */
/* ------------------------------------------------------------------ */

/**
 * Kulüp adı normalleştirme — İKİ KAYNAK AYNI KULÜBÜ FARKLI YAZIYOR.
 *
 * API-Football "Paris Saint Germain" derken Understat "Paris Saint
 * Germain"; "Wolverhampton Wanderers" ↔ "Wolverhampton"; "Inter" ↔
 * "Internazionale". Aksan, noktalama ve yaygın kulüp ekleri ("FC", "AC",
 * "CF", "1899") atılarak karşılaştırılabilir bir anahtar üretilir.
 */
const CLUB_NOISE = /\b(fc|afc|cf|ac|as|sc|ss|ssc|ssd|us|ud|rc|rcd|cd|sv|tsv|vfl|vfb|bsc|fsv|sp|spor|club|calcio|de|futbol|football)\b/g;

/**
 * KULÜP TAKMA ADLARI — İKİ KAYNAK AYNI KULÜBÜ BAŞKA ADLA YAZIYOR.
 *
 * Aşağıdaki karşılıkların hepsi VARSAYIM DEĞİL, ÖLÇÜM: Understat'ın kendi
 * lig yükündeki (`getLeagueData`) takım adları okunarak çıkarıldı. Genel
 * bir "benzerlik" kuralı bu farkları kapatamaz — "Köln" ile "Cologne"
 * ortak harf dizisi taşımıyor, "RB" ile "RasenBallsport" ise ancak
 * tehlikeli derecede gevşek bir kuralla eşleşirdi. Bu yüzden istisna
 * olarak tek tek yazılıyor: liste kısa, açık ve denetlenebilir.
 *
 * Anahtarların ikisi de `clubKey` çıktısıdır (aksansız, eksiz, sadeleşmiş).
 */
const CLUB_ALIASES = Object.freeze({
  "bayern munchen": "bayern munich",
  "borussia monchengladbach": "borussia m gladbach",
  "1 koln": "cologne",
  koln: "cologne",
  "rb leipzig": "rasenballsport leipzig",
  "estac troyes": "troyes",
  "stade brestois 29": "brest",
  "stade brestois": "brest"
});

function clubKey(name) {
  const key = rawClubKey(name);
  return CLUB_ALIASES[key] || key;
}

function rawClubKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(CLUB_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * İki kulüp adı aynı kulübü mü gösteriyor?
 *
 * Tam eşitlik ya da biri diğerinin BAŞLANGICI olmalı ("wolverhampton" ⊂
 * "wolverhampton wanderers"). Gevşek bir "içeriyor" karşılaştırması
 * ("united" her yere uyar) farklı kulüpleri eşleştirir ve YANLIŞ MAÇIN
 * şut haritası basılırdı; bu yüzden eşleşme başlangıç ekine bağlı ve en
 * az dört karakter ister.
 */
function sameClub(left, right) {
  const a = clubKey(left);
  const b = clubKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** "2026-09-12 19:00:00" → "2026-09-12" */
function dayOf(value) {
  const raw = String(value || "").trim();
  const found = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return found ? found[1] : null;
}

/**
 * Bizim fikstürümüze karşılık gelen Understat maçını bulur.
 *
 * ÜÇ ŞART BİRDEN: ev sahibi, deplasman ve GÜN. Yalnızca takım adlarına
 * bakmak, aynı eşleşmenin rövanşını (ya da geçen sezonki maçını) tutardı
 * ve bir maçın haritası başka bir maça basılırdı. Gün toleransı ±1:
 * kaynaklar farklı saat dilimi kullanıyor ve gece yarısını geçen
 * karşılaşmalar bir gün kayabiliyor.
 *
 * SKOR DOĞRULAMASI: gün toleransı yüzünden birden çok aday kalırsa skor
 * ayırt edici olarak kullanılır. Hiçbir aday kalmazsa `null` döner —
 * "yakın olanı" seçmek, yanlış maçın verisini yayımlamak olurdu.
 */
function findMatch(dates, fixture) {
  const rows = Array.isArray(dates) ? dates : [];
  const wantedDay = dayOf(fixture && fixture.day);
  if (!wantedDay) return null;

  const candidates = rows.filter((row) => {
    if (!row || !row.isResult) return false;
    const home = row.h && row.h.title;
    const away = row.a && row.a.title;
    if (!sameClub(home, fixture.homeTeam) || !sameClub(away, fixture.awayTeam)) return false;
    const day = dayOf(row.datetime);
    if (!day) return false;
    const diff = Math.abs(Date.parse(`${day}T12:00:00Z`) - Date.parse(`${wantedDay}T12:00:00Z`));
    return diff <= 36 * 60 * 60 * 1000;
  });

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const score = fixture.score || {};
  const exact = candidates.filter((row) =>
    row.goals && String(row.goals.h) === String(score.home) && String(row.goals.a) === String(score.away));
  if (exact.length === 1) return exact[0];

  // Hâlâ ayırt edilemiyorsa hiçbiri seçilmez.
  return null;
}

module.exports = {
  CLUB_ALIASES,
  clubKey,
  dayOf,
  findMatch,
  normalizeMatchShots,
  normalizeShot,
  sameClub,
  supportedCompetitions,
  understatLeagueFor,
  LEAGUE_BY_COMPETITION,
  RESULT_MAP
};
