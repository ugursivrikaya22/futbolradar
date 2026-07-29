/**
 * GÜVEN ETİKETLERİ — tek yetkili söz dağarcığı.
 *
 * Sitede bir kartın ne kadar sağlam olduğunu söyleyen üç ayrı biçim vardı:
 * transferlerde "source-badge", oyuncu kartlarında sessiz eleme, maçlarda
 * hiçbir şey. Okuyucu aynı soruyu ("buna güvenebilir miyim?") her bölümde
 * farklı bir yerden okumak zorundaydı.
 *
 * Etiketler burada tek yerde tanımlı ve KAYITTAN TÜRETİLİR — elle yazılmaz.
 * Bir kartın "Doğrulandı" demesi, kaydın kaynağı ve doğrulama zamanı olduğu
 * anlamına gelir; başka hiçbir şey bu etiketi üretemez.
 *
 * Etiket bir iddiadır: yanlış etiket, yanlış veriden daha zararlıdır çünkü
 * okuyucunun kendi şüphesini kapatır.
 */

/**
 * SÖZ DAĞARCIĞININ METNİ templates/trust-labels.json'da yaşıyor.
 *
 * Etiket cümlesi okuyucuya bakan yüzdür; türetme kuralı ise bu dosyadadır.
 * İkisini ayırmak, üslup düzeltmesinin yanlışlıkla türetme mantığına
 * dokunmasını engelliyor — "Söylenti" yazan bir kartın hangi koşulda o
 * etiketi aldığı, o cümleyi yeniden yazan kişinin kararı olmamalı.
 *
 * Şablonun kapsamı METİNLE SINIRLI: hangi anahtarın basılacağına, kaydın
 * neyi taşıdığına ve neyin sessizce düşeceğine aşağıdaki fonksiyonlar
 * karar verir. Söz dağarcığı yine kapalıdır — şablonda olmayan anahtar
 * basılamaz.
 *
 * official/media/rumour metinleri services/transferService.js SOURCE_TYPES
 * ile BİREBİR aynı olmalı: kaynak türü iki ayrı sözcükle anlatılırsa okuyucu
 * aynı şeyin iki farklı şey olduğunu sanır. scripts/test-transfer-pipeline.mjs
 * hem bu eşliği hem de app.js aynasını karşılaştırır.
 */
const TRUST_LABELS = Object.freeze(require("../templates/trust-labels.json").labels);

/** Söz dağarcığı dışında bir etiket basılamaz. */
function isKnownLabel(key) {
  return Object.prototype.hasOwnProperty.call(TRUST_LABELS, key);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tek etiketin işaretlemesi. Bilinmeyen anahtar sessizce boş döner. */
function trustBadge(key) {
  if (!isKnownLabel(key)) return "";
  const label = TRUST_LABELS[key];
  return `<span class="trust-badge is-${escapeHtml(label.tone)}" data-trust="${escapeHtml(key)}" title="${escapeHtml(label.title)}">${escapeHtml(label.text)}</span>`;
}

/** Etiket şeridi. Boş listede hiç kap basmaz — boş kutu da bir iddiadır. */
function trustBadges(keys) {
  const list = (Array.isArray(keys) ? keys : []).filter(isKnownLabel);
  if (!list.length) return "";
  return `<span class="trust-badges">${list.map(trustBadge).join("")}</span>`;
}

/**
 * TRANSFER ETİKETLERİ.
 *
 * "Transfer kesinleşti" yalnızca kaydın durumu confirmed ise basılır;
 * kaynak türü ayrı bir etikettir çünkü ayrı bir soruya cevap verir:
 * "kesinleşti mi?" ile "kim söyledi?" aynı şey değil.
 */
function transferTrustLabels(transfer) {
  const record = transfer && typeof transfer === "object" ? transfer : {};
  const labels = [];

  if (String(record.status || "").toLowerCase() === "confirmed") {
    labels.push("transferConfirmed");
  }

  const sourceType = String(record.sourceType || "").toLowerCase();
  if (sourceType === "official") labels.push("official");
  else if (sourceType === "media") labels.push("media");
  else if (sourceType === "rumour" || sourceType === "rumor") labels.push("rumour");

  // Kaynağı ya da doğrulama zamanı olmayan kayıt tam sayılmaz.
  if (!String(record.sourceUrl || "").trim() || !String(record.lastVerifiedAt || "").trim()) {
    labels.push("incomplete");
  }

  return labels;
}

/**
 * MAÇ ETİKETLERİ.
 *
 * Görüntüleme kapısı (services/matchEligibility.js) skorsuz başlamış maçı
 * zaten listelerden çıkarıyor. Ama maç detay sayfası o maç için de var —
 * ve orada okuyucuya boş bir skor alanı yerine nedenini söylemek gerekir.
 */
function matchTrustLabels(match, options = {}) {
  const record = match && typeof match === "object" ? match : {};
  const labels = [];

  const status = String(record.status || "").toUpperCase();
  const score = record.score || {};
  const hasScore = score.home !== null && score.home !== undefined
    && score.away !== null && score.away !== undefined;

  const kickoff = record.kickoff ? new Date(record.kickoff) : null;
  const started = kickoff && !Number.isNaN(kickoff.getTime())
    ? kickoff.getTime() <= (options.currentTime ? new Date(options.currentTime).getTime() : Date.now())
    : false;

  if (status === "LIVE" && hasScore) labels.push("live");
  if (started && !hasScore) labels.push("noScore");

  return labels;
}

/**
 * AÇIKLAMA ETİKETLERİ.
 *
 * Yayımlanan her açıklama zaten doğrulanmış (services/matchStatementService.js
 * yalnızca "verified" kaydı geçiriyor), bu yüzden etiket kaynak türünü söyler.
 */
function statementTrustLabels(statement) {
  const record = statement && typeof statement === "object" ? statement : {};
  const labels = ["verified"];

  const sourceType = String(record.sourceType || "").toLowerCase();
  if (sourceType === "official") labels.push("official");
  else if (sourceType === "media") labels.push("media");

  return labels;
}

module.exports = {
  TRUST_LABELS,
  isKnownLabel,
  trustBadge,
  trustBadges,
  transferTrustLabels,
  matchTrustLabels,
  statementTrustLabels
};
