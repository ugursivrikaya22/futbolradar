/**
 * FAVORİ KÜTÜĞÜ — SUNUCU İSTEMCİNİN GÖNDERDİĞİ KİMLİĞE GÜVENMEZ.
 *
 * `server/pushSubscriptionRoute.js`teki kuralın aynısı, dört türe
 * genişletilmiş hâli: bir favori ancak GERÇEKTEN VAR OLAN bir takım,
 * oyuncu, lig ya da maça işaret ediyorsa kaydedilir.
 *
 * Denetimsiz bırakılsaydı sonuç sessiz olurdu: tablo hiçbir sayfaya
 * karşılık gelmeyen kimliklerle dolar, profil sayfası boş satırlar
 * çizer ve bildirim dağıtımı hiçbir aboneye ulaşmayan kayıtları
 * tarardı. Hiçbiri hata vermez; hepsi yanlıştır.
 *
 * ETİKET DE BURADAN GELİR. İstemci "Galatasaray" diye bir etiket
 * gönderebilir ama kaydedilen ad KÜTÜKTEN okunur — aksi hâlde profil
 * sayfasındaki adlar, istemcinin yazdığı serbest metin olurdu.
 *
 * Kütükler `require` ile okunuyor ve Node modül önbelleğinde kalıyor:
 * sunucusuz işlev sıcakken dosya ikinci kez okunmuyor.
 */

const FAVORITE_KINDS = Object.freeze(["team", "player", "league", "match"]);

/** Kimlik biçimi: kütükte aranmadan ÖNCE bariz çöp elenir. */
const REF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;

function safeRequire(relativePath, fallback) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(relativePath);
  } catch (error) {
    return fallback;
  }
}

let teamIndex = null;
let playerIndex = null;
let leagueIndex = null;
let matchIndex = null;

/**
 * TAKIMLAR — hem Süper Lig kütüğü hem puan durumu tabloları.
 *
 * `data/teams.json` yalnızca 18 Süper Lig takımını taşıyor. Bir
 * okuyucunun Real Madrid'i takip edememesi için hiçbir sebep yok:
 * puan durumu tablolarındaki takımlar da (sağlayıcı kimlikleriyle)
 * kütüğe katılıyor.
 */
function buildTeamIndex() {
  if (teamIndex) return teamIndex;
  const index = new Map();

  for (const team of safeRequire("../../data/teams.json", [])) {
    const id = String((team && team.id) || "");
    if (id) index.set(id, { id, label: String(team.name || id), league: String(team.league || "") });
  }

  const standings = safeRequire("../../data/league-standings.json", {});
  for (const [leagueId, payload] of Object.entries(standings || {})) {
    const table = (payload && Array.isArray(payload.table)) ? payload.table : [];
    for (const row of table) {
      const id = String((row && (row.id || row.providerId)) || "");
      const label = String((row && (row.team || row.name)) || "");
      // Süper Lig takımı zaten slug kimliğiyle kütükte; sağlayıcı
      // kimliğiyle İKİNCİ bir kayıt açmak aynı takımı iki favori
      // yapardı.
      if (!id || !label || index.has(id)) continue;
      index.set(id, { id, label, league: String((payload && payload.league) || leagueId) });
    }
  }

  teamIndex = index;
  return index;
}

function buildPlayerIndex() {
  if (playerIndex) return playerIndex;
  const index = new Map();
  for (const player of safeRequire("../../data/players.json", [])) {
    const id = String((player && player.id) || "");
    if (!id) continue;
    index.set(id, {
      id,
      label: String(player.name || id),
      team: String(player.team || ""),
      slug: String(player.slug || id)
    });
  }
  playerIndex = index;
  return index;
}

function buildLeagueIndex() {
  if (leagueIndex) return leagueIndex;
  const index = new Map();

  for (const competition of safeRequire("../../data/competitions.json", [])) {
    const id = String((competition && competition.id) || "");
    if (id) index.set(id, { id, label: String(competition.name || id), country: String(competition.country || "") });
  }

  const standings = safeRequire("../../data/league-standings.json", {});
  for (const [leagueId, payload] of Object.entries(standings || {})) {
    const id = String(leagueId || "");
    if (!id || index.has(id)) continue;
    index.set(id, { id, label: String((payload && payload.league) || id), country: "" });
  }

  leagueIndex = index;
  return index;
}

/**
 * MAÇLAR — yalnızca sicilde sayfası olan maçlar.
 *
 * Favori maç, profil sayfasında bir BAĞLANTI olacak; sayfası olmayan
 * bir maçı favorilemek, tıklanınca 404 veren bir satır üretirdi.
 * Hem slug hem sağlayıcı kimliği anahtar olarak kabul edilir.
 */
function buildMatchIndex() {
  if (matchIndex) return matchIndex;
  const index = new Map();

  const registry = safeRequire("../../data/match-seo-pages.json", null);
  const pages = (registry && Array.isArray(registry.pages)) ? registry.pages
    : (Array.isArray(registry) ? registry : []);

  for (const page of pages) {
    if (!page) continue;
    const slug = String(page.slug || "");
    const enSlug = String(page.enSlug || "");
    const providerId = String((page.providerIds && page.providerIds.apiFootball) || "");
    const home = String(page.homeTeam || "");
    const away = String(page.awayTeam || "");
    // Etiket takım adlarından kurulur, slug'dan DEĞİL: profil
    // sayfasında "fenerbahce-gornik-zabrze-21-temmuz-2026" değil
    // "Fenerbahçe - Górnik Zabrze" yazmalı.
    const label = home && away ? `${home} - ${away}` : slug;
    const record = {
      id: slug || providerId,
      label,
      path: slug ? `mac/${slug}.html` : "",
      // İngilizce sayfa her maç için üretilmiyor; yoksa boş kalır ve
      // İngilizce yüzey Türkçe sayfaya değil, hiçbir yere bağlamaz.
      enPath: enSlug ? `en/match/${enSlug}.html` : "",
      slug,
      providerId,
      homeTeam: home,
      awayTeam: away,
      kickoff: page.kickoff || null,
      league: String(page.league || ""),
      status: String(page.status || "")
    };
    if (!record.id) continue;
    if (slug) index.set(slug, record);
    if (providerId && !index.has(providerId)) index.set(providerId, record);
  }

  matchIndex = index;
  return index;
}

/** Testler ve uzun ömürlü süreçler kütükleri tazeleyebilsin. */
function resetCatalogCache() {
  teamIndex = null;
  playerIndex = null;
  leagueIndex = null;
  matchIndex = null;
}

function indexFor(kind) {
  if (kind === "team") return buildTeamIndex();
  if (kind === "player") return buildPlayerIndex();
  if (kind === "league") return buildLeagueIndex();
  if (kind === "match") return buildMatchIndex();
  return null;
}

/**
 * FAVORİYİ ÇÖZ.
 *
 * `null` dönerse favori KAYDEDİLMEZ. Kütük hiç yüklenememişse
 * (veri dosyası bozuk, derleme yarım) `null` döner — bilinmeyen bir
 * kimliği "herhâlde doğrudur" diye kabul etmek, bu modülün var olma
 * sebebini ortadan kaldırırdı.
 */
function resolveFavorite(kind, refId) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (!FAVORITE_KINDS.includes(normalizedKind)) return null;

  const id = String(refId || "").trim();
  if (!REF_ID_PATTERN.test(id)) return null;

  const index = indexFor(normalizedKind);
  const record = index && index.get(id);
  if (!record) return null;

  return {
    kind: normalizedKind,
    id: record.id,
    // ETİKET KÜTÜKTEN. İstemcinin gönderdiği ad hiç okunmaz.
    label: record.label,
    meta: record
  };
}

/** Favori satırını ekranda çizmek için gereken her şey. */
function decorateFavorite(favorite) {
  const resolved = resolveFavorite(favorite.kind, favorite.id);
  return {
    kind: favorite.kind,
    id: favorite.id,
    // Kütükten düşmüş bir kayıt (sezon değişti, oyuncu ayrıldı):
    // saklanmış etiket son çare olarak kullanılır, satır KAYBOLMAZ.
    label: (resolved && resolved.label) || favorite.label || favorite.id,
    href: favoriteHref(favorite.kind, favorite.id, resolved),
    stale: !resolved,
    createdAt: favorite.createdAt || null
  };
}

/**
 * Favorinin sayfa adresi. Köke göre GÖRELİ DEĞİL, mutlak yol:
 * profil sayfası ve zil menüsü farklı derinliklerden çiziliyor.
 */
function favoriteHref(kind, id, resolved) {
  if (kind === "match") {
    const path = resolved && resolved.meta && resolved.meta.path;
    return path ? `/${String(path).replace(/^\/+/, "")}` : "";
  }
  if (kind === "player") {
    const slug = (resolved && resolved.meta && resolved.meta.slug) || id;
    return `/futbolcu/${encodeURIComponent(slug)}`;
  }
  if (kind === "team") {
    return `/takimlar.html#${encodeURIComponent(id)}`;
  }
  if (kind === "league") {
    return `/puan-durumu.html#${encodeURIComponent(id)}`;
  }
  return "";
}

module.exports = {
  FAVORITE_KINDS,
  REF_ID_PATTERN,
  buildLeagueIndex,
  buildMatchIndex,
  buildPlayerIndex,
  buildTeamIndex,
  decorateFavorite,
  favoriteHref,
  resetCatalogCache,
  resolveFavorite
};
