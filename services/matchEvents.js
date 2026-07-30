/**
 * MAÇ OLAYLARINI OKUMA — tek yetkili ayrıştırma.
 *
 * Olay akışı (`match.events`) sitede üç ayrı soruya cevap veriyor:
 * raporun kırılma anları, momentum dilimleri ve "bu maç için hangi bölümler
 * üretilebilir?" sorusu. Üçü de aynı ham metni okuyor: `"37'"` biçiminde bir
 * dakika, `"Gol"` biçiminde bir tür ve `"Anderson Talisca serbest vuruştan
 * skoru 1-0 yaptı."` biçiminde serbest bir cümle.
 *
 * Bu ayrıştırma hassas ve yanılması sessiz. `"90+2'"` içindeki uzatma
 * dakikası düşürülürse ilk yarı uzatmasında atılan gol normal oyunda atılmış
 * gibi okunur; addaki hâl eki ("Kökçü'nün") kırpılmazsa aynı oyuncu iki ayrı
 * kişi sayılır. Bu yüzden ayrıştırma tek yerde yaşar: iki kopya bir gün
 * birbirinden ayrışır ve ayrıştıkları an kimse fark etmez.
 */

/** Aksan ve Türkçe "ı" farkını silerek karşılaştırılabilir metin üretir. */
function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    // Birleşen aksan işaretleri kod noktasıyla yazılır: aynı aralık düz
    // karakter olarak yazıldığında dosyayı okuyan gözle görünmez olur ve
    // yanlışlıkla silinmesi sessizce ayrıştırmayı bozar.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

/**
 * Olay dakikası, uzatma bilgisi KORUNARAK: `"45+4'"` -> `"45+4"`, `"37'"` -> 37.
 * Sayı ile metin karışık döner çünkü "45+4" bir sayı değildir ve sayıya
 * indirgenmesi bilgiyi yok eder.
 */
function minuteOf(event) {
  const raw = String((event && event.time) || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!raw) return null;
  return raw[2] ? `${raw[1]}+${raw[2]}` : Number(raw[1]);
}

/** Sıralama ve dilimleme için tek sayıya indirger: `"90+2'"` -> 92. */
function eventMinute(event) {
  const raw = String((event && event.time) || "").replace(/['’\s]/g, "");
  if (!raw) return null;
  const parts = raw.split("+").map((part) => Number(part));
  if (!parts.length || !Number.isFinite(parts[0])) return null;
  return parts.reduce((total, part) => total + (Number.isFinite(part) ? part : 0), 0);
}

/** Olayın takımı. Sağlayıcı bazen düz metin, bazen `{name}` gönderiyor. */
function eventTeamName(event) {
  if (!event || !event.team) return "";
  return typeof event.team === "string" ? event.team : event.team.name || "";
}

/** Olay türü verilen anahtarlardan birini içeriyor mu? */
function isType(event, ...needles) {
  const type = normalizeText(event && event.type);
  return needles.some((needle) => type.includes(normalizeText(needle)));
}

/** Geçerli goller. İptal edilen gol gol değildir. */
function goalEvents(match) {
  return ((match && match.events) || []).filter((event) => isType(event, "gol") && !isType(event, "iptal"));
}

/**
 * Ada eklenmiş Türkçe hâl ekini kırpar ("Kökçü'nün" -> "Kökçü") ama ad içinde
 * geçen kesme işaretini korur ("N'Golo"). Ayrım, kesmeden sonraki harfin
 * küçük olup olmadığına bakılarak yapılır.
 */
function stripTurkishSuffix(token) {
  return token.replace(/['’](?=\p{Ll})\p{Ll}+$/u, "");
}

/**
 * Olay metninden oyuncu adını çıkarır: "Anderson Talisca serbest vuruştan…".
 * En az iki sözcük aranır: tek sözcük çoğu zaman ad değil, cümlenin ilk
 * kelimesidir ("Kaleci", "Penaltı") ve oyuncu diye yazılması veri uydurmaktır.
 */
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

/** Dakikası ve takımı okunabilen olaylar. Momentum yalnızca bunlardan çıkar. */
function timedEvents(match) {
  return ((match && match.events) || [])
    .map((event) => ({ event, minute: eventMinute(event), team: eventTeamName(event) }))
    .filter((item) => item.minute !== null && item.team);
}

/** Oyuncuya yazılabilen katkı türleri. */
const CONTRIBUTION_TYPES = Object.freeze(["gol", "asist", "kurtarış", "direk", "kırmızı", "sarı"]);

/**
 * Öne çıkan oyuncular bölümünün ham malzemesi: katkı türünde olan VE içinden
 * bir oyuncu adı okunabilen olaylar. İkinci koşul şart: türü "Gol" olup
 * metninde ad geçmeyen bir olaydan oyuncu üretmek, veriyi uydurmak olur.
 */
function contributionEvents(match) {
  return ((match && match.events) || []).filter((event) =>
    isType(event, ...CONTRIBUTION_TYPES) && playerFromDetail(event.detail));
}

module.exports = {
  CONTRIBUTION_TYPES,
  contributionEvents,
  eventMinute,
  eventTeamName,
  goalEvents,
  isType,
  minuteOf,
  normalizeText,
  playerFromDetail,
  stripTurkishSuffix,
  timedEvents
};
