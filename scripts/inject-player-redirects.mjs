#!/usr/bin/env node
/**
 * OYUNCU ADRES YÖNLENDİRMELERİ — `vercel.json`.
 *
 * Tam isimli adrese taşınan her oyuncu için eski adres KALICI (301) olarak
 * yeni adrese gider. HTML içindeki `meta refresh` ikinci savunma hattı;
 * arama motoruna "bu sayfa taşındı" diyen asıl sinyal 301'dir ve bağlantı
 * değerini taşıyan da odur.
 *
 * Üç kural:
 *
 *   • TEK ATLAMA. Kopya kayıtlar doğrudan kanonik adrese gider, önce
 *     kanonik kaydın eski adresine değil: zincirleme yönlendirme hem yavaş
 *     hem de her halkada değer kaybettirir.
 *   • TEMİZ ADRES. `/futbolcu/<slug>` uzantısız çalışır (rewrite) ve
 *     `.html` uzantılı hâli uzantısıza yönlendirilir — aynı sayfa iki
 *     adresten yayımlanmaz.
 *   • ÜRETİLMİŞ BLOK YENİDEN YAZILIR. Bu script her koşuda `/oyuncular/`
 *     ve `/futbolcu/` kaynaklı kuralların HEPSİNİ atıp yeniden kurar;
 *     böylece silinen bir oyuncunun yönlendirmesi geride kalmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const { createPlayerUrlResolver, CANONICAL_DIR, LEGACY_DIR } = require("../services/playerUrl.js");

const CONFIG = path.join(root, "vercel.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const table = readJson(path.join(root, "data", "player-url-slugs.json"), { entries: [], aliases: [] });
const resolver = createPlayerUrlResolver(table);
const config = readJson(CONFIG, null);

if (!config) {
  console.error("[player-redirects] vercel.json okunamadı.");
  process.exit(1);
}

const moved = resolver.movedPaths();

/**
 * Bu script tarafından yönetilen kurallar — her koşuda yeniden kurulur.
 *
 * ÖLÇÜT KAYNAĞIN KENDİSİ, HEDEFİ DEĞİL. Önce "hedefi /futbolcu/ olan her
 * kural benimdir" denmişti; ama aşağıdaki yeniden hedefleme, elle yazılmış
 * kuralların da hedefini /futbolcu/ yapıyor ve onlar bir sonraki koşuda
 * "benim" sanılıp siliniyordu (yazım hatası yönlendirmeleri böyle kayboldu).
 * Üretilmiş kural, taşınan bir oyuncunun ESKİ YOLUNDAN çıkan kuraldır;
 * kaynak listesi burada kesin olarak biliniyor.
 */
const managedSources = new Set([
  `/${CANONICAL_DIR}/:slug.html`,
  ...moved.map((entry) => `/${entry.from}`)
]);

function isManagedRedirect(rule) {
  return managedSources.has(String((rule && rule.source) || ""));
}

function isManagedRewrite(rule) {
  return String((rule && rule.source) || "").startsWith(`/${CANONICAL_DIR}/`);
}

const redirects = [
  // Uzantılı hâl uzantısıza — kanonik adres tek.
  { source: `/${CANONICAL_DIR}/:slug.html`, destination: `/${CANONICAL_DIR}/:slug`, permanent: true },
  // Taşınan her oyuncu: eski adres → yeni adres, tek atlamada.
  //
  // YALNIZCA `.html` KAYNAĞI. Uzantısız eski adres (`/oyuncular/<id>`)
  // ayrıca yazılmıyor: Vercel bir dağıtımda en fazla 1024 yönlendirme
  // kabul ediyor ve iki varyant yazmak, kadro büyüdükçe o tavana
  // dayanıyordu (bu koşuda 1022). İndekslenmiş ve site haritasında duran
  // biçim `.html` olan; uzantısız hâl mevcut `/oyuncular/:slug` rewrite'ı
  // üzerinden aynı dosyaya düşüyor ve o dosya da canonical + yönlendirme
  // taşıyor. Yani iki biçim de doğru sayfada bitiyor, tavan da zorlanmıyor.
  ...moved.map((entry) => ({
    source: `/${entry.from}`,
    destination: `/${CANONICAL_DIR}/${entry.slug}`,
    permanent: true
  }))
];

const rewrites = [
  { source: `/${CANONICAL_DIR}/:slug`, destination: `/${CANONICAL_DIR}/:slug.html` }
];

/**
 * KORUNAN KURALLARIN HEDEFİ DE TAŞINIR.
 *
 * Elle yazılmış eski yazım-hatası yönlendirmeleri vardı ve hedefleri
 * `/oyuncular/<id>.html` idi (ör. `/oyuncular/edina-dzeko` →
 * `/oyuncular/edin-dzeko.html`). O hedef artık kendisi yönlendiriyor, yani
 * kural olduğu gibi bırakılsa iki atlamalı bir zincir oluşuyordu. Hedef
 * taşındıysa kural doğrudan yeni adrese bağlanır: tek atlama.
 */
function slugOf(id) {
  return resolver.playerPagePath(id).replace(/^.*\//, "").replace(/\.html$/, "");
}

function retargetLegacyDestination(rule) {
  const destination = String((rule && rule.destination) || "");

  const legacy = /^\/oyuncular\/([a-z0-9-]+)(?:\.html)?$/.exec(destination);
  if (legacy && resolver.hasCanonicalSlug(legacy[1])) {
    return { ...rule, destination: `/${CANONICAL_DIR}/${slugOf(legacy[1])}` };
  }

  // İNGİLİZCE TARAF DA TAŞINDI. `/en/player/<id>.html` adresleri artık
  // `/en/player/<tam-ad>.html`; elle yazılmış yazım-hatası yönlendirmeleri
  // eski hedefte kalınca var olmayan bir dosyayı gösteriyordu.
  const english = /^\/en\/player\/([a-z0-9-]+)(?:\.html)?$/.exec(destination);
  if (english && resolver.hasCanonicalSlug(english[1])) {
    return { ...rule, destination: `/en/player/${slugOf(english[1])}.html` };
  }

  return rule;
}

/**
 * HEDEFİ OLMAYAN YÖNLENDİRME YAYIMLANMAZ.
 *
 * Elle yazılmış yazım-hatası kurallarının bir kısmı, o gün üretilen ama
 * bugün üretilmeyen sayfalara işaret ediyor (ör. artık yayın kapısından
 * geçmeyen bir oyuncunun İngilizce sayfası). Böyle bir kural kullanıcıyı
 * 404'e yönlendirir — yönlendirmenin hiç olmamasından kötüdür, çünkü
 * hatanın nereden geldiğini de gizler.
 *
 * Yalnızca YEREL, parametresiz hedefler denetlenir; dış adresler ve
 * `:slug` kalıpları dosya sistemine karşılık gelmiyor.
 */
function hasLocalTarget(rule) {
  const destination = String((rule && rule.destination) || "");
  if (!destination.startsWith("/") || destination.includes(":") || destination.startsWith("//")) return true;

  const relative = destination.replace(/^\/+/, "");
  if (!relative) return true;

  return fs.existsSync(path.join(root, relative))
    || fs.existsSync(path.join(root, `${relative}.html`));
}

const dropped = [];
const preserved = (config.redirects || [])
  .filter((rule) => !isManagedRedirect(rule))
  .map(retargetLegacyDestination)
  .filter((rule) => {
    if (hasLocalTarget(rule)) return true;
    dropped.push(`${rule.source} → ${rule.destination}`);
    return false;
  });

for (const entry of dropped) {
  console.warn(`[player-redirects] hedefi olmayan yönlendirme kaldırıldı: ${entry}`);
}

config.redirects = redirects.concat(preserved);
config.rewrites = rewrites.concat((config.rewrites || []).filter((rule) => !isManagedRewrite(rule)));

fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`, "utf8");

// Tavana yaklaşmak sessiz bir hata olmasın: kural sayısı bildirilir ve
// sınır aşılırsa derleme durur.
const REDIRECT_LIMIT = 1024;
if (config.redirects.length > REDIRECT_LIMIT) {
  console.error(`[player-redirects] ${config.redirects.length} yönlendirme, Vercel sınırı ${REDIRECT_LIMIT} aşıldı.`);
  process.exit(1);
}

console.log(`[player-redirects] ${moved.length} taşınan adres için ${redirects.length} kalıcı yönlendirme ` +
  `ve ${rewrites.length} temiz adres kuralı yazıldı (toplam ${config.redirects.length}/${REDIRECT_LIMIT}).`);
