/**
 * "SIRADAKİ MAÇ" GEÇMİŞTE KALMASIN.
 *
 * Takım sayfaları statik üretiliyor; sabit yazılmış ya da bayat veriden
 * gelen bir "sıradaki maç" (ör. Galatasaray - Amedspor, 7 Kasım) sayfa
 * 26 Kasım'da yayındayken geçmiş bir tarihi gösteriyordu. Burada tek kural:
 * kickoff günü (Europe/Istanbul) BUGÜNDEN önce olan maç "sıradaki" sayılmaz.
 * Bugünkü maç sayılır — saati geçmiş olsa bile gün bitene kadar listede kalır.
 */
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
});

/** ISO tarih/saat ya da "YYYY-MM-DD" → İstanbul günü ("YYYY-MM-DD") ya da null. */
export function istanbulDayOf(value) {
  if (value == null || value === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? DAY_FORMAT.format(new Date(ms)) : null;
}

export function todayIstanbul(now = Date.now()) {
  return istanbulDayOf(new Date(now));
}

/** Tarihi bilinmeyen kayıt "sıradaki" iddiası taşıyamaz → false. */
export function isUpcoming(value, now = Date.now()) {
  const day = istanbulDayOf(value);
  return Boolean(day) && day >= todayIstanbul(now);
}

/** `pick(item)` kayıttan tarih/kickoff döndürür. Sıra korunur. */
export function filterUpcoming(items, pick = (item) => item && (item.kickoff || item.date), now = Date.now()) {
  return (Array.isArray(items) ? items : []).filter((item) => isUpcoming(pick(item), now));
}
