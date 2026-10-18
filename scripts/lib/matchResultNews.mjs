/**
 * MAÇ SONUCU HABERLERİ — DOĞRULANMIŞ MAÇ VERİSİNDEN, ELLE DEĞİL.
 *
 * NEDEN VAR. `/haber/` hattının tek maç haberi (Galatasaray–Kasımpaşa, 9 Ekim)
 * ELLE yazılmıştı (`data/galatasaray-kasimpasa-news.json`, tek maça kodlanmış
 * `services/matchNews.js`). Maç haberi üreten OTOMATİK bir adım hiç yoktu;
 * kalan haberleri Sporx keşfi üretiyordu ve o hat kapatılınca 9 Ekim'den sonra
 * yeni haber çıkmadı (Galatasaray–Barcelona 1-4 dâhil). Bu modül o boşluğu
 * kapatır; Sporx'e HİÇ dokunmaz.
 *
 * NE YAZAR. Yalnızca `data/post-match-reports.json` kaydındaki doğrulanmış
 * alanlar: skor, `digest.headline/paragraph` (olay akışından üretilmiş gol
 * dizisi), saha, tarih. Uydurma metin, tahmin, alıntı ve başka sitenin
 * cümlesi yok. Kaynak (API-Football verisi → FutbolRadar maç raporu) ve tarih
 * her haberde görünür.
 *
 * NE YAZMAZ.
 *  - Bitmemiş, hükmen, iptal, geleceğe tarihli maç.
 *  - Olay verisi (gol dizisi) olmayan ya da "tam" doğrulanmamış kayıt.
 *  - Özetteki gol sayısı skorla tutmayan kayıt (iptal edilen gol riski).
 *  - Raporu diskte olmayan maç (#411'in söktüğü rapor için haber de çıkmaz).
 *  - Aynı maç için ikinci haber: kimlik `matchId`'den türer; `matchId`,
 *    `matchFixtureId` ya da eski elle haberin `liveMatchNews` değeri aynıysa atlanır.
 */

export const NEWS_COMPETITIONS = new Set([
  "Süper Lig", "Şampiyonlar Ligi", "Avrupa Ligi", "Konferans Ligi", "Türkiye Kupası"
]);
export const DEFAULT_WINDOW_HOURS = 120;
const FINAL = new Set(["FT", "AET", "PEN"]);
const DOMAIN = "https://www.futbolradar.com";

function isNum(value) { return Number.isFinite(Number(value)) && value !== null && value !== ""; }

/** Maçın İstanbul takvim günü (YYYY-MM-DD); kopya eşleşmesi üretim saatine değil buna bakar. */
export function kickoffDay(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function trDate(iso) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

/** Kayıt haber olmaya uygun mu? Değilse neden (günlük için). */
export function ineligibleReason(record, { now, windowHours = DEFAULT_WINDOW_HOURS, reportExists = () => true } = {}) {
  if (!record || !record.matchId) return "kimlik yok";
  if (!NEWS_COMPETITIONS.has(record.competition)) return "kapsam dışı yarışma";
  if (!record.turkish) return "Türk takımı yok";
  if (record.status !== "FINISHED" || !FINAL.has(String(record.providerStatus || "").toUpperCase())) return "bitmemiş";
  if (record.finishType && record.finishType !== "regular") return "normal süre dışı bitiş";
  const kick = Date.parse(record.kickoff || "");
  if (!Number.isFinite(kick) || kick > now) return "geçersiz/gelecek saat";
  if (now - kick > windowHours * 3600000) return "pencere dışı";
  if (!record.score || !isNum(record.score.home) || !isNum(record.score.away)) return "skor yok";
  if (record.dataStatus !== "complete" || !(record.dataSources && record.dataSources.events && record.dataSources.events.present)) return "olay verisi doğrulanmamış";
  const digest = record.digest || {};
  if (!digest.headline || !digest.paragraph) return "özet yok";
  const goals = (String(digest.paragraph).match(/\d+\. dakikada/g) || []).length;
  if (goals !== Number(record.score.home) + Number(record.score.away)) return "gol dizisi skorla tutmuyor";
  const stamp = record.analysisGeneratedAt || record.generatedAt;
  if (!stamp || !Number.isFinite(Date.parse(stamp))) return "üretim tarihi yok";
  const reportPath = record.seo && record.seo.path;
  if (!reportPath || !reportExists(reportPath)) return "rapor sayfası yok";
  return null;
}

export function buildArticle(record) {
  const { homeTeam, awayTeam, score, competition } = record;
  const result = `${score.home}–${score.away}`;
  const published = new Date(record.analysisGeneratedAt || record.generatedAt).toISOString();
  const reportUrl = `${DOMAIN}/${record.seo.path}`;
  const id = `${record.matchId}-mac-sonucu`;
  const single = String(record.turkishTeam || "").includes("&") ? homeTeam : record.turkishTeam;
  const day = trDate(record.kickoff);
  const venue = record.venue ? ` Saha: ${record.venue}.` : "";
  return {
    id,
    slug: id,
    title: `${homeTeam} ${result} ${awayTeam}: ${competition} maç sonucu`,
    summary: `${record.digest.headline}. Skor ve goller API-Football olay verisinden, ${day} tarihli maç raporuyla birlikte.`,
    category: competition,
    team: single,
    status: "verified",
    publishedAt: published,
    updatedAt: published,
    sourceName: "FutbolRadar",
    matchId: record.matchId,
    matchFixtureId: record.fixtureId || null,
    kickoffDay: kickoffDay(record.kickoff),
    autoMatchResult: true,
    url: `${DOMAIN}/haber/${id}`,
    body: [
      record.digest.paragraph,
      `Karşılaşma ${day} tarihinde oynandı (${competition}); sonuç normal sürede belirlendi.${venue}`,
      `Kaynak ve tarih: skor, goller ve olay sırası API-Football verisinden alınmış, ${trDate(published)} tarihinde FutbolRadar maç raporuna işlenmiştir. Ayrıntılar için maç raporuna bakın.`
    ],
    sources: [{ name: "FutbolRadar maç raporu (API-Football verisi)", url: reportUrl }],
    internalLinks: [{ label: `${homeTeam} – ${awayTeam} maç raporu`, href: `../${record.seo.path}` }],
    tags: [homeTeam, awayTeam, competition, day, "Maç sonucu"],
    seo: {
      metaTitle: `${homeTeam} ${result} ${awayTeam}: ${competition} maç sonucu | FutbolRadar`,
      metaDescription: `${record.digest.headline}. ${competition}, ${day}.`.slice(0, 200),
      canonical: `${DOMAIN}/haber/${id}`
    }
  };
}

/** Yeni haberleri döndürür; var olanlara dokunmaz. */
export function buildMatchResultNews(records, existingNews, options = {}) {
  const now = options.now ?? Date.now();
  const existing = Array.isArray(existingNews) ? existingNews : [];
  const seen = new Set();
  for (const item of existing) {
    for (const key of [item.id, item.matchId, item.matchFixtureId, item.liveMatchNews]) if (key) seen.add(String(key));
  }
  const added = [];
  const skipped = [];
  const ordered = [...(records || [])].sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  for (const record of ordered) {
    const reason = ineligibleReason(record, { ...options, now });
    if (reason) { if (reason !== "kapsam dışı yarışma" && reason !== "pencere dışı" && reason !== "Türk takımı yok") skipped.push({ id: record.matchId, reason }); continue; }
    const keys = [`${record.matchId}-mac-sonucu`, record.matchId, record.fixtureId].filter(Boolean).map(String);
    if (keys.some((key) => seen.has(key))) continue;
    // Aynı gerçek maçın iki kaydı (sağlayıcı kopyası): takım+skor+MAÇ GÜNÜ eşleşmesi.
    // Rapor üretim saatine bakılmaz; iki kopya UTC gece yarısının iki yanında üretilse de tek haber.
    const day = kickoffDay(record.kickoff);
    const dayTag = trDate(record.kickoff);
    const twin = existing.concat(added).some((item) => item.autoMatchResult
      && String(item.title || "").startsWith(`${record.homeTeam} ${record.score.home}–${record.score.away} ${record.awayTeam}:`)
      && (item.kickoffDay ? item.kickoffDay === day : (Array.isArray(item.tags) && item.tags.includes(dayTag))));
    if (twin) continue;
    added.push(buildArticle(record));
    keys.forEach((key) => seen.add(key));
  }
  return { added, skipped };
}
