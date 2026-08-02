/**
 * TEKİLLEŞTİRİCİ — "bu hareketi zaten biliyor muyuz?" sorusunun tek yanıtı.
 *
 * KİMLİK: oyuncu + eski kulüp + yeni kulüp + transfer penceresi.
 *
 * Pencere kimliğe dahil, çünkü aynı oyuncu aynı iki kulüp arasında farklı
 * pencerelerde hareket edebilir (kiralık gidip yazın geri dönmek gibi) ve
 * bunlar AYRI hareketlerdir. Sezon yerine pencere kullanılıyor: bir sezonun
 * yaz ve kış penceresi ayrı transfer olaylarıdır.
 *
 * EKSİK TARAF SORUNU: erken haberlerde çoğu zaman yalnızca hedef kulüp
 * bilinir ("Galatasaray X'i istiyor"), eski kulüp sonra netleşir. Kimlik
 * ikisini de şart koşsaydı, aynı transfer önce "?→GS" sonra "Y→GS" olarak
 * iki kayıt üretirdi. Bu yüzden eşleştirme İKİ AŞAMALI:
 *   1. Tam kimlik eşleşmesi.
 *   2. Tutmazsa: oyuncu + pencere + bilinen taraflardan biri.
 * İkinci aşama eşleşirse kayıt BİRLEŞTİRİLİR ve eksik taraf doldurulur.
 */

const { canonicalClub, canonicalPlayer, slug, transferWindow } = require("./normalizer.js");

/** Kimlik dizesi. Boş taraf "?" ile yazılır ki kimlik hep dört parçalı olsun. */
function transferIdentity(record) {
  return [
    slug(canonicalPlayer(record && record.playerName)) || "?",
    slug(canonicalClub(record && record.fromTeam)) || "?",
    slug(canonicalClub(record && record.toTeam)) || "?",
    String((record && record.transferWindow) || "") || "?"
  ].join("|");
}

/** Kararlı kayıt kimliği: URL ve dosya anahtarı olarak kullanılır. */
function transferKey(record) {
  const parts = [
    slug(canonicalPlayer(record && record.playerName)),
    slug(canonicalClub(record && record.toTeam)) || slug(canonicalClub(record && record.fromTeam)),
    String((record && record.transferWindow) || "")
  ].filter(Boolean);
  return parts.join("-");
}

function sameWindow(left, right) {
  return String(left && left.transferWindow) === String(right && right.transferWindow);
}

/**
 * Var olan kayıtlar içinde eşleşeni bulur.
 *
 * @returns {{match: Object|null, exact: boolean}}
 */
function findExisting(candidate, existing) {
  const list = Array.isArray(existing) ? existing : [];
  const identity = transferIdentity(candidate);

  for (const record of list) {
    if (transferIdentity(record) === identity) {
      return { match: record, exact: true };
    }
  }

  // Gevşek eşleşme: aynı oyuncu, aynı pencere, bilinen taraflardan biri aynı.
  const player = slug(canonicalPlayer(candidate.playerName));
  if (!player) return { match: null, exact: false };

  const candFrom = slug(canonicalClub(candidate.fromTeam));
  const candTo = slug(canonicalClub(candidate.toTeam));

  for (const record of list) {
    if (slug(canonicalPlayer(record.playerName)) !== player) continue;
    if (!sameWindow(record, candidate)) continue;

    const recFrom = slug(canonicalClub(record.fromTeam));
    const recTo = slug(canonicalClub(record.toTeam));

    const toAgrees = candTo && recTo && candTo === recTo;
    const fromAgrees = candFrom && recFrom && candFrom === recFrom;
    const toFillable = (!candTo && recTo) || (candTo && !recTo);
    const fromFillable = (!candFrom && recFrom) || (candFrom && !recFrom);

    // En az bir taraf uyuşmalı; diğeri ya uyuşur ya da biri boştur.
    if ((toAgrees && (fromAgrees || fromFillable)) || (fromAgrees && toFillable)) {
      return { match: record, exact: false };
    }
  }

  return { match: null, exact: false };
}

/**
 * Aday listesini kendi içinde tekilleştirir.
 *
 * Aynı koşuda birden çok kaynak aynı hareketi bildirirse tek kayıt kalır;
 * kaynakları BİRLEŞİR (teyit sayısı güven skorunu besler).
 */
function collapseCandidates(candidates) {
  const byIdentity = new Map();
  const merged = [];

  for (const candidate of candidates || []) {
    const key = transferIdentity(candidate);
    const existing = byIdentity.get(key);

    if (!existing) {
      byIdentity.set(key, {
        ...candidate,
        sources: [candidateSource(candidate)]
      });
      continue;
    }

    existing.sources.push(candidateSource(candidate));
    merged.push({ identity: key, url: candidate.sourceUrl });

    // Daha ileri bir durum bildiren kaynak varsa talebi yükselt.
    const { statusRank } = require("./statusModel.js");
    if (statusRank(candidate.requestedStatus) > statusRank(existing.requestedStatus)) {
      existing.requestedStatus = candidate.requestedStatus;
    }
    // Eksik alanları dolduranı al; dolu alanı EZME.
    for (const field of ["fromTeam", "toTeam", "type", "fee", "playerName"]) {
      if (!existing[field] && candidate[field]) existing[field] = candidate[field];
    }
    if (existing.feeEur === null && candidate.feeEur !== null) existing.feeEur = candidate.feeEur;
  }

  return { candidates: [...byIdentity.values()], merged };
}

function candidateSource(candidate) {
  return {
    id: candidate.sourceId || "",
    name: candidate.sourceName || "",
    tier: candidate.sourceTier || "other_media",
    url: candidate.sourceUrl || "",
    publishedAt: candidate.sourcePublishedAt || ""
  };
}

module.exports = {
  candidateSource,
  collapseCandidates,
  findExisting,
  sameWindow,
  transferIdentity,
  transferKey,
  transferWindow
};
