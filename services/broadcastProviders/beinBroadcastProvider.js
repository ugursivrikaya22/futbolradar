/**
 * beIN SPORTS TÜRKİYE ADAPTÖRÜ.
 *
 * Kaynak: https://www.beinsports.com.tr/yayin-akisi (ve kanal başına
 * /yayin-akisi/<kanal-slug>) — Süper Lig maçlarının resmî Türkiye
 * yayıncısının GÜNLÜK yayın akışı tablosu. Sayfa doğrulanmış yapısı:
 *
 *   <span class="streaming-content_time__HASH">20:00</span>
 *   <span class="streaming-content_program__HASH">Trabzonspor - Gençlerbirliği</span>
 *
 * YALNIZCA BUGÜN taranır, gelecek bir gün İÇİN DEĞİL. Sitenin haftalık
 * sekmeleri (`/yayin-akisi/beinsports/pazartesi` gibi) hangi TAKVİM gününe
 * denk geldiğini sayfada hiçbir yerde yazmıyor — "Pazartesi" sekmesi bu
 * haftanın mı, geçen haftanın mı Pazartesi'si belirsiz. Belirsiz bir tarihe
 * kanal atamak "yanlış maça kanal atama" riski taşır (bkz. görev tanımının
 * güvenlik maddesi); bu yüzden BİLEREK yalnızca bugünün (tarihi kesin
 * bilinen) programı okunur. 8 günlük pencerenin geri kalanı için
 * fallbackBroadcastProvider.js zaten bilinen bir kanalı taşıyorsa onu
 * kullanır; her gün bu adaptör o maçın günü geldiğinde RESMÎ kaynaktan
 * DOĞRULAR/GÜNCELLER (görev tanımının "Ek doğrulama" ve "24 saatten az
 * kalmışsa güncelle" maddeleri tam olarak bunu istiyor).
 *
 * AYNI TAKIM ÇİFTİ, GÜN İÇİNDE BİRDEN FAZLA KEZ GEÇEBİLİR — sabah tekrar
 * yayını, akşam CANLI yayın. Bu yüzden aday, kendi SAATİYLE birlikte
 * üretilir; gerçek eşleşme (scripts/sync-match-broadcasts.mjs) fikstürün
 * bilinen başlama saatine YAKIN olanı seçer, günün ilk rastlantısal
 * eşleşmeyi değil.
 *
 * KIRILGANLIK KABUL EDİLDİ. CSS sınıf adlarındaki `HASH` kısmı derleme
 * aracının ürettiği bir değer ve değişebilir; yalnızca STABİL görünen
 * `streaming-content_time__` / `streaming-content_program__` ÖN EKİ
 * aranır. Yapı tamamen değişirse bu adaptör YANLIŞ bir kanal UYDURMAZ,
 * yalnızca boş sonuç döner.
 */

const { parseFixtureLine, decodeEntities, fetchRaw } = require("./htmlText.js");
const { istanbulDay } = require("../matchStatus.js");

const SOURCE_NAME = "beIN SPORTS Türkiye";
const BASE_URL = "https://www.beinsports.com.tr/yayin-akisi";

/** Kanal sekmesi slug'ı → görünen kanal adı. */
const CHANNELS = [
  { slug: "beinsports", label: "beIN SPORTS 1" },
  { slug: "beinsports-2", label: "beIN SPORTS 2" },
  { slug: "beinsports-3", label: "beIN SPORTS 3" },
  { slug: "beinsports-4", label: "beIN SPORTS 4" }
];

// Zaman + program hücresi çifti. Aradaki sınırlı `[\s\S]{0,80}?` payı,
// iki `<span>` arasındaki küçük biçim farklarına (boşluk, ek nitelik)
// tolerans tanır ama alakasız uzak içerikle YANLIŞ eşleşmeyi engeller.
const SCHEDULE_ROW_PATTERN =
  /streaming-content_time__[\w-]+">([^<]+)<\/span>[\s\S]{0,80}?streaming-content_program__[\w-]+[^"]*">([^<]+)</g;

/** Tek kanal sayfasından (time, program) çiftleri. */
function extractScheduleRows(html) {
  const rows = [];
  let match;
  SCHEDULE_ROW_PATTERN.lastIndex = 0;
  while ((match = SCHEDULE_ROW_PATTERN.exec(html))) {
    rows.push({ time: decodeEntities(match[1]).trim(), program: decodeEntities(match[2]).trim() });
  }
  return rows;
}

/** Tek bir kanalın bugünkü programından fikstür adayları. */
function candidatesForChannel(html, channel, today) {
  const candidates = [];
  for (const row of extractScheduleRows(html)) {
    const fixture = parseFixtureLine(row.program);
    if (!fixture) continue; // "beIN Süper Lig", "1 Yıldız 10 Gol" gibi program adları, gerçek fikstür DEĞİL.
    if (!/^\d{1,2}:\d{2}$/.test(row.time)) continue;

    candidates.push({
      homeTeam: fixture.home,
      awayTeam: fixture.away,
      date: today,
      time: row.time,
      broadcaster: channel.label,
      platform: null,
      sourceName: SOURCE_NAME,
      sourceUrl: `${BASE_URL}/${channel.slug}`,
      confidence: "official"
    });
  }
  return candidates;
}

async function fetchBeinBroadcastSchedule(options = {}) {
  const { fetchImpl, timeoutMs, now = new Date() } = options;
  const today = istanbulDay(now.toISOString());
  const matches = [];
  const errors = [];

  for (const channel of CHANNELS) {
    try {
      const html = await fetchRaw(`${BASE_URL}/${channel.slug}`, { fetchImpl, timeoutMs });
      matches.push(...candidatesForChannel(html, channel, today));
    } catch (error) {
      // Bir kanal başarısız olursa diğerleri denenmeye devam eder — tek bir
      // sekmenin geçici hatası bütün taramayı düşürmemeli.
      errors.push(`${channel.slug}: ${String((error && error.message) || error)}`);
    }
  }

  // Tüm kanallar başarısız olduysa bu gerçek bir kaynak hatasıdır ve
  // orkestratöre öyle bildirilir; kısmi başarı (bazı kanallar düştü)
  // sessizce elenen adaylarla devam eder.
  if (errors.length === CHANNELS.length) {
    return { ok: false, provider: "bein", sourceName: SOURCE_NAME, sourceUrl: BASE_URL, matches: [], error: errors.join(" | ") };
  }

  return { ok: true, provider: "bein", sourceName: SOURCE_NAME, sourceUrl: BASE_URL, matches, error: errors.length ? errors.join(" | ") : null };
}

module.exports = { candidatesForChannel, extractScheduleRows, fetchBeinBroadcastSchedule, CHANNELS, SOURCE_NAME, SOURCE_URL: BASE_URL };
