/**
 * TRANSFER ETKİSİ — ölçülebilen etki, ölçülemeyeni saklamadan.
 *
 * Bir transferin "etkisi" dört soruya ayrılır:
 *
 *   1. ROL            Oyuncu hangi mevkiye alındı?
 *   2. KADRO ETKİSİ   O mevkide kadro ne kadar kalabalık? Yaş dengesi ne?
 *   3. RİSK           Hareketin biçiminden okunabilen riskler neler?
 *   4. TAKTİK UYUM    Oyuncu takımın oyununa uyar mı?
 *
 * DÖRDÜNÜN İKİSİ BUGÜN ÖLÇÜLEMİYOR ve bu dosyanın en önemli kısmı, onları
 * uydurmak yerine açıkça öyle işaretlemesidir.
 *
 * DENETİM (2026-07, depo verisi):
 *   • data/super-lig-squads.json — 18/18 takımın kadrosu TAM. Mevki dağılımı,
 *     kadro derinliği ve yaş ortalaması GERÇEKTEN hesaplanabiliyor.
 *   • data/players.json — 612 oyuncunun yalnızca 8'inde dakika/maç verisi var.
 *     Yani "ilk 11'e girer mi?" sorusu 604 oyuncu için ÖLÇÜLEMEZ.
 *   • Hiçbir kayıtta oyun stili ölçüsü (pas ağı, presleme yoğunluğu, hücum
 *     yönü) yok. "Taktik uyum" için gereken veri depoda YOK.
 *
 * Bu iki alan için bir sayı üretmek — "%78 taktik uyum", "ilk 11 ihtimali
 * yüksek" — sitenin tamamında uygulanan kuralı tek noktadan kırardı.
 * Okuyucu ölçülmüş bir sayıyla uydurulmuş bir sayıyı ayırt edemez; uydurulan
 * sayı, ölçülenin de güvenilirliğini götürür.
 *
 * Bu yüzden alanlar KALDIRILMADI, `measured: false` ve GEREKÇEYLE duruyor.
 * Veri geldiği gün kendiliğinden dolarlar; o güne kadar okuyucu neyin
 * bilinmediğini biliyor.
 */

const { publishableTransfers } = require("./transferService.js");
const { relativeAgeLabel } = require("./contentFreshness.js");

/**
 * Transfer kayıtlarındaki Türkçe mevki adlarını kadro verisinin mevki
 * gruplarına eşler. Kadro sağlayıcısı yalnızca dört grup gönderiyor.
 */
const POSITION_GROUPS = Object.freeze({
  kaleci: "Goalkeeper",
  stoper: "Defender",
  "sag bek": "Defender",
  "sol bek": "Defender",
  bek: "Defender",
  defans: "Defender",
  "on libero": "Midfielder",
  "orta saha": "Midfielder",
  "merkez orta saha": "Midfielder",
  "on numara": "Midfielder",
  "10 numara": "Midfielder",
  kanat: "Attacker",
  "sag kanat": "Attacker",
  "sol kanat": "Attacker",
  santrfor: "Attacker",
  forvet: "Attacker"
});

/** Grupların Türkçe adı — kartta grup adı basılacaksa buradan okunur. */
const GROUP_LABELS = Object.freeze({
  Goalkeeper: "kaleci",
  Defender: "defans",
  Midfielder: "orta saha",
  Attacker: "hücum"
});

/**
 * Kadro kalabalıklığı eşikleri. Bir mevki grubunda bu sayıdan fazla oyuncu
 * varsa yeni gelen için rekabet yoğun demektir. Değerler kadro verisinin
 * kendi dağılımından okundu (18 takımın grup ortalamaları).
 */
const CROWDED_THRESHOLD = Object.freeze({
  Goalkeeper: 4,
  Defender: 11,
  Midfielder: 9,
  Attacker: 8
});

/** Genç ve deneyimli sınırları — yaş yorumları bu eşiklere bağlı. */
const YOUNG_AGE = 21;
const VETERAN_AGE = 31;

function fold(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

/** Transfer mevkisinin kadro grubu. Tanınmayan mevki için null. */
function positionGroup(position) {
  const key = fold(position);
  if (!key) return null;
  if (POSITION_GROUPS[key]) return POSITION_GROUPS[key];

  // Bileşik adlar ("Merkez orta saha") tam eşleşmezse parça araması yapılır.
  const found = Object.keys(POSITION_GROUPS).find((candidate) => key.includes(candidate));
  return found ? POSITION_GROUPS[found] : null;
}

/**
 * Kadro kaydını bulur.
 *
 * İki kaynak aynı kulübü farklı yazıyor: transfer kayıtlarında "Çaykur
 * Rizespor" ve "Gençlerbirliği", kadro senkronunda "Rizespor" ve
 * "Gençlerbirliği S.K.". Tam eşleşme arayan bir arama, gerçekten var olan
 * kadroyu "bulunamadı" diye raporlardı — ölçülebilir bir veriyi ölçülemez
 * göstermek, uydurma veri kadar yanlış.
 *
 * Bu yüzden önce tam eşleşme, sonra içerme aranıyor. İçerme iki yönlü:
 * hangi tarafın daha uzun yazıldığı kaynağa göre değişiyor.
 */
function squadOf(teamName, squads) {
  const key = fold(teamName);
  if (!key || !Array.isArray(squads)) return null;

  const exact = squads.find((squad) => fold(squad && squad.teamName) === key);
  if (exact) return exact;

  return squads.find((squad) => {
    const candidate = fold(squad && squad.teamName);
    if (!candidate) return false;
    return candidate.includes(key) || key.includes(candidate);
  }) || null;
}

/** Ölçülemeyen alan: sayı değil, gerekçe taşır. */
function unmeasured(id, label, reason) {
  return { id, label, measured: false, value: null, detail: reason };
}

function measured(id, label, value, detail) {
  return { id, label, measured: true, value, detail };
}

/**
 * ROL — transfer kaydının kendi alanı. Kaynaklı ve doğrulanmış.
 */
function roleAspect(transfer) {
  const position = String((transfer && transfer.position) || "").trim();
  if (!position) {
    return unmeasured("role", "Rol", "Transfer kaydında mevki bilgisi yok.");
  }

  const group = positionGroup(position);
  const detail = group
    ? `${position} — kadro dağılımında ${GROUP_LABELS[group]} grubunda değerlendirilir.`
    : `${position} — bu mevki kadro gruplarıyla eşleştirilemedi.`;
  return measured("role", "Rol", position, detail);
}

/**
 * KADRO ETKİSİ — GERÇEKTEN ÖLÇÜLEBİLİR.
 *
 * Kadro verisi 18/18 takım için tam. Aynı mevki grubunda kaç oyuncu olduğu,
 * grubun yaş ortalaması ve yeni gelenin bu dengeyi nasıl değiştirdiği
 * sayılabilir bir gerçek — tahmin değil.
 */
function squadAspect(transfer, squads) {
  const group = positionGroup(transfer && transfer.position);
  if (!group) {
    return unmeasured("squad", "Kadro etkisi",
      "Mevki kadro gruplarıyla eşleştirilemediği için derinlik hesaplanamadı.");
  }

  const squad = squadOf(transfer && transfer.toTeam, squads);
  if (!squad || !Array.isArray(squad.players) || !squad.players.length) {
    return unmeasured("squad", "Kadro etkisi",
      `${(transfer && transfer.toTeam) || "Yeni kulüp"} kadro kaydı bulunamadı.`);
  }

  const peers = squad.players.filter((player) => player && player.position === group);
  const ages = peers.map((player) => Number(player.age)).filter((age) => Number.isFinite(age) && age > 0);
  const averageAge = ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null;

  const crowded = CROWDED_THRESHOLD[group];
  const competition = peers.length > crowded ? "yoğun" : peers.length >= Math.ceil(crowded * 0.6) ? "dengeli" : "ihtiyaç";

  const parts = [
    `${squad.teamName} kadrosunda ${GROUP_LABELS[group]} grubunda ${peers.length} oyuncu var`,
    `rekabet ${competition}`
  ];
  if (averageAge !== null) parts.push(`grup yaş ortalaması ${String(averageAge).replace(".", ",")}`);

  return measured("squad", "Kadro etkisi", peers.length, `${parts.join(", ")}.`);
}

/**
 * RİSK — hareketin BİÇİMİNDEN okunan, ölçülebilir etkenler.
 *
 * Bir risk PUANI üretilmiyor: "risk %62" gibi bir sayı, dayandığı ölçü
 * olmadığı için uydurma olurdu. Bunun yerine kayıttan doğrudan okunabilen
 * etkenler sayılıyor ve okuyucu kendi yargısını kuruyor.
 */
function riskAspect(transfer, squads) {
  const factors = [];
  const record = transfer || {};

  const type = String(record.type || "").trim();
  if (/kiralık/i.test(type)) {
    factors.push("Kiralık hareket: oyuncu sezon sonunda kadroda kalmayabilir.");
  }
  if (/sözleşme sonu|serbest/i.test(type)) {
    factors.push("Bonservis bedeli olmayan hareket: maliyet düşük, rekabet yüksekti.");
  }

  if (!isNumber(record.feeEur)) {
    factors.push("Bonservis bedeli açıklanmadı; yatırımın büyüklüğü ölçülemiyor.");
  }

  const group = positionGroup(record.position);
  const squad = squadOf(record.toTeam, squads);
  if (group && squad && Array.isArray(squad.players)) {
    const peers = squad.players.filter((player) => player && player.position === group).length;
    if (peers > CROWDED_THRESHOLD[group]) {
      factors.push(`Aynı mevkide ${peers} oyuncu bulunuyor; süre rekabeti yoğun.`);
    }
  }

  const ages = [];
  if (isNumber(record.age)) ages.push(Number(record.age));
  if (ages.length) {
    if (ages[0] <= YOUNG_AGE) factors.push(`${ages[0]} yaşında: gelişim transferi.`);
    if (ages[0] >= VETERAN_AGE) factors.push(`${ages[0]} yaşında: kısa vadeli katkı beklentisi.`);
  }

  if (!factors.length) {
    return unmeasured("risk", "Risk etkenleri",
      "Kayıttan okunabilen bir risk etkeni yok; bedel, süre ve kadro dengesi olağan.");
  }

  return measured("risk", "Risk etkenleri", factors.length, factors.join(" "));
}

/**
 * İLK 11 ETKİSİ — BUGÜN ÖLÇÜLEMEZ.
 *
 * Cevap için oyuncunun oynadığı dakika, girdiği maç ve rakiplerinin aynı
 * ölçüleri gerekir. Depodaki 612 oyuncunun 8'inde bu veri var (kadro senkronu
 * istatistik uç noktasını çağırmıyor). Kalan 604 oyuncu için "ilk 11'e girer"
 * demek, ölçülmemiş bir iddiadır.
 */
function startingElevenAspect(transfer, options) {
  const players = Array.isArray(options && options.players) ? options.players : [];
  const key = fold(transfer && transfer.playerId) || fold(transfer && transfer.playerName);
  const record = players.find((player) =>
    fold(player && player.id) === key || fold(player && player.name) === key);

  const minutes = record && (Number(record.minutesPlayed) || Number(record.minutes));
  const appearances = record && Number(record.appearances);

  if (!record || !(minutes > 0 || appearances > 0)) {
    return unmeasured("startingEleven", "İlk 11 etkisi",
      "Oyuncunun oynadığı dakika ve maç sayısı henüz ölçülmedi; ilk 11 etkisi hesaplanamıyor. " +
      "Kadro senkronu istatistik verisini getirdiğinde bu alan otomatik dolar.");
  }

  return measured("startingEleven", "İlk 11 etkisi", appearances || null,
    `Önceki kulübünde ${appearances || 0} maçta ${minutes || 0} dakika oynadı.`);
}

/**
 * TAKTİK UYUM — BUGÜN ÖLÇÜLEMEZ.
 *
 * Uyum için oyun stili ölçüleri gerekir: pas ağındaki rolü, presleme
 * yoğunluğu, hücum yönü, topsuz alan davranışı. Depoda bu ölçülerin hiçbiri
 * yok. "Taktik uyum yüksek" cümlesi bir gözlem değil, bir kanaat olurdu.
 */
function tacticalFitAspect() {
  return unmeasured("tacticalFit", "Taktik uyum",
    "Oyun stili ölçüleri (pas ağı, presleme yoğunluğu, hücum yönü) veri kaynağında yok. " +
    "Uyum yorumu ölçüye dayanmadan yazılmaz.");
}

/**
 * Tek bir transferin etkisi.
 *
 * @param {object} transfer
 * @param {{squads?: Array, players?: Array, now?: Date}} [options]
 * @returns {{transferId, playerName, route, aspects, measuredCount, totalCount,
 *   coverage, verifiedAgo, note}}
 */
function transferImpact(transfer, options = {}) {
  const squads = Array.isArray(options.squads) ? options.squads : [];

  const aspects = [
    roleAspect(transfer),
    squadAspect(transfer, squads),
    startingElevenAspect(transfer, options),
    riskAspect(transfer, squads),
    tacticalFitAspect()
  ];

  const measuredCount = aspects.filter((aspect) => aspect.measured).length;
  const record = transfer || {};

  return {
    transferId: record.id || null,
    playerName: record.playerName || null,
    route: record.fromTeam && record.toTeam ? `${record.fromTeam} → ${record.toTeam}` : null,
    type: record.type || null,
    aspects,
    measuredCount,
    totalCount: aspects.length,
    coverage: Math.round((measuredCount / aspects.length) * 100),
    verifiedAgo: record.lastVerifiedAt ? relativeAgeLabel(record.lastVerifiedAt, options.now) : null,
    // Okuyucuya kaç başlıktan kaçının ölçüldüğü açıkça söylenir. Bu satır
    // olmadan beş başlıklı bir kartta ikisinin boş olması "eksik sayfa" gibi
    // görünür; oysa doğru okuma "bu iki şey henüz ölçülmedi".
    note: measuredCount === aspects.length
      ? "Beş başlığın beşi de ölçüldü."
      : `${aspects.length} başlıktan ${measuredCount} tanesi ölçüldü; kalanı için veri bekleniyor.`
  };
}

/**
 * Yayımlanabilir transferlerin etkisi, en yeniden eskiye.
 *
 * Yayın kapısı services/transferService.js'de; burada tekrarlanmıyor. Kapıdan
 * geçmeyen bir transferin etkisi de yayımlanmaz.
 */
function transferImpacts(options = {}) {
  const { transfers, excluded } = publishableTransfers();
  const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : transfers.length;

  const impacts = transfers
    .slice(0, limit)
    .map((transfer) => ({ transfer, impact: transferImpact(transfer, options) }));

  return { impacts, excluded };
}

module.exports = {
  CROWDED_THRESHOLD,
  GROUP_LABELS,
  POSITION_GROUPS,
  VETERAN_AGE,
  YOUNG_AGE,
  positionGroup,
  transferImpact,
  transferImpacts
};
