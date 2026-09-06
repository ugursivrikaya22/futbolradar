/**
 * MAÇ YAYIN BİLGİSİ — okuma/eşleme katmanı.
 *
 * `data/match-broadcasts.json`, scripts/sync-match-broadcasts.mjs'in yazdığı
 * durağan depodur (bu depoda VERİ dosyaları git'e commit'lenen kalıcı
 * kayıttır — bkz. services/providers/mockProvider.js'teki diğer data/*.json
 * dosyalarıyla aynı desen). Bu modül o kaydı `curatedMatches()` çıktısına
 * TEK NOKTADAN ekler; ekleyen tek yer services/providers/mockProvider.js
 * olduğu için kural (ana sayfa, maç kartları, maç dosyası, SEO sayfaları)
 * kendiliğinden her yere yayılır — aynı "YAYIN POLİTİKASI tek noktada
 * uygulanır" ilkesi burada da geçerli.
 *
 * KÜRASYONLU/MANUEL VERİ HER ZAMAN KAZANIR. Maçta zaten bir yayın bilgisi
 * varsa (data/matches.json'da elle girilmiş `broadcast.turkey` ya da admin
 * override) bu katman ASLA üzerine yazmaz — yalnızca BOŞLUĞU doldurur.
 * Otomatik sistemin maçın gerçek yayıncısını bulamadığı durumda alan
 * boş kalır; bir kanal adı asla UYDURULMAZ.
 *
 * EŞLEŞME `services/superLigTeams.js#sameClub` üzerinden yapılır — bu
 * depoda zaten "GALATASARAY A.Ş." / "Galatasaray SK" / "Fenerbahce" gibi
 * yazım farklarını çözen, kelime sınırlı içerme kuralı kullanan aynı
 * fonksiyon (bkz. dosyanın kendi başlığı). Ayrı bir normalizasyon sistemi
 * KURULMADI: aynı sorunun cevabı bu depoda zaten vardı, ikinci bir cevap
 * yalnızca iki kuralın birbirinden sapma riskini eklerdi.
 */

const { sameClub } = require("./superLigTeams.js");

function text(value) {
  const clean = String(value === null || value === undefined ? "" : value).trim();
  return clean || "";
}

function dateOnly(value) {
  return text(value).slice(0, 10);
}

function loadStore() {
  try {
    // eslint-disable-next-line global-require
    const store = require("../data/match-broadcasts.json");
    return Array.isArray(store && store.records) ? store.records : [];
  } catch (error) {
    return [];
  }
}

/**
 * Aynı maç mı? Ev sahibi ters yazılmış olabilir (tarafsız saha, kaynak
 * hatası); services/fixtureCalendar.js#isSameFixture ile aynı kural.
 */
function isSameFixture(match, record) {
  if (!match || !record) return false;
  if (dateOnly(match.kickoff || match.date) !== dateOnly(record.matchDate)) return false;
  const straight = sameClub(match.homeTeam, record.homeTeam) && sameClub(match.awayTeam, record.awayTeam);
  const swapped = sameClub(match.homeTeam, record.awayTeam) && sameClub(match.awayTeam, record.homeTeam);
  return straight || swapped;
}

/** Maça karşılık gelen yayın kaydı — önce kimlik, sonra takım+tarih. */
function findBroadcastRecord(match, records) {
  if (!match) return null;
  const pool = Array.isArray(records) ? records : loadStore();
  if (!pool.length) return null;

  const id = text(match.id);
  const byId = id && pool.find((record) => text(record.fixtureId) === id);
  if (byId) return byId;

  return pool.find((record) => isSameFixture(match, record)) || null;
}

/** Maçta ZATEN elde olan Türkiye yayın kanalı — dize ya da {turkey} biçimi. */
function curatedChannel(match) {
  const broadcast = match && match.broadcast;
  if (!broadcast) return "";
  if (typeof broadcast === "string") return text(broadcast);
  if (typeof broadcast === "object") return text(broadcast.turkey) || text(broadcast.tr) || "";
  return "";
}

/**
 * Maça otomatik bulunan yayın bilgisini işler. Kürasyonlu bir kanal
 * ZATEN varsa dokunulmaz (bkz. dosya başlığı); kayıt yoksa ya da
 * kanal alanı boşsa maç DEĞİŞTİRİLMEDEN döner.
 */
function attachBroadcastInfo(match, records) {
  if (!match || typeof match !== "object") return match;
  if (curatedChannel(match)) return match;

  const record = findBroadcastRecord(match, records);
  const broadcaster = record && text(record.broadcaster);
  if (!broadcaster) return match;

  return {
    ...match,
    broadcast: { ...(typeof match.broadcast === "object" ? match.broadcast : {}), turkey: broadcaster },
    broadcastPlatform: text(record.platform) || null,
    broadcastSource: {
      name: text(record.sourceName) || null,
      url: text(record.sourceUrl) || null,
      confidence: text(record.confidence) || null
    }
  };
}

module.exports = {
  attachBroadcastInfo,
  curatedChannel,
  findBroadcastRecord,
  isSameFixture,
  loadStore
};
