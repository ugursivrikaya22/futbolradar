const CONFIDENCE_LABELS = {
  high: "Yüksek güven",
  medium: "Orta güven",
  low: "Sınırlı güven"
};

const STATUS_LABELS = {
  verified: "Son kontrol tamamlandı",
  provider: "Sağlayıcı kaydı",
  manual: "Manuel kontrol",
  reference: "Model referansı",
  pending: "Güncelleme bekleniyor",
  stale: "Güncelleme gerekli",
  estimated: "Tahmini kayıt"
};

function toDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeConfidence(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CONFIDENCE_LABELS, normalized)
    ? normalized
    : (fallback || "low");
}

function normalizeFreshness(record, defaults) {
  const source = record && typeof record === "object" ? record : {};
  const fallback = defaults && typeof defaults === "object" ? defaults : {};
  const validUntil = source.validUntil || fallback.validUntil || null;
  const validUntilDate = toDate(validUntil);
  const isExpired = Boolean(validUntilDate && validUntilDate.getTime() < Date.now());
  const rawStatus = String(source.status || fallback.status || "pending").trim().toLowerCase();
  const status = isExpired && rawStatus !== "pending" ? "stale" : rawStatus;

  return {
    source: source.source || fallback.source || "FutbolRadar",
    provider: source.provider || fallback.provider || "FutbolRadar",
    fetchedAt: source.fetchedAt || source.lastSyncedAt || fallback.fetchedAt || null,
    verifiedAt: source.verifiedAt || fallback.verifiedAt || null,
    validUntil,
    status: STATUS_LABELS[status] ? status : "pending",
    confidence: normalizeConfidence(source.confidence || fallback.confidence),
    isFallback: Boolean(source.isFallback ?? fallback.isFallback),
    isExpired
  };
}

function freshnessLabel(record) {
  const freshness = normalizeFreshness(record);
  return STATUS_LABELS[freshness.status] || STATUS_LABELS.pending;
}

function confidenceLabel(value) {
  return CONFIDENCE_LABELS[normalizeConfidence(value)] || CONFIDENCE_LABELS.low;
}

function latestTimestamp(records) {
  const values = (Array.isArray(records) ? records : [])
    .flatMap((record) => {
      const freshness = normalizeFreshness(record);
      return [freshness.verifiedAt, freshness.fetchedAt];
    })
    .map(toDate)
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime());

  return values.length ? values[0].toISOString() : null;
}

function formatFreshnessDate(value) {
  const date = toDate(value);
  if (!date) {
    return "Tarih bekleniyor";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  }).format(date) + " TSİ";
}

module.exports = {
  CONFIDENCE_LABELS,
  STATUS_LABELS,
  confidenceLabel,
  formatFreshnessDate,
  freshnessLabel,
  latestTimestamp,
  normalizeConfidence,
  normalizeFreshness
};
