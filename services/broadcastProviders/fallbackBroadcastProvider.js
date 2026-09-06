/**
 * YEDEK SAĞLAYICI — FutbolRadar'ın kendi güvenilir veri kaynakları.
 *
 * Resmî bir kaynaktan (beIN SPORTS, TRT) kanal bulunamadığında son çare:
 * maçın ZATEN taşıdığı `broadcast` alanı (data/matches.json'daki elle
 * doğrulanmış kayıtlar ya da sağlayıcı takviminin taşıdığı TV bilgisi,
 * bkz. services/broadcastSchedule.js#broadcastChannel). Bu sağlayıcı ağa
 * hiç çıkmaz — girdisi zaten bellekteki fikstür listesi olduğu için
 * "kaynak hatası" diye bir durumu yoktur, ama arayüz tutarlılığı için
 * diğer adaptörlerle AYNI `{ ok, matches, error }` biçimini döndürür.
 *
 * `confidence: "derived"` — bu bir resmî yayın programı doğrulaması
 * değil, sitenin başka bir akıştan zaten bildiği bilginin devşirilmesi.
 */

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function existingChannel(match) {
  const broadcast = match && match.broadcast;
  if (!broadcast) return "";
  if (typeof broadcast === "string") return text(broadcast);
  if (typeof broadcast === "object") return text(broadcast.turkey) || text(broadcast.tr) || "";
  return "";
}

/**
 * `fixtures` — orkestratörün zaten topladığı, Türk takımı içeren aday
 * maç listesi (services/providers/mockProvider.js#curatedMatches çıktısı).
 * Ağ çağrısı yapılmadığı için bu fonksiyon eşzamanlı çalışabilir ama
 * diğer sağlayıcılarla aynı async sözleşmeyi korur.
 */
async function fetchFallbackBroadcastSchedule(fixtures = []) {
  const matches = (Array.isArray(fixtures) ? fixtures : [])
    .map((match) => {
      const channel = existingChannel(match);
      if (!channel) return null;
      const date = text(match.kickoff || match.date).slice(0, 10);
      if (!date) return null;
      return {
        homeTeam: text(match.homeTeam),
        awayTeam: text(match.awayTeam),
        date,
        broadcaster: channel,
        platform: null,
        sourceName: "FutbolRadar Doğrulanmış Veri",
        sourceUrl: null,
        confidence: "derived"
      };
    })
    .filter(Boolean);

  return { ok: true, provider: "fallback", sourceName: "FutbolRadar Doğrulanmış Veri", sourceUrl: null, matches, error: null };
}

module.exports = { fetchFallbackBroadcastSchedule };
