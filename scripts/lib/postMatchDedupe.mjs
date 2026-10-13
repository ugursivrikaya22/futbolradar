/**
 * SAĞLAYICI KOPYASI AYIKLAYICI (maç sonu sayfaları).
 *
 * API-Football bazen aynı oynanmış maçı iki ayrı fikstür kimliğiyle verir:
 * Chile W–Bolivia W'de 1644444 (aslında 13 Ekim'de oynanacak ikinci
 * hazırlık maçı) 1644445'in tarihini, saatini ve 7-0 skorunu aynen aldı.
 * İki kayıt da "bitmiş" göründüğü için iki rapor üretiliyor ve yinelenen
 * başlık koruması haklı olarak koşuyu durduruyordu.
 *
 * Aynı ev/deplasman, aynı skor ve en fazla 72 saat arayla başlayan, FARKLI
 * sağlayıcı kimlikli bitmiş kayıtlar TEK maç sayılır (sağlayıcı kopyası;
 * kopya, kendi tarihini değiştirmiş olabilir). Kalan kayıt: en erken başlayan
 * ve kimliğindeki tarih TSİ başlama günüyle örtüşen; yoksa en erken başlayan.
 * Bedeli güvenli yönde: aynı skorla 72 saat içinde tekrar oynanan gerçek bir
 * maç raporsuz kalır, ama uydurma skorlu bir rapor asla yayınlanmaz.
 * Ayrıca başlama saati henüz gelmemiş "bitmiş" kayıt (sağlayıcı hatası)
 * rapor almaz.
 * Koruma gevşetilmez: gerçekten farklı iki maç (farklı saat ya da skor)
 * bu süzgeçten geçer ve başlık çakışırsa yine hata verir.
 */
function istanbulDay(iso) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function scoreKey(match) {
  const score = match && match.score || {};
  const home = score.home ?? match.homeScore;
  const away = score.away ?? match.awayScore;
  return home === null || home === undefined || away === null || away === undefined ? null : `${home}-${away}`;
}

function providerIdOf(match) {
  return String((match && match.providerIds && match.providerIds.apiFootball) || (match && match.providerId) || "");
}

const WINDOW_MS = 72 * 60 * 60 * 1000;

function teamKey(match, side) {
  const id = match && match[`${side}TeamId`];
  if (id) return `id:${id}`;
  return String(match && match[`${side}Team`] || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();
}

export function dropProviderDuplicates(matches, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const list = Array.isArray(matches) ? matches : [];
  const dropped = [];
  const futureFinished = new Set();
  list.forEach((match, index) => {
    const ms = Date.parse(match && match.kickoff || "");
    if (Number.isFinite(ms) && ms > nowMs) {
      futureFinished.add(index);
      dropped.push({ id: match.id, providerId: providerIdOf(match), keptId: null, reason: "future-kickoff" });
    }
  });
  const candidates = list.map((match, index) => ({ match, index, ms: Date.parse(match && match.kickoff || ""), score: scoreKey(match) }))
    .filter((item) => !futureFinished.has(item.index) && item.score && Number.isFinite(item.ms))
    .sort((left, right) => left.ms - right.ms);
  const drop = new Set(futureFinished);
  const handled = new Set();
  for (const item of candidates) {
    if (handled.has(item.index)) continue;
    const group = candidates.filter((other) => !handled.has(other.index)
      && other.score === item.score
      && teamKey(other.match, "home") === teamKey(item.match, "home")
      && teamKey(other.match, "away") === teamKey(item.match, "away")
      && Math.abs(other.ms - item.ms) <= WINDOW_MS);
    group.forEach((other) => handled.add(other.index));
    if (new Set(group.map((other) => providerIdOf(other.match))).size < 2) continue;
    const earliest = group[0].ms;
    const day = istanbulDay(group[0].match.kickoff);
    const keep = group.find((other) => other.ms === earliest && String(other.match.id || "").endsWith(day)) || group[0];
    for (const other of group) {
      if (other.index === keep.index || providerIdOf(other.match) === providerIdOf(keep.match)) continue;
      drop.add(other.index);
      dropped.push({ id: other.match.id, providerId: providerIdOf(other.match), keptId: keep.match.id, reason: "provider-duplicate" });
    }
  }
  return { matches: list.filter((_, index) => !drop.has(index)), dropped };
}
