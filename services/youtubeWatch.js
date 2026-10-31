/**
 * İZLERKEN SKOR — elle yönetilen YouTube yayın listesi (data/youtube-watch.json).
 *
 * Kural: yalnızca site sahibinin açıkça eklediği video/canlı yayın kimlikleri
 * kullanılır. Hiçbir yerde YouTube aranmaz, taranmaz ya da otomatik
 * keşfedilmez. Geçersiz kayıtlar sessizce düşer (sayfa üretilmez), böylece
 * yarım bir kayıt sitede boş kutu bırakmaz.
 */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHANNEL_URL_RE = /^https:\/\/(?:www\.)?youtube\.com\/(?:@[A-Za-z0-9._-]+|channel\/UC[A-Za-z0-9_-]{22}|c\/[A-Za-z0-9._-]+|user\/[A-Za-z0-9._-]+)\/?$/;
const SOURCES = new Set(["kulup", "lig", "yayinci", "federasyon"]);

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Bir kaydı doğrular; geçerliyse normalize kaydı, değilse { error } döndürür. */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return { error: "kayıt nesne değil" };
  const entry = {
    slug: str(raw.slug),
    youtubeId: str(raw.youtubeId),
    homeTeam: str(raw.homeTeam),
    awayTeam: str(raw.awayTeam),
    kickoff: str(raw.kickoff),
    providerId: raw.providerId == null || raw.providerId === "" ? null : String(raw.providerId).trim(),
    competition: str(raw.competition) || "Süper Lig",
    channelName: str(raw.channelName),
    channelUrl: str(raw.channelUrl),
    source: str(raw.source),
    kind: str(raw.kind) === "video" ? "video" : "live",
    title: str(raw.title),
    matchPath: str(raw.matchPath) || null
  };
  if (!SLUG_RE.test(entry.slug)) return { error: `geçersiz slug: ${entry.slug || "(boş)"}` };
  if (!YOUTUBE_ID_RE.test(entry.youtubeId)) return { error: `${entry.slug}: geçersiz youtubeId (11 karakter olmalı)` };
  if (!entry.homeTeam || !entry.awayTeam) return { error: `${entry.slug}: homeTeam/awayTeam zorunlu` };
  if (!Number.isFinite(Date.parse(entry.kickoff))) return { error: `${entry.slug}: kickoff ISO tarih olmalı` };
  if (entry.providerId && !/^\d{1,12}$/.test(entry.providerId)) return { error: `${entry.slug}: providerId sayısal olmalı` };
  if (!entry.channelName || !CHANNEL_URL_RE.test(entry.channelUrl)) return { error: `${entry.slug}: resmi kanal adı ve https://www.youtube.com/@kanal adresi zorunlu` };
  if (!SOURCES.has(entry.source)) return { error: `${entry.slug}: source kulup|lig|yayinci|federasyon olmalı` };
  if (entry.matchPath && !/^\/[a-z0-9/_.-]+$/i.test(entry.matchPath)) return { error: `${entry.slug}: matchPath site içi yol olmalı` };
  return { entry };
}

/** Tüm listeyi doğrular. Aynı slug iki kez varsa ilki kalır. */
function loadEntries(store) {
  const list = store && Array.isArray(store.streams) ? store.streams : [];
  const entries = [];
  const errors = [];
  const seen = new Set();
  for (const raw of list) {
    const { entry, error } = normalizeEntry(raw);
    if (error) { errors.push(error); continue; }
    if (seen.has(entry.slug)) { errors.push(`${entry.slug}: yinelenen slug`); continue; }
    seen.add(entry.slug);
    entries.push(entry);
  }
  return { entries, errors };
}

function embedUrl(youtubeId) {
  if (!YOUTUBE_ID_RE.test(String(youtubeId || ""))) throw new Error("invalid youtube id");
  return `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
}

function watchUrl(youtubeId) {
  if (!YOUTUBE_ID_RE.test(String(youtubeId || ""))) throw new Error("invalid youtube id");
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

function thumbnailUrl(youtubeId) {
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

function watchPath(slug) {
  return `/izle/${slug}.html`;
}

module.exports = { YOUTUBE_ID_RE, normalizeEntry, loadEntries, embedUrl, watchUrl, thumbnailUrl, watchPath };
