/**
 * YAZAR KAYDI — köşe yazısı yazarının tek tanımı (data/authors.json).
 *
 * Neden: yazar bilgisi yalnızca `author: "Ad"` metniydi; yazar sayfası, Article
 * şemasındaki `author` ve okurun gördüğü yazar kutusu bu metinden türetiliyordu,
 * biyografi ya da profil bağlantısı için yer yoktu.
 *
 * Çözümleme sırası: yazının `authorId` alanı → `author` adı (büyük/küçük
 * harf ve Türkçe karakter farkı gözetmeden, kayıttaki ad ya da `aliases`) →
 * kayıtsız ad. Kayıtsız ad, eski davranışla aynı şekilde ad ve slug'dan
 * türetilen BİYOGRAFİSİZ bir profil döner; FutbolRadar dışındaki kayıtsız ad
 * `Person` sayılır ve `validateAuthorForPublish` yayımlanmasını reddeder:
 * biyografisi olmayan bir kişi yazar olarak gösterilmez.
 *
 * Hiçbir kişi bu dosyada UYDURULMAZ; kayıt yalnızca gerçek yazarlar içindir.
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_AUTHORS_PATH = path.join(__dirname, "..", "data", "authors.json");
// Yalnızca testler için: kayıt dosyası ortam değişkeniyle değiştirilebilir.
const authorsPath = () => process.env.FUTBOLRADAR_AUTHORS_FILE || DEFAULT_AUTHORS_PATH;
const MIN_BIO_LENGTH = 40;
const ORGANIZATION_NAME = "futbolradar";

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function fold(value) {
  return text(value)
    .toLocaleLowerCase("tr")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function slugify(value) {
  return fold(value).replace(/ /g, "-");
}

let cache = null;
let cacheMtime = 0;
let cacheFile = "";

function loadAuthors() {
  try {
    const file = authorsPath();
    const stat = fs.statSync(file);
    if (cache && file === cacheFile && stat.mtimeMs === cacheMtime) return cache;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    cacheFile = file;
    cache = Array.isArray(parsed && parsed.authors) ? parsed.authors : [];
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch (error) {
    return [];
  }
}

function normalizeProfile(record) {
  const name = text(record.name);
  const type = text(record.type) === "Person" ? "Person" : "Organization";
  const slug = text(record.slug) || slugify(name);
  return {
    id: text(record.id) || slug,
    type,
    name,
    slug,
    path: `yazarlar/${slug}.html`,
    jobTitle: text(record.jobTitle),
    bio: text(record.bio),
    sameAs: (Array.isArray(record.sameAs) ? record.sameAs : []).map(text).filter((url) => /^https:\/\//.test(url)),
    registered: true
  };
}

/** Yazının yazarını çözer; kayıtsız ad için biyografisiz profil döner. */
function resolveAuthor(entry, authors = loadAuthors()) {
  const wantedId = text(entry && entry.authorId);
  const name = text(entry && entry.author);
  const folded = fold(name);

  const hit = authors.find((record) => wantedId && text(record.id) === wantedId)
    || authors.find((record) => folded && (fold(record.name) === folded
      || (Array.isArray(record.aliases) && record.aliases.some((alias) => fold(alias) === folded))));
  if (hit) return normalizeProfile(hit);

  const slug = slugify(name);
  return {
    id: slug,
    type: fold(name) === ORGANIZATION_NAME ? "Organization" : "Person",
    name,
    slug,
    path: `yazarlar/${slug}.html`,
    jobTitle: "",
    bio: "",
    sameAs: [],
    registered: false
  };
}

/** Kayıt dosyasının kendi tutarlılığı. Boş dizi = geçerli. */
function validateAuthors(authors = loadAuthors()) {
  const errors = [];
  const ids = new Set();
  const slugs = new Set();
  for (const record of authors) {
    const profile = normalizeProfile(record || {});
    const label = profile.name || profile.id || "(adsız)";
    if (!profile.name) errors.push(`${label}: ad yok`);
    if (ids.has(profile.id)) errors.push(`${label}: kimlik tekrar ediyor (${profile.id})`);
    if (slugs.has(profile.slug)) errors.push(`${label}: slug tekrar ediyor (${profile.slug})`);
    ids.add(profile.id);
    slugs.add(profile.slug);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.slug)) errors.push(`${label}: geçersiz slug (${profile.slug})`);
    if (profile.type === "Person" && profile.bio.length < MIN_BIO_LENGTH) {
      errors.push(`${label}: kişi yazarın biyografisi en az ${MIN_BIO_LENGTH} karakter olmalı`);
    }
    if (Array.isArray(record && record.sameAs) && record.sameAs.some((url) => !/^https:\/\//.test(text(url)))) {
      errors.push(`${label}: sameAs yalnızca https bağlantısı alır`);
    }
  }
  return errors;
}

/**
 * Yayımlanacak yazının yazarı kabul edilebilir mi?
 * Kişi yazar kayıtlı ve biyografili olmalı; kuruluş yazarı (FutbolRadar) için
 * kayıt şart değil.
 */
function validateAuthorForPublish(profile) {
  if (profile.type !== "Person") return { ok: true, reason: "" };
  if (!profile.registered) return { ok: false, reason: `yazar kayıtlı değil (data/authors.json): ${profile.name}` };
  if (profile.bio.length < MIN_BIO_LENGTH) return { ok: false, reason: `yazarın biyografisi eksik: ${profile.name}` };
  return { ok: true, reason: "" };
}

module.exports = {
  DEFAULT_AUTHORS_PATH,
  MIN_BIO_LENGTH,
  loadAuthors,
  resolveAuthor,
  validateAuthorForPublish,
  validateAuthors
};
