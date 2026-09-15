/**
 * ÜYELİK UÇ NOKTALARI — UÇTAN UCA DAVRANIŞ TESTİ.
 *
 * Kapsanan akış, kullanıcının gerçekten yaşadığı sıra:
 *   kayıt → otomatik PRO → favori ekle → favori çıkar → bildirim
 *   tercihi → bildirim okundu → çıkış → yeniden giriş → TERCİHLER
 *   KORUNUYOR MU?
 *
 * Son adım testin asıl sebebi: oturum çerezi ile veri deposu farklı
 * iki katman ve aralarındaki bağ (kullanıcı kimliği) koparsa hiçbir
 * şey hata vermez — kullanıcı yalnızca favorilerini kaybeder.
 *
 * Uzak servis `scripts/lib/supabaseStub.mjs`te taklit ediliyor: test
 * ağa da bir sırra da bağlı değil.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createSupabaseStub, fakeServiceKey } from "./lib/supabaseStub.mjs";

const require = createRequire(import.meta.url);

const stub = createSupabaseStub();
const baseUrl = await stub.listen();

// Ortam, modüller YÜKLENMEDEN ÖNCE kurulmalı: services/supabase/env.js
// değerleri çağrı anında okuyor ama modül önbelleği bir kez dolduktan
// sonra yeni bir taban adresi almak mümkün olmazdı.
process.env.SUPABASE_URL = baseUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = fakeServiceKey("service_role");
process.env.SUPABASE_ANON_KEY = fakeServiceKey("anon");
process.env.MEMBERSHIP_SESSION_SECRET = "test-session-secret-not-a-real-one";
process.env.NODE_ENV = "test";

const handler = require("../api/[...route].js");
const config = require("../services/membership/config.js");

let failures = 0;
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`  FAIL ${name}\n       ${error.message}`);
  }
}

/** Yanıttaki `Set-Cookie` başlığından oturum çerezini çıkarır. */
function cookieFrom(res, jar) {
  const header = res.headers["Set-Cookie"];
  const list = Array.isArray(header) ? header : (header ? [header] : []);
  for (const entry of list) {
    const [pair] = entry.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  return jar;
}

function jarHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function call(method, url, { body, jar, headers } = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(key, value) { this.headers[key] = value; },
    getHeader(key) { return this.headers[key]; },
    end(payload) { this.body = payload || ""; }
  };

  const req = {
    method,
    url,
    headers: {
      host: "www.futbolradar.com",
      "x-forwarded-proto": "https",
      ...(jar && jar.size ? { cookie: jarHeader(jar) } : {}),
      ...(headers || {})
    },
    body
  };

  await handler(req, res);
  if (jar) cookieFrom(res, jar);

  let json = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch (error) {
    json = null;
  }
  return { status: res.statusCode, json, res };
}

const jar = new Map();
const EMAIL = "taraftar@example.com";
const PASSWORD = "futbolradar2026";

// ---------------------------------------------------------------------
// 1. KAYIT → OTOMATİK PRO
// ---------------------------------------------------------------------
const signup = await call("POST", "/api/auth/signup", {
  body: { email: EMAIL, password: PASSWORD, displayName: "Taraftar", locale: "tr" },
  jar
});

check("kayit basarili", () => assert.equal(signup.status, 200));
check("kayit oturum cerezi yaziyor", () => assert.ok(jar.has("fr_session")));
check("yeni uye giris yapmis sayiliyor", () => assert.equal(signup.json.account.signedIn, true));
check("yeni uye otomatik PRO", () => {
  assert.equal(signup.json.account.user.subscriptionType, "pro");
  assert.equal(signup.json.account.user.subscriptionStatus, "active");
  assert.equal(signup.json.account.user.isPro, true);
});
check("uyelik etiketi ucretsiz diyor", () => {
  assert.match(signup.json.account.user.membershipLabel, /Ücretsiz/);
});
check("PRO fiyati sifir ve paywall kapali", () => {
  assert.equal(signup.json.account.pro.price, 0);
  assert.equal(signup.json.account.pro.paywall, false);
});
check("odeme alanlari istemciye sizmiyor", () => {
  const serialized = JSON.stringify(signup.json);
  assert.ok(!serialized.includes("payment_customer_id"));
  assert.ok(!serialized.includes("payment_provider"));
});

// Profil satırı gerçekten yazıldı mı, ödeme alanları hazır mı?
check("profil satiri odeme alanlariyla acildi", () => {
  const row = stub.table("profiles")[0];
  assert.ok(row, "profiles satiri yok");
  assert.equal(row.subscription_type, "pro");
  assert.equal(row.subscription_status, "active");
  assert.ok("payment_provider" in row);
  assert.ok("payment_customer_id" in row);
  assert.equal(row.subscription_expires_at, null);
});
check("bildirim tercihi satiri kayitla birlikte acildi", () => {
  assert.equal(stub.table("user_notification_prefs").length, 1);
});

// Yeniden giriş sonrası karşılaştırmak için: bu değer DEĞİŞMEMELİ.
const signupStartedAt = stub.table("profiles")[0].subscription_started_at;

// ---------------------------------------------------------------------
// 2. AYNI E-POSTA İKİNCİ KEZ
// ---------------------------------------------------------------------
const duplicate = await call("POST", "/api/auth/signup", {
  body: { email: EMAIL, password: PASSWORD }
});
check("ayni e-posta reddediliyor", () => assert.equal(duplicate.status, 400));
check("ayni e-posta dogru hata anahtari donuyor", () => {
  assert.equal(duplicate.json.error.code, "auth.error.emailTaken");
});

// ---------------------------------------------------------------------
// 3. FAVORİLER
// ---------------------------------------------------------------------
const favAdd = await call("POST", "/api/account/favorite", {
  body: { kind: "team", id: "galatasaray", favorited: true },
  jar
});
check("favori takim eklendi", () => {
  assert.equal(favAdd.status, 200);
  assert.equal(favAdd.json.favorited, true);
});
check("favori etiketi kutukten geliyor", () => {
  assert.equal(favAdd.json.favorite.label, "Galatasaray");
});

// İstemcinin gönderdiği sahte etiket YOK SAYILMALI.
const favSpoof = await call("POST", "/api/account/favorite", {
  body: { kind: "team", id: "fenerbahce", label: "<script>alert(1)</script>", favorited: true },
  jar
});
check("istemci etiketi yoksayiliyor", () => {
  assert.equal(favSpoof.json.favorite.label, "Fenerbahçe");
  assert.ok(!JSON.stringify(favSpoof.json).includes("<script>"));
});

const favGhost = await call("POST", "/api/account/favorite", {
  body: { kind: "team", id: "boyle-bir-takim-yok", favorited: true },
  jar
});
check("kutukte olmayan takim reddediliyor", () => {
  assert.equal(favGhost.status, 400);
  assert.equal(favGhost.json.error.code, "account.error.unknownTarget");
});

const favPlayer = await call("POST", "/api/account/favorite", {
  body: { kind: "player", id: "mauro-icardi", favorited: true },
  jar
});
check("favori oyuncu eklendi", () => assert.equal(favPlayer.json.favorited, true));

const favLeague = await call("POST", "/api/account/favorite", {
  body: { kind: "league", id: "la-liga", favorited: true },
  jar
});
check("favori lig eklendi", () => assert.equal(favLeague.json.favorited, true));

const favOff = await call("POST", "/api/account/favorite", {
  body: { kind: "team", id: "fenerbahce", favorited: false },
  jar
});
check("favoriden cikarma calisiyor", () => assert.equal(favOff.json.favorited, false));
check("cikarilan favori listede yok", () => {
  const ids = favOff.json.favorites.team.map((item) => item.id);
  assert.ok(ids.includes("galatasaray"));
  assert.ok(!ids.includes("fenerbahce"));
});

// ---------------------------------------------------------------------
// 4. BİLDİRİM TERCİHLERİ
// ---------------------------------------------------------------------
const prefs = await call("POST", "/api/account/preferences", {
  body: { goal: true, half_time: true, transfer_news: true, red_card: false },
  jar
});
check("bildirim tercihi kaydedildi", () => {
  assert.equal(prefs.status, 200);
  assert.equal(prefs.json.preferences.half_time, true);
  assert.equal(prefs.json.preferences.transfer_news, true);
  assert.equal(prefs.json.preferences.red_card, false);
});

// ---------------------------------------------------------------------
// 5. BİLDİRİM KUTUSU
// ---------------------------------------------------------------------
const profileStore = require("../services/membership/profileStore.js");
const userId = stub.table("profiles")[0].id;
await profileStore.pushNotification({
  userId,
  kind: "goal",
  title: "Galatasaray 1-0 öne geçti",
  href: "/mac/ornek.html",
  subjectKey: "match:1:goal:1"
});
// AYNI OLAY İKİNCİ KEZ: tekilleştirme çalışmalı.
await profileStore.pushNotification({
  userId,
  kind: "goal",
  title: "Galatasaray 1-0 öne geçti",
  href: "/mac/ornek.html",
  subjectKey: "match:1:goal:1"
});

const inbox = await call("GET", "/api/account/notifications", { jar });
check("bildirim kutusu okunuyor", () => assert.equal(inbox.status, 200));
check("ayni olay iki kez yazilmiyor", () => assert.equal(inbox.json.notifications.length, 1));
check("okunmamis sayisi dogru", () => assert.equal(inbox.json.unreadCount, 1));

const markRead = await call("POST", "/api/account/notifications-read", { body: {}, jar });
check("bildirim okundu isaretlendi", () => assert.equal(markRead.json.unreadCount, 0));

// ---------------------------------------------------------------------
// 6. ÇIKIŞ → YENİDEN GİRİŞ → TERCİHLER KORUNUYOR MU?
// ---------------------------------------------------------------------
const logout = await call("POST", "/api/auth/logout", { body: {}, jar });
check("cikis basarili", () => assert.equal(logout.status, 200));
check("cikista oturum cerezi silindi", () => assert.ok(!jar.has("fr_session")));

const anonymous = await call("GET", "/api/account/overview", { jar });
check("cikistan sonra hesap gorunmuyor", () => {
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.json.account.signedIn, false);
  assert.equal(anonymous.json.favorites.team.length, 0);
});

const login = await call("POST", "/api/auth/login", {
  body: { email: EMAIL, password: PASSWORD },
  jar
});
check("yeniden giris basarili", () => assert.equal(login.status, 200));
check("yeniden giriste PRO korunuyor", () => {
  assert.equal(login.json.account.user.isPro, true);
  assert.equal(login.json.account.user.subscriptionType, "pro");
});

const restored = await call("GET", "/api/account/overview", { jar });
check("yeniden giriste favori takim korunuyor", () => {
  assert.deepEqual(restored.json.favorites.team.map((item) => item.id), ["galatasaray"]);
});
check("yeniden giriste favori oyuncu korunuyor", () => {
  assert.deepEqual(restored.json.favorites.player.map((item) => item.id), ["mauro-icardi"]);
});
check("yeniden giriste favori lig korunuyor", () => {
  assert.deepEqual(restored.json.favorites.league.map((item) => item.id), ["la-liga"]);
});
check("yeniden giriste bildirim tercihleri korunuyor", () => {
  assert.equal(restored.json.preferences.half_time, true);
  assert.equal(restored.json.preferences.red_card, false);
});
check("yeniden giriste bildirimler korunuyor", () => {
  assert.equal(restored.json.notifications.length, 1);
});
check("abonelik baslangici yeniden giriste SIFIRLANMIYOR", () => {
  // Ücretli döneme geçişte ödenmiş dönemin başlangıcı her oturum
  // açmada bugüne çekilirse, abonelik süresi sonsuza kadar uzar.
  const row = stub.table("profiles")[0];
  assert.equal(row.subscription_started_at, signupStartedAt);
});

// ---------------------------------------------------------------------
// 7. YANLIŞ ŞİFRE / KİMLİKSİZ YAZMA / CSRF
// ---------------------------------------------------------------------
const badLogin = await call("POST", "/api/auth/login", {
  body: { email: EMAIL, password: "yanlis-sifre" }
});
check("yanlis sifre reddediliyor", () => {
  assert.equal(badLogin.status, 401);
  assert.equal(badLogin.json.error.code, "auth.error.invalidCredentials");
});

const anonWrite = await call("POST", "/api/account/favorite", {
  body: { kind: "team", id: "galatasaray", favorited: true }
});
check("giris yapmadan favori yazilamiyor", () => {
  assert.equal(anonWrite.status, 401);
  assert.equal(anonWrite.json.error.code, "auth.error.signInRequired");
});

const csrf = await call("POST", "/api/account/favorite", {
  body: { kind: "team", id: "galatasaray", favorited: true },
  jar,
  headers: { origin: "https://saldirgan.example" }
});
check("baska kokenden yazma reddediliyor", () => assert.equal(csrf.status, 403));

const shortPassword = await call("POST", "/api/auth/signup", {
  body: { email: "yeni@example.com", password: "kisa" }
});
check("kisa sifre reddediliyor", () => {
  assert.equal(shortPassword.status, 400);
  assert.equal(shortPassword.json.error.code, "auth.error.weakPassword");
});

const badEmail = await call("POST", "/api/auth/signup", {
  body: { email: "gecersiz", password: PASSWORD }
});
check("gecersiz e-posta reddediliyor", () => {
  assert.equal(badEmail.json.error.code, "auth.error.invalidEmail");
});

// ---------------------------------------------------------------------
// 8. YANIT ÖNBELLEĞE ALINMIYOR
// ---------------------------------------------------------------------
check("uyelik yaniti kisiye ozel ve onbelleklenmiyor", () => {
  assert.equal(restored.res.headers["Cache-Control"], "private, no-store");
  assert.equal(restored.res.headers["CDN-Cache-Control"], "private, no-store");
});

// ---------------------------------------------------------------------
// 9. ÜCRETLİ DÖNEME GEÇİŞ — TEK KONFİGÜRASYON DEĞİŞİKLİĞİ
// ---------------------------------------------------------------------
check("paywall kapaliyken giris yapan herkes PRO ozelligi kullanir", () => {
  assert.equal(config.canUseProFeature({ subscriptionType: "free", subscriptionStatus: "expired" }, config.FEATURES.AI_ANALYSIS), true);
  assert.equal(config.canUseProFeature(null, config.FEATURES.AI_ANALYSIS), false);
});

// ---------------------------------------------------------------------
// 10. SİTE İÇİ BİLDİRİM DAĞITIMI
// ---------------------------------------------------------------------
// Canlı skor akışındaki bir gol, o takımı takip eden üyenin zil
// kutusuna düşüyor mu? Ve tercihi kapalı olana DÜŞMÜYOR mu?
const notifier = require("../services/membership/notifier.js");

check("bilinmeyen olay turu bildirime cevrilmiyor", () => {
  assert.equal(notifier.buildNotification({ type: "korner", match: { homeTeam: "A", awayTeam: "B" } }), null);
});

check("skor yoksa uydurma skor yazilmiyor", () => {
  const built = notifier.buildNotification({
    type: "kickoff",
    match: { homeTeam: "A", awayTeam: "B", score: { home: null, away: null }, id: "m9" }
  });
  // `Number(null) === 0` tuzağı: "0-0" yazmak uydurma bir skor olurdu.
  assert.ok(!/0-0/.test(built.body), `uydurma skor: ${built.body}`);
  assert.equal(built.kind, "match_start");
});

check("ayni gol icin tekillestirme anahtari kararli", () => {
  const event = { type: "goal", side: "home", match: { homeTeam: "A", awayTeam: "B", score: { home: 1, away: 0 }, id: "m9" } };
  assert.equal(notifier.buildNotification(event).subjectKey, notifier.buildNotification(event).subjectKey);
});

// Takip eden üye: golü almalı. Kırmızı kartı KAPATMIŞ olduğu için
// (bölüm 4'te `red_card: false` kaydedildi) kırmızı kart gelmemeli.
const goalEvent = {
  type: "goal",
  side: "home",
  match: {
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    homeTeamId: "galatasaray",
    score: { home: 2, away: 1 },
    id: "live-1",
    slug: "gs-fb-test"
  }
};

const beforeGoal = stub.table("user_notifications").length;
await notifier.notifyMatchEvents([goalEvent]);
check("favori takimin golu zil kutusuna dusuyor", () => {
  const rows = stub.table("user_notifications");
  assert.equal(rows.length, beforeGoal + 1, "gol bildirimi yazılmadı");
  assert.match(rows[rows.length - 1].title, /Galatasaray/);
});

const beforeRed = stub.table("user_notifications").length;
await notifier.notifyMatchEvents([{ ...goalEvent, type: "redcard" }]);
check("KAPALI tercih icin bildirim YAZILMIYOR", () => {
  assert.equal(stub.table("user_notifications").length, beforeRed,
    "kırmızı kart tercihi kapalıyken bildirim yazıldı");
});

const beforeStranger = stub.table("user_notifications").length;
await notifier.notifyMatchEvents([{
  type: "goal",
  side: "home",
  match: { homeTeam: "Bahia", awayTeam: "Remo", homeTeamId: "118", score: { home: 1, away: 0 }, id: "live-2" }
}]);
check("takip edilmeyen macin golu kimseye gitmiyor", () => {
  assert.equal(stub.table("user_notifications").length, beforeStranger);
});

await stub.close();

console.log("ÜYELİK API TESTİ");
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} gecti`);

if (failures) {
  console.error(`\n${failures} test BASARISIZ`);
  process.exit(1);
}
