/**
 * ANKET OY DEPOSU BAĞLI MI? — TEK KOMUTLUK TEŞHİS.
 *
 * NEDEN VAR: anket kodu eksiksiz ama depo yapılandırılmadığı sürece oy
 * KABUL ETMİYOR (/api/home-poll → storage: "unavailable"). Bu durumda
 * ekranda soru ve takımlar görünüyor, tıklama ise sessizce hiçbir şey
 * yapmıyor — yani "kurdum ama çalışmıyor" ile "kuramadım" dışarıdan aynı
 * görünüyor. Bu betik ikisini ayırır ve NEYİN eksik olduğunu söyler.
 *
 * Deponun kendi mantığı yeniden yazılmadı: değişken adları, anahtar rolü
 * tespiti ve istek katmanı services/homePollVoteStore.js'ten okunuyor.
 * İkinci bir kopya yazmak, kurulumun doğruluğunu asıl koddan farklı bir
 * ölçüte göre sınamak olurdu.
 *
 * KULLANIM (kimlik bilgileri ortamda):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... HOME_POLL_IP_SALT=... \
 *     node scripts/check-home-poll-store.mjs
 *
 * Hiçbir şey YAZMAZ: yalnızca okur. Anket sayımını bozmaz.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("../services/homePollVoteStore.js");
const { listHomePolls } = require("../services/homePoll.js");

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => console.log(`  EKSİK ${m}`);

console.log("Ana sayfa anketi — oy deposu kontrolü\n");

// ── 1. Ortam değişkenleri ──────────────────────────────────────────────
const seen = (names) => names.find((n) => String(process.env[n] || "").trim());

const urlVar = seen(store.REST_URL_ENV_NAMES);
const keyVar = seen(store.SERVICE_KEY_ENV_NAMES);
const saltVar = seen(store.IP_SALT_ENV_NAMES);
const anonVar = seen(store.ANON_KEY_ENV_NAMES);

if (urlVar) ok(`proje adresi: ${urlVar}`);
else bad(`proje adresi yok — şunlardan biri: ${store.REST_URL_ENV_NAMES.join(", ")}`);

if (keyVar) {
  // Anahtarın ROLÜ okunuyor: anon anahtar girmek en sık yapılan hata ve
  // tabloda RLS açık olduğu için her oy sessizce reddedilir.
  const role = store.keyRole(String(process.env[keyVar]).trim());
  if (role === "service_role") ok(`servis anahtarı: ${keyVar} (rol: ${role})`);
  else bad(`${keyVar} servis anahtarı DEĞİL (rol: ${role || "okunamadı"}) — RLS açık, bu anahtarla her oy reddedilir`);
} else if (anonVar) {
  bad(`yalnızca anon anahtar var (${anonVar}); servis rolü anahtarı gerekiyor`);
} else {
  bad(`servis anahtarı yok — şunlardan biri: ${store.SERVICE_KEY_ENV_NAMES.join(", ")}`);
}

if (saltVar) ok(`IP tuzu: ${saltVar}`);
else bad(`IP tuzu yok (${store.IP_SALT_ENV_NAMES.join(", ")}) — çerez ve tarayıcı katmanları çalışır, IP katmanı devre dışı kalır`);

if (!store.isConfigured()) {
  console.log("\nSONUÇ: depo yapılandırılmamış. Anket oy KABUL ETMEZ.");
  console.log(store.configurationHint ? `İpucu: ${store.configurationHint()}` : "");
  process.exit(1);
}

// ── 2. Tabloya gerçekten ulaşılıyor mu ─────────────────────────────────
//
// Değişkenlerin dolu olması yetmez: tablo yoksa ya da anahtar yanlış
// projeye aitse okuma burada patlar. Açık anketin kimliğiyle sorgulanıyor
// ki gerçek kullanım yoluyla aynı olsun.
const polls = listHomePolls();
const active = (polls && (polls.open || polls.current || (polls.polls || [])[0])) || null;
const pollId = (active && active.id) || "kontrol-sorgusu";

try {
  const tally = await store.readTally(pollId);
  ok(`tablo okunabiliyor: ${store.TABLE}`);
  const total = tally && typeof tally === "object"
    ? Object.values(tally).reduce((sum, n) => sum + (Number(n) || 0), 0)
    : 0;
  ok(`anket "${pollId}" için kayıtlı oy: ${total}`);

  // PAYLAŞIM TABLOSU AYRI BİR SESSİZLİK KAYNAĞI. `recordShare` paylaşımı
  // engellememek için hatayı yutuyor; tablo hiç oluşturulmamışsa sayaç
  // sonsuza kadar boş kalır ve kimse fark etmez. Eksikliği OY AKIŞINI
  // bozmadığı için burada uyarı, hata değil.
  try {
    const shares = await store.countShares(pollId);
    ok(`paylaşım tablosu okunabiliyor: ${store.SHARE_TABLE} (${shares} kayıt)`);
  } catch (error) {
    bad(`paylaşım tablosu okunamadı: ${store.SHARE_TABLE} — ${error.message}`);
    console.log("      (oy akışı etkilenmez; yalnızca paylaşım ölçümü toplanmaz)");
  }

  console.log("\nSONUÇ: depo BAĞLI. Anket oy kabul ediyor.");
} catch (error) {
  bad(`tablo okunamadı: ${error.message}`);
  console.log(`\nSONUÇ: değişkenler dolu ama ${store.TABLE} tablosuna ulaşılamıyor.`);
  console.log("Muhtemel sebep: tablo oluşturulmamış ya da anahtar başka projeye ait.");
  console.log("Şema docs/home-poll.md ve services/homePollVoteStore.js başlığında.");
  process.exit(1);
}
