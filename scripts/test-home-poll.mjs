#!/usr/bin/env node
/**
 * ANA SAYFA TAHMİN ANKETİ — SÖZLEŞME DENETİMİ.
 *
 * Anket bir TAHMİN topluyor ama seçenek listesi yine bir VERİ İDDİASIDIR:
 * "Trendyol Süper Lig kulüpleri" başlığı altında bastığımız her ad, o
 * kulübün gerçekten bu sezon o ligde olduğunu söyler. Testler üç yönden
 * sıkıştırıyor:
 *
 *   • TAKVİM — yanlış zamanda yanlış anket açılabilir mi? Aynı anda iki
 *     anket görünebilir mi? İki haftadan kısa pencere yayına girebilir mi?
 *   • SAYIM — istemci ne gönderirse göndersin depoya geçersiz bir şey
 *     yazılabilir mi? Kapanmış ankete oy girebilir mi? Aynı kişi iki kez
 *     sayılabilir mi?
 *   • İKİ DİL — Türkçe ve İngilizce sürüm birebir aynı yapıyı taşıyor mu?
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  COPY,
  MIN_WINDOW_MS,
  findPoll,
  listHomePolls,
  localized,
  localizePoll,
  matchOutcomeOptions,
  scheduleFrom,
  selectHomePoll,
  selectMatchPoll,
  shareUrlFor,
  superLigOptions,
  validatePoll
} = require("../services/homePoll.js");

const DAY_MS = 24 * 60 * 60 * 1000;
const teams = require(path.join(root, "data", "teams.json"));

/** Geçerli bir anket kaydı; testler yalnızca değiştirdikleri alanı verir. */
function poll(overrides = {}) {
  return {
    id: "test-anketi",
    type: "champion",
    startsAt: "2026-08-01T00:00:00+03:00",
    endsAt: "2026-09-01T00:00:00+03:00",
    optionSource: "super-lig-teams",
    question: { tr: "Şampiyon kim olacak?", en: "Who will be champion?" },
    subtitle: { tr: "Okuyucu tahmini.", en: "A reader prediction." },
    ...overrides
  };
}

console.log("home-poll");

// ── 1. SÜPER LİG SEÇENEKLERİ VERİDEN GELİR, ELLE YAZILMAZ ─────────────────
//
// Lig kadrosu değiştiğinde (küme düşme/çıkma) anketin kendiliğinden doğru
// olması gerekir; elle yazılan liste bir sezon sonra sessizce yanlış olurdu.
{
  const options = superLigOptions(teams);
  const current = (Array.isArray(teams) ? teams : teams.teams).filter((team) => team.isCurrentSuperLigTeam);
  assert.equal(options.length, current.length, "güncel Süper Lig kulüplerinin hepsi seçenek olmalı");
  assert.ok(options.length >= 18, `lig kadrosu beklenenden küçük: ${options.length}`);

  // Arma yalnızca GERÇEK sağlayıcı kimliğinden türetilir.
  for (const option of options) {
    if (!option.logo) continue;
    assert.match(option.logo, /^https:\/\/media\.api-sports\.io\/football\/teams\/\d+\.png$/,
      `${option.team}: arma yalnızca lisanslı kaynaktan ve rakam kimlikten türetilmeli`);
  }
  // Armasız kulüp listeden DÜŞMEZ: baş harfleriyle görünür.
  for (const option of options) {
    assert.ok(option.initials, `${option.team}: yer tutucu baş harf taşımalı`);
  }

  // Yer tutucu kimlikten adres üretilmez (yanlış kulübün arması riski).
  const fake = superLigOptions([{ name: "Sahte Kulüp", isCurrentSuperLigTeam: true, providerId: "mock-9" }]);
  assert.equal(fake[0].logo, "", "yer tutucu kimlikten arma türetilmemeli");
}

// ── 2. PENCERE EN AZ İKİ HAFTA ────────────────────────────────────────────
//
// Ana sayfadaki büyük bir anket birkaç günde kapanırsa okuyucuların çoğu
// onu hiç görmeden sonucu kaçırır; ayrıca kısa pencere, az sayıda oyla
// "topluluk kararı" iddia etmek demektir.
{
  const short = validatePoll(poll({ endsAt: "2026-08-08T00:00:00+03:00" }), { teams });
  assert.equal(short.valid, false, "bir haftalık pencere yayına girmemeli");
  assert.match(short.errors.join(" "), /en az 14 gün/);

  // Tam sınır geçerli.
  const exact = validatePoll(poll({
    startsAt: "2026-08-01T00:00:00+03:00",
    endsAt: new Date(Date.parse("2026-08-01T00:00:00+03:00") + MIN_WINDOW_MS).toISOString()
  }), { teams });
  assert.equal(exact.valid, true, "tam 14 günlük pencere geçerli olmalı");

  // Ters ve bozuk tarihler.
  assert.equal(validatePoll(poll({ endsAt: "2026-07-01T00:00:00+03:00" }), { teams }).valid, false);
  assert.equal(validatePoll(poll({ startsAt: "gecersiz" }), { teams }).valid, false);
}

// ── 3. Eksik alan ve yetersiz seçenek elenir ──────────────────────────────
{
  assert.equal(validatePoll(poll({ id: "" }), { teams }).valid, false);
  assert.equal(validatePoll(poll({ question: { tr: "Yalnız Türkçe" } }), { teams }).valid, false,
    "iki dil de zorunlu — sürümler ayrışmamalı");

  // Elle seçenekli ankette iki seçenekten az kabul edilmez.
  const single = validatePoll(poll({
    optionSource: null,
    options: [{ id: "tek", label: { tr: "Tek", en: "One" } }]
  }), { teams });
  assert.equal(single.valid, false, "tek seçenekli oylama oylama değildir");

  // Yinelenen kimlik: oylar birbirine karışırdı.
  const duplicate = validatePoll(poll({
    optionSource: null,
    options: [
      { id: "ayni", label: { tr: "A", en: "A" } },
      { id: "ayni", label: { tr: "B", en: "B" } }
    ]
  }), { teams });
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join(" "), /benzersiz/);
}

// ── 4. TAKVİM: aynı anda tek anket, çakışan eleniyor ──────────────────────
{
  const { polls, rejected } = scheduleFrom({
    teams,
    polls: [
      poll({ id: "birinci", startsAt: "2026-08-01T00:00:00+03:00", endsAt: "2026-09-01T00:00:00+03:00" }),
      // Penceresi birinciyle kesişiyor: elenmeli.
      poll({ id: "cakisan", startsAt: "2026-08-20T00:00:00+03:00", endsAt: "2026-09-20T00:00:00+03:00" }),
      poll({ id: "ikinci", startsAt: "2026-09-01T00:00:00+03:00", endsAt: "2026-10-01T00:00:00+03:00" })
    ]
  });

  assert.deepEqual(polls.map((entry) => entry.id), ["birinci", "ikinci"]);
  assert.ok(rejected.some((row) => row.id === "cakisan"), "çakışan anket elenmeli");
  assert.match(rejected.find((row) => row.id === "cakisan").errors.join(" "), /çakışıyor/);
}

// ── 5. KAPANAN ANKET YOK OLMAZ, SONUÇLARI KALIR — SONRAKİ OTOMATİK AÇILIR ─
{
  const sources = {
    teams,
    polls: [
      poll({ id: "birinci", startsAt: "2026-08-01T00:00:00+03:00", endsAt: "2026-09-01T00:00:00+03:00" }),
      poll({ id: "ikinci", startsAt: "2026-09-10T00:00:00+03:00", endsAt: "2026-10-10T00:00:00+03:00" })
    ]
  };

  // Pencere içinde: açık.
  const during = selectHomePoll(sources, { now: Date.parse("2026-08-15T00:00:00+03:00") });
  assert.equal(during.status, "open");
  assert.equal(during.poll.id, "birinci");
  assert.equal(during.next.id, "ikinci", "sıradaki anket bildirilmeli");

  // İki anket ARASINDA: birincinin sonuçları durmaya devam eder.
  const between = selectHomePoll(sources, { now: Date.parse("2026-09-05T00:00:00+03:00") });
  assert.equal(between.status, "closed");
  assert.equal(between.poll.id, "birinci", "kapanan anketin sonuçları kalmalı");

  // İkincinin saati geldi: elle müdahale olmadan o açılır.
  const next = selectHomePoll(sources, { now: Date.parse("2026-09-15T00:00:00+03:00") });
  assert.equal(next.status, "open");
  assert.equal(next.poll.id, "ikinci");

  // Hepsi bittiğinde son kapanan gösterilir.
  const after = selectHomePoll(sources, { now: Date.parse("2027-01-01T00:00:00+03:00") });
  assert.equal(after.status, "closed");
  assert.equal(after.poll.id, "ikinci");

  // Hiç anket yoksa bölüm çizilmez.
  assert.equal(selectHomePoll({ teams, polls: [] }, { now: Date.now() }).poll, null);
  // İlk anket henüz başlamadıysa da çizilmez.
  const early = selectHomePoll(sources, { now: Date.parse("2026-07-01T00:00:00+03:00") });
  assert.equal(early.poll, null);
  assert.equal(early.status, "none");
}

// ── 6. İKİ DİL, TEK ANKET ─────────────────────────────────────────────────
{
  const { poll: record } = validatePoll(poll(), { teams });
  const tr = localizePoll(record, "tr");
  const en = localizePoll(record, "en");

  assert.equal(tr.question, "Şampiyon kim olacak?");
  assert.equal(en.question, "Who will be champion?");
  // Seçenek KÜMESİ ve SIRASI aynı: iki sürüm aynı ankettir, yalnızca dil değişir.
  assert.deepEqual(tr.options.map((option) => option.id), en.options.map((option) => option.id));
  assert.equal(tr.id, en.id);
  // Bilinmeyen dil Türkçeye düşer, boş sayfa üretmez.
  assert.equal(localizePoll(record, "de").question, tr.question);
}

// ── 7. Yayındaki takvim dosyası geçerli ───────────────────────────────────
//
// `data/home-polls.json` elle düzenleniyor; bozuk bir kayıt sessizce
// elenirse ana sayfada anket kaybolur ve kimse fark etmez.
{
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "home-polls.json"), "utf8"));
  const { polls, rejected } = scheduleFrom({ polls: payload, teams });

  assert.equal(rejected.length, 0,
    `yayındaki anketlerde geçersiz kayıt var: ${rejected.map((row) => `${row.id} (${row.errors.join("; ")})`).join(", ")}`);
  assert.ok(polls.length >= 1, "takvimde en az bir anket olmalı");

  // Örnek kayıt YAYINA ÇIKMAZ: ayrım anahtarda (`_sample`), bir bayrakta değil.
  assert.ok(!polls.some((entry) => /ornek|sample/i.test(entry.id)), "örnek kayıt yayına çıkmış");

  // İstenen şampiyonluk anketi gerçekten yayında ve tüm kulüpleri taşıyor.
  const champion = polls.find((entry) => entry.type === "champion");
  assert.ok(champion, "şampiyonluk anketi takvimde olmalı");
  assert.ok(champion.options.length >= 18, "tüm Süper Lig kulüpleri seçenek olmalı");
  // BAŞLIK GEREKSİNİMDE BİREBİR VERİLDİ; serbest bir yeniden yazım değil.
  assert.equal(localizePoll(champion, "tr").question,
    "Sence 2026–27 Süper Lig şampiyonu kim olacak?",
    "Türkçe başlık gereksinimde verilen cümlenin birebir aynısı olmalı");
  assert.equal(localizePoll(champion, "en").question,
    "Who will win the 2026–27 Turkish Süper Lig?",
    "İngilizce başlık gereksinimde verilen cümlenin birebir aynısı olmalı");

  // ADRES VERİDEN GELİR VE İKİ DİLDE DE VAR: paylaşılan bağlantı bu.
  assert.equal(localizePoll(champion, "tr").path, "/anket/super-lig-sampiyonu-2026-27");
  assert.equal(localizePoll(champion, "en").path, "/en/poll/super-lig-champion-2026-27");

  // "DİĞER" SEÇENEĞİ YOK. Bir kulüp listesinde "diğer", ankete girmeyen
  // kulüplerin varlığını ima eder; liste eksiksiz olduğu için yanlış olurdu.
  const labels = champion.options.map((option) => localized(option.label, "tr").toLocaleLowerCase("tr"));
  assert.ok(!labels.some((label) => label === "diğer" || label === "other"),
    "şampiyonluk anketinde \"diğer\" seçeneği olmamalı");

  // Seçenekler kulüp veritabanıyla BİREBİR eşleşmeli: elle yazılmış tek bir
  // ad, lig kadrosu değiştiğinde sessizce yanlışa dönerdi.
  const expected = superLigOptions(teams).map((option) => option.id).sort();
  assert.deepEqual(champion.options.map((option) => option.id).sort(), expected,
    "seçenek listesi güncel Süper Lig kulüpleriyle birebir aynı olmalı");
}

// ── 8. UÇ NOKTA: doğrulama, pencere ve tek oy ─────────────────────────────
{
  const STORE_PATH = path.join(root, "services", "homePollVoteStore.js");
  const ROUTE_PATH = path.join(root, "server", "homePollRoute.js");
  const API_PATH = path.join(root, "api", "[...route].js");
  const POLLS_PATH = path.join(root, "data", "home-polls.json");

  const HOUR = 60 * 60 * 1000;
  const openPoll = poll({
    id: "test-acik-anket",
    startsAt: new Date(Date.now() - 24 * HOUR).toISOString(),
    endsAt: new Date(Date.now() + 20 * DAY_MS).toISOString()
  });
  const closedPoll = poll({
    id: "test-kapali-anket",
    startsAt: new Date(Date.now() - 60 * DAY_MS).toISOString(),
    endsAt: new Date(Date.now() - 30 * DAY_MS).toISOString()
  });

  /** Bellekte yaşayan sahte depo; gerçek Supabase'e çıkılmaz. */
  function installHandler(options = {}) {
    const votes = new Map(); // `${pollId}|${voterKey}` → optionId
    const fake = {
      ...require(STORE_PATH),
      isConfigured: () => options.configured !== false,
      readTally: async (pollId) => {
        if (options.throws) throw new Error("store-down");
        const counts = {};
        for (const [key, optionId] of votes) {
          if (key.split("|")[0] !== pollId) continue;
          counts[optionId] = (counts[optionId] || 0) + 1;
        }
        return counts;
      },
      recordVote: async (pollId, optionId, voterKey) => {
        if (options.throws) throw new Error("store-down");
        const key = `${pollId}|${voterKey}`;
        // Benzersiz kısıtın karşılığı: ikinci oy sayılmaz.
        if (votes.has(key)) return { counted: false };
        votes.set(key, optionId);
        return { counted: true };
      },
      findVote: async (pollId, voterKey) => {
        const optionId = votes.get(`${pollId}|${voterKey}`);
        return optionId ? { voted: true, optionId } : { voted: false, optionId: "" };
      }
    };

    require.cache[POLLS_PATH] = {
      id: POLLS_PATH, filename: POLLS_PATH, loaded: true,
      exports: { polls: options.closed ? [closedPoll] : [openPoll] }
    };
    require.cache[STORE_PATH] = { id: STORE_PATH, filename: STORE_PATH, loaded: true, exports: fake };
    delete require.cache[ROUTE_PATH];
    delete require.cache[API_PATH];
    return require(API_PATH);
  }

  function invoke(handler, { method = "GET", url = "/api/home-poll", body = null, cookie = "", ip = "" } = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (ip) headers["x-forwarded-for"] = ip;
    const req = { method, url, headers, body };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(payload) { this.body = payload; return this; }
    };
    return Promise.resolve(handler(req, res)).then(() => ({
      status: res.statusCode,
      headers: res.headers,
      payload: res.body ? JSON.parse(res.body) : null
    }));
  }

  const cookieFrom = (response) => String(response.headers["set-cookie"] || "").split(";")[0];

  // Depo kapalı: anket GÖRÜNÜR ama oy alınmaz ve sayı uydurulmaz.
  {
    const response = await invoke(installHandler({ configured: false }));
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.storage, "unavailable");
    assert.ok(response.payload.data.poll, "depo kapalıyken de soru gösterilmeli");
    assert.deepEqual(response.payload.data.results, [], "kapalıyken sonuç uydurulmamalı");
  }

  // Depo arızası ana sayfayı kırmaz.
  {
    const response = await invoke(installHandler({ throws: true }));
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.storage, "unavailable");
  }

  // GEÇERSİZ SEÇENEK SAYIMA GİREMEZ.
  {
    const handler = installHandler();
    for (const optionId of ["uydurma-kulup", "", "__proto__", "galatasarayx"]) {
      const response = await invoke(handler, { method: "POST", body: { optionId } });
      assert.equal(response.status, 400, `"${optionId}" reddedilmeliydi`);
      assert.equal(response.payload.error.code, "OPTION_NOT_IN_POLL");
    }
    const after = await invoke(handler);
    assert.equal(after.payload.data.total, 0, "reddedilen oy sayıma girmiş");
  }

  // Geçerli oy sayılır, yüzde GERÇEK toplamdan hesaplanır, lider işaretlenir.
  {
    const handler = installHandler();
    const options = (await invoke(handler)).payload.data.poll.options;

    const first = await invoke(handler, { method: "POST", body: { optionId: options[0].id }, ip: "1.1.1.1" });
    assert.equal(first.payload.data.counted, true);
    assert.equal(first.payload.data.total, 1);
    assert.equal(first.payload.data.results[0].percent, 100);
    assert.equal(first.payload.data.results[0].isLeader, true, "tek oy alan lider olmalı");
    assert.equal(first.payload.data.choice, options[0].id, "istemci kendi oyunu görebilmeli");

    // Farklı seçmen ikinci seçeneğe oy versin: BERABERLİKTE lider YOK.
    const second = await invoke(handler, { method: "POST", body: { optionId: options[1].id }, ip: "2.2.2.2" });
    assert.equal(second.payload.data.total, 2);
    assert.ok(!second.payload.data.results.some((row) => row.isLeader),
      "beraberlikte lider işareti verilmemeli");

    // Üçüncü oy ilk seçeneğe: lider yeniden belirir ve sıra ona göre kurulur.
    const third = await invoke(handler, { method: "POST", body: { optionId: options[0].id }, ip: "3.3.3.3" });
    assert.equal(third.payload.data.results[0].optionId, options[0].id, "en çok oy alan üstte olmalı");
    assert.equal(third.payload.data.results[0].isLeader, true);
    assert.equal(third.payload.data.results[0].percent, 67);
  }

  // AYNI SEÇMEN İKİ KEZ SAYILMAZ — çerez ve IP katmanları.
  {
    const handler = installHandler();
    const options = (await invoke(handler)).payload.data.poll.options;

    const first = await invoke(handler, { method: "POST", body: { optionId: options[0].id }, ip: "9.9.9.9" });
    assert.equal(first.payload.data.counted, true);
    const cookie = cookieFrom(first);
    assert.match(cookie, /^fr_poll_voter=[a-f0-9]{32}$/, "seçmen çerezi kurulmalı");

    // Aynı çerez + aynı IP: ikinci oy sayılmaz.
    const again = await invoke(handler, {
      method: "POST", body: { optionId: options[1].id }, cookie, ip: "9.9.9.9"
    });
    assert.equal(again.payload.data.counted, false, "aynı tarayıcı ikinci kez sayılmamalı");
    assert.equal(again.payload.data.total, 1, "ikinci oy toplamı artırmamalı");

    // Çerez SİLİNSE bile aynı IP tanınır (tuz tanımlıysa).
    const saltSaved = process.env.HOME_POLL_IP_SALT;
    process.env.HOME_POLL_IP_SALT = "test-tuzu";
    const freshHandler = installHandler();
    const opts = (await invoke(freshHandler)).payload.data.poll.options;
    await invoke(freshHandler, { method: "POST", body: { optionId: opts[0].id }, ip: "5.5.5.5" });
    const cookieless = await invoke(freshHandler, {
      method: "POST", body: { optionId: opts[1].id }, ip: "5.5.5.5"
    });
    assert.equal(cookieless.payload.data.counted, false, "çerezsiz aynı IP ikinci kez sayılmamalı");
    if (saltSaved === undefined) delete process.env.HOME_POLL_IP_SALT;
    else process.env.HOME_POLL_IP_SALT = saltSaved;

    // GET aynı seçmeni tanır: istemci formu değil sonucu gösterir.
    const read = await invoke(handler, { cookie, ip: "9.9.9.9" });
    assert.equal(read.payload.data.alreadyVoted, true);
    assert.equal(read.payload.data.choice, options[0].id);
  }

  // KAPANMIŞ ANKETTE OY YOK, SONUÇ VAR.
  {
    const handler = installHandler({ closed: true });
    const read = await invoke(handler);
    assert.equal(read.payload.data.status, "closed");
    assert.ok(read.payload.data.poll, "kapanan anketin sonuçları gösterilmeye devam etmeli");

    const late = await invoke(handler, {
      method: "POST", body: { optionId: read.payload.data.poll.options[0].id }
    });
    assert.equal(late.status, 409, "kapanmış ankette oy reddedilmeli");
    assert.equal(late.payload.error.code, "POLL_CLOSED");
  }

  // Çerez kişiye bağlanmaz ve tarayıcıdan okunamaz.
  {
    const handler = installHandler();
    const options = (await invoke(handler)).payload.data.poll.options;
    const response = await invoke(handler, { method: "POST", body: { optionId: options[0].id } });
    const raw = String(response.headers["set-cookie"] || "");
    assert.match(raw, /HttpOnly/);
    assert.match(raw, /SameSite=Lax/);
    assert.match(raw, /Secure/);
    assert.match(raw, /fr_poll_voter=[a-f0-9]{32}/);
  }

  // Sayım ÖNBELLEĞE ALINMAZ: yanıt seçmene özel alan taşıyor.
  {
    const response = await invoke(installHandler());
    assert.match(String(response.headers["cache-control"] || ""), /no-store/,
      "anket yanıtı önbelleğe alınmamalı");
  }

  // Desteklenmeyen yöntem.
  {
    const response = await invoke(installHandler(), { method: "DELETE" });
    assert.equal(response.status, 405);
  }

  // Temizlik: sonraki testler gerçek veriyi görsün.
  delete require.cache[POLLS_PATH];
  delete require.cache[STORE_PATH];
  delete require.cache[ROUTE_PATH];
  delete require.cache[API_PATH];
}

// ── 9. Depo modülü: IP saklanmaz, karma tuzsuz kurulmaz ───────────────────
{
  const store = require(path.join(root, "services", "homePollVoteStore.js"));
  const saved = { ...process.env };
  for (const name of [...store.REST_URL_ENV_NAMES, ...store.SERVICE_KEY_ENV_NAMES, ...store.IP_SALT_ENV_NAMES]) {
    delete process.env[name];
  }

  assert.equal(store.isConfigured(), false, "ortam değişkeni yokken depo kapalı olmalı");

  process.env.SUPABASE_URL = "https://ornek.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  assert.equal(store.isConfigured(), true, "Supabase adları tanınmalı");

  // TUZ YOKSA IP KATMANI ÇALIŞMAZ: tuzsuz karma dar IP uzayında geri
  // çözülebilir olurdu, o yüzden çerez kimliğine düşülür.
  const withoutSalt = store.voterKeyFor("abc", "203.0.113.9");
  assert.match(withoutSalt, /^br:abc$/, "tuz yokken çerez kimliğine düşülmeli");

  process.env.HOME_POLL_IP_SALT = "gizli-tuz";
  const withSalt = store.voterKeyFor("abc", "203.0.113.9");
  assert.match(withSalt, /^ip:[a-f0-9]{32}$/, "tuz varken IP karması kullanılmalı");
  // HAM IP HİÇBİR YERDE GEÇMEZ.
  assert.ok(!withSalt.includes("203.0.113.9"), "ham IP anahtarda görünmemeli");
  // Farklı IP farklı anahtar; aynı IP kararlı anahtar.
  assert.notEqual(withSalt, store.voterKeyFor("abc", "198.51.100.4"));
  assert.equal(withSalt, store.voterKeyFor("baska-cerez", "203.0.113.9"),
    "IP katmanı çerezden bağımsız olmalı");

  // ANON ANAHTARI KABUL EDİLMEZ VE NEDENİ SÖYLENİR.
  //
  // Tabloda RLS açık, hiçbir politika yok: anon rolü ne okuyabilir ne
  // yazabilir. Anon anahtarını kabul etmek, her oyun çalışma zamanında
  // sessizce reddedilmesi demek olurdu — "yapılandırılmamış" demek dürüst,
  // ama YETERSİZ: operatör yanlış İSMİ mi yoksa yanlış ANAHTAR TÜRÜNÜ mü
  // kullandığını göremiyordu.
  for (const name of [...store.REST_URL_ENV_NAMES, ...store.SERVICE_KEY_ENV_NAMES, ...store.ANON_KEY_ENV_NAMES]) {
    delete process.env[name];
  }

  process.env.SUPABASE_URL = "https://ornek.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-anahtari";
  assert.equal(store.isConfigured(), false, "anon anahtarı depoyu açmamalı");
  assert.match(store.configurationHint(), /anon/i, "teşhis anon anahtarını işaret etmeli");
  assert.match(store.configurationHint(), /SUPABASE_SERVICE_ROLE_KEY/,
    "teşhis hangi değişkenin gerektiğini söylemeli");

  // Servis DEĞİŞKENİNE anon anahtarı yapıştırılmışsa isConfigured() true
  // döner ama her istek RLS'e takılır; teşhis bunu da yakalamalı.
  const jwt = (role) => ["h", Buffer.from(JSON.stringify({ role })).toString("base64").replace(/=+$/, ""), "s"].join(".");
  process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("anon");
  assert.equal(store.isConfigured(), true);
  assert.match(store.configurationHint(), /service_role/, "servis alanındaki anon anahtarı bildirilmeli");
  assert.equal(store.keyRole(jwt("service_role")), "service_role");

  // Doğru kurulumda teşhis SESSİZ olmalı: gürültü, gerçek sorunu gizler.
  process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("service_role");
  assert.equal(store.configurationHint(), "", "doğru kurulumda teşhis boş olmalı");

  // HİÇBİR DEĞİŞKEN YOKKEN iki sebep ayırt edilmeli: değişkenler bu
  // projeye/ortama hiç ulaşmamış mı, yoksa tanınmayan bir adla mı var.
  for (const name of Object.keys(process.env).filter((key) => /supabase|home_poll/i.test(key))) {
    delete process.env[name];
  }
  assert.match(store.configurationHint(), /hicbir degisken yok/,
    "hiç değişken yokken bu açıkça söylenmeli");

  process.env.SUPABASE_URL_YANLIS_AD = "x";
  assert.match(store.configurationHint(), /1 degisken var/,
    "tanınmayan adla var olan değişken sayılmalı");
  // SAYI yazılır, AD yazılmaz: ad da bir sızıntıdır.
  assert.ok(!store.configurationHint().includes("SUPABASE_URL_YANLIS_AD"),
    "teşhis değişken adını sızdırmamalı");
  delete process.env.SUPABASE_URL_YANLIS_AD;

  // Teşhis hiçbir koşulda ANAHTARIN KENDİSİNİ yazmamalı.
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.SUPABASE_ANON_KEY = "cok-gizli-anon-anahtari";
  assert.ok(!store.configurationHint().includes("cok-gizli-anon-anahtari"),
    "teşhis anahtarı sızdırmamalı");

  process.env = saved;
}

// ── 10. ANA SAYFADA ANKET BASILI: TR ve EN, AYNI YERDE ───────────────────
//
// Anket ana sayfaya GERİ AÇILDI: `home-poll` adımı `POSTPROCESS_CHAIN`e
// döndü (yani `inject-home-poll.mjs` hem tam derlemede hem saatlik otomatik
// yenilemede koşuyor) ve `scripts/generate-en-pages.mjs` İngilizce ana
// sayfaya kendi kopyasını basıyor.
//
// TEST NE ARIYOR: blok GERÇEKTEN basılı mı ve İKİ DİLDE AYNI KANCALARLA mı.
// İşaretleme derleme anında dolu doğmak zorunda (mobilde ilk ekranda anket
// yerine boşluk kalmasın diye) — bu yüzden yalnızca kabuk değil, seçenek
// kartlarının kendisi de aranıyor.
//
// KONUM DA BİR GEREKSİNİM: anket canlı skor kahramanının HEMEN ARDINDA
// olmalı. "Sayfada bir yerde" yeterli değil; kutu haber akışının altına
// düşerse mobilde hiç görülmez.
//
// `public/index.html` kapsam dışı: Vercel `outputDirectory: "."` ile kök
// dizini yayınlıyor, `public/` yalnızca `sync-public-assets.mjs`nin bıraktığı
// bir ayna.
{
  const HOOKS = [
    "data-home-poll", "data-home-poll-source", "data-home-poll-locale",
    "data-home-poll-question", "data-home-poll-form", "data-home-poll-options",
    "data-home-poll-submit", "data-home-poll-results", "data-home-poll-total",
    "data-home-poll-podium", "data-poll-share", "data-poll-card",
    "home-poll__inner", "home-poll__disclaimer", "tahmin-anketi"
  ];

  const pages = [
    { file: "index.html", locale: "tr" },
    { file: path.join("en", "index.html"), locale: "en" }
  ];

  // Ekranda hangi anketin olması gerektiği takvimden okunur — testin kendi
  // beklentisini yazması, testi kodun kopyası yapardı.
  const live = selectHomePoll({
    polls: JSON.parse(fs.readFileSync(path.join(root, "data", "home-polls.json"), "utf8")),
    teams
  });
  assert.ok(live.poll, "ana sayfada gösterilecek anket olmalı (takvim boş)");

  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page.file), "utf8");

    for (const hook of HOOKS) {
      assert.ok(html.includes(hook), `${page.file}: "${hook}" kancası basılmamış`);
    }
    assert.ok(/class="home-poll__option"/.test(html), `${page.file}: anket seçenek kartı basılmamış`);
    assert.ok(/class="home-poll__radio"/.test(html), `${page.file}: anket radyo düğmesi basılmamış`);

    // Seçeneklerin TAMAMI basılı mı? Eksik bir kulüp, ankette olmayan bir
    // takım kadar yanlış: liste bir veri iddiasıdır.
    const optionCount = (html.match(/class="home-poll__option"/g) || []).length;
    assert.equal(optionCount, live.poll.options.length,
      `${page.file}: ${optionCount} seçenek basılı, ${live.poll.options.length} olmalı`);

    // Uyarı metni iki dilde de yerinde: anket bir TAHMİNDİR ve bu yazılı olmalı.
    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    assert.ok(html.includes(escapeHtml(COPY[page.locale].disclaimer)),
      `${page.file}: anket uyarı metni basılmamış`);

    // KONUM: anket bloğu canlı skor kahramanından SONRA, puan durumu
    // sekmelerinden ÖNCE gelmeli.
    const heroAt = html.indexOf('id="hero-canli-skor"');
    const pollAt = html.indexOf('id="tahmin-anketi"');
    assert.ok(heroAt >= 0, `${page.file}: canlı skor kahramanı bulunamadı`);
    assert.ok(pollAt > heroAt, `${page.file}: anket canlı skor bölümünün altında değil`);
  }

  // Zincirde olmayan bir adım saatlik koşuda hiç çalışmaz; bloğun bir kez
  // elle basılıp sonraki derlemede sessizce düşmesi tam olarak bu yüzden
  // olurdu.
  const chain = fs.readFileSync(path.join(root, "scripts", "lib", "postprocessChain.mjs"), "utf8");
  assert.ok(/id: "home-poll"/.test(chain), "home-poll adımı son işlem zincirinde yok");
  assert.ok(/id: "poll-pages"/.test(chain), "poll-pages adımı son işlem zincirinde yok");
}

// ── 11. ANKET SAYFASI: takvimin tamamı, doğru sırada ──────────────────────
//
// Ana sayfa tek anket gösterir; anket sayfası geçmişi, bugünü ve planlananı
// BİR ARADA ister. Sıra okuyucunun ilgisine göre: oy verilebilen üstte,
// sonra sonuçları okunabilenler, en sonda başlamamışlar. Kronolojik sıra
// kapanmış bir anketi açık olanın üstüne koyardı.
{
  const { listHomePolls } = require(path.join(root, "services", "homePoll.js"));

  const sources = {
    teams,
    polls: [
      poll({ id: "eski", startsAt: "2026-01-01T00:00:00+03:00", endsAt: "2026-02-01T00:00:00+03:00" }),
      poll({ id: "yeni-kapali", startsAt: "2026-03-01T00:00:00+03:00", endsAt: "2026-04-01T00:00:00+03:00" }),
      poll({ id: "acik", startsAt: "2026-08-01T00:00:00+03:00", endsAt: "2026-09-01T00:00:00+03:00" }),
      poll({ id: "yakin-planli", startsAt: "2026-09-10T00:00:00+03:00", endsAt: "2026-10-10T00:00:00+03:00" }),
      poll({ id: "uzak-planli", startsAt: "2026-11-01T00:00:00+03:00", endsAt: "2026-12-01T00:00:00+03:00" })
    ]
  };

  const { entries } = listHomePolls(sources, { now: Date.parse("2026-08-15T00:00:00+03:00") });
  assert.deepEqual(
    entries.map((entry) => `${entry.status}:${entry.poll.id}`),
    ["open:acik", "closed:yeni-kapali", "closed:eski", "upcoming:yakin-planli", "upcoming:uzak-planli"],
    "sıra: açık → kapananlar (en yeni önce) → planlananlar (en yakın önce)"
  );

  // Hiç anket yoksa liste boş döner; sayfa "anket yok" der, uydurmaz.
  assert.deepEqual(listHomePolls({ teams, polls: [] }, { now: Date.now() }).entries, []);
}

// ── 12. UÇ NOKTA: scope=all ───────────────────────────────────────────────
{
  const STORE_PATH = path.join(root, "services", "homePollVoteStore.js");
  const ROUTE_PATH = path.join(root, "server", "homePollRoute.js");
  const API_PATH = path.join(root, "api", "[...route].js");
  const POLLS_PATH = path.join(root, "data", "home-polls.json");

  const openPoll = poll({
    id: "liste-acik",
    startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 20 * DAY_MS).toISOString()
  });
  const closedPoll = poll({
    id: "liste-kapali",
    startsAt: new Date(Date.now() - 60 * DAY_MS).toISOString(),
    endsAt: new Date(Date.now() - 30 * DAY_MS).toISOString()
  });
  const upcomingPoll = poll({
    id: "liste-planli",
    startsAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    endsAt: new Date(Date.now() + 60 * DAY_MS).toISOString()
  });

  const reads = [];
  function installHandler(options = {}) {
    reads.length = 0;
    const votes = new Map();
    const fake = {
      ...require(STORE_PATH),
      isConfigured: () => options.configured !== false,
      readTally: async (pollId) => {
        if (options.throws) throw new Error("store-down");
        reads.push(pollId);
        const counts = {};
        for (const [key, optionId] of votes) {
          if (key.split("|")[0] !== pollId) continue;
          counts[optionId] = (counts[optionId] || 0) + 1;
        }
        return counts;
      },
      recordVote: async (pollId, optionId, voterKey) => {
        const key = `${pollId}|${voterKey}`;
        if (votes.has(key)) return { counted: false };
        votes.set(key, optionId);
        return { counted: true };
      },
      findVote: async (pollId, voterKey) => {
        const optionId = votes.get(`${pollId}|${voterKey}`);
        return optionId ? { voted: true, optionId } : { voted: false, optionId: "" };
      }
    };
    require.cache[POLLS_PATH] = {
      id: POLLS_PATH, filename: POLLS_PATH, loaded: true,
      exports: { polls: [openPoll, closedPoll, upcomingPoll] }
    };
    require.cache[STORE_PATH] = { id: STORE_PATH, filename: STORE_PATH, loaded: true, exports: fake };
    delete require.cache[ROUTE_PATH];
    delete require.cache[API_PATH];
    return require(API_PATH);
  }

  function invoke(handler, { method = "GET", url = "/api/home-poll?scope=all", body = null, cookie = "" } = {}) {
    const req = { method, url, headers: cookie ? { cookie } : {}, body };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(payload) { this.body = payload; return this; }
    };
    return Promise.resolve(handler(req, res)).then(() => ({
      status: res.statusCode,
      headers: res.headers,
      payload: res.body ? JSON.parse(res.body) : null
    }));
  }

  // Üç anket de döner, her biri durumuyla.
  {
    const handler = installHandler();
    const response = await invoke(handler);
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.storage, "ready");
    assert.deepEqual(
      response.payload.data.polls.map((entry) => `${entry.status}:${entry.id}`),
      ["open:liste-acik", "closed:liste-kapali", "upcoming:liste-planli"]
    );

    // BAŞLAMAMIŞ ANKETİN SAYIMI OKUNMAZ: henüz oy olamaz ve boş bir sorgu
    // her sayfa görüntülemesinde depoya gereksiz yük olurdu.
    assert.ok(!reads.includes("liste-planli"), "başlamamış anketin sayımı okunmamalı");
    assert.ok(reads.includes("liste-acik") && reads.includes("liste-kapali"));

    // Planlanan anket seçenekleriyle gelir ama sonuçsuz: "%0" iddia edilmez.
    const upcoming = response.payload.data.polls.find((entry) => entry.status === "upcoming");
    assert.ok(upcoming.options.length >= 18, "planlanan ankette seçenekler görünmeli");
    assert.deepEqual(upcoming.results, []);
    assert.equal(upcoming.total, 0);
  }

  // Liste kipi POST kabul etmez: oy vermek her zaman tekil yoldan geçer,
  // çünkü pencere kapısı orada.
  {
    const handler = installHandler();
    const response = await invoke(handler, {
      method: "POST", url: "/api/home-poll?scope=all", body: { optionId: "x" }
    });
    assert.notEqual(response.status, 200, "liste kipinde POST sayıma girmemeli");
  }

  // Depo kapalıyken sorular gösterilir, sayım gösterilmez.
  {
    const response = await invoke(installHandler({ configured: false }));
    assert.equal(response.payload.data.storage, "unavailable");
    assert.equal(response.payload.data.polls.length, 3, "depo kapalıyken de takvim görünmeli");
    for (const entry of response.payload.data.polls) assert.deepEqual(entry.results, []);
  }

  // Depo arızası sayfayı kırmaz.
  {
    const response = await invoke(installHandler({ throws: true }));
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.storage, "unavailable");
    assert.equal(response.payload.data.polls.length, 3);
  }

  delete require.cache[POLLS_PATH];
  delete require.cache[STORE_PATH];
  delete require.cache[ROUTE_PATH];
  delete require.cache[API_PATH];
}

// ── 13. ANKET SAYFASI: iki dilde aynı kabuk ───────────────────────────────
{
  // Sayfa İKİ liste taşır: kampanya anketleri ve maç anketleri. "Tüm
  // anketler bir arada" iddiası ancak ikisi de varsa doğru.
  const HOOKS = [
    "data-poll-archive", "data-poll-archive-source", "data-poll-archive-list", "data-poll-archive-status",
    "data-motm-archive", "data-motm-archive-source", "data-motm-archive-list", "data-motm-archive-status"
  ];
  for (const page of [{ file: "anketler.html", locale: "tr" }, { file: path.join("en", "polls.html"), locale: "en" }]) {
    const html = fs.readFileSync(path.join(root, page.file), "utf8");
    for (const hook of HOOKS) {
      assert.ok(html.includes(hook), `${page.file}: "${hook}" kancası eksik`);
    }
    assert.ok(html.includes(`data-poll-archive-locale="${page.locale}"`), `${page.file}: dil kancası yanlış`);
    assert.ok(html.includes(`data-motm-archive-locale="${page.locale}"`), `${page.file}: maç anketi dil kancası yanlış`);
    // Sayfa ortak yerleşimi almış olmalı (menü, arama, dil kutusu).
    assert.ok(html.includes('data-shared-layout="header"'), `${page.file}: ortak başlık uygulanmamış`);
    assert.ok(html.includes("lang-switch"), `${page.file}: dil kutusu yok`);
  }

  // Menüde iki dilde de var: erişilemeyen sayfa işe yaramaz.
  const { NAV_KEYS } = require(path.join(root, "services", "i18n.js"));
  assert.ok(NAV_KEYS.tr.secondary.some((item) => item.href === "anketler.html"), "TR menüde anket sayfası yok");
  assert.ok(NAV_KEYS.en.secondary.some((item) => item.href === "en/polls.html"), "EN menüde anket sayfası yok");

  // İstemci sözleşmesi.
  const client = fs.readFileSync(path.join(root, "site.js"), "utf8");
  for (const hook of ["data-poll-archive-list", "scope=all", "poll-archive__card",
    "data-motm-archive-list", "scope=matches", "motm-archive__card"]) {
    assert.ok(client.includes(hook), `site.js "${hook}" kancasını kaybetmiş`);
  }
  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  for (const selector of [".poll-archive__card", ".poll-archive__badge.is-open", ".poll-archive__preview"]) {
    assert.ok(css.includes(selector), `page.css "${selector}" seçicisini kaybetmiş`);
  }
}

// ── 14. VERİ DOSYALARI SABİT DİZEYLE İSTENMELİ ────────────────────────────
//
// BU TEST BİR CANLI ARIZADAN DOĞDU. Uç noktalar veri dosyalarını
// `require(değişken)` ile okuyan genel bir yükleyiciyle açılmıştı; yerelde
// çalıştı, testler yeşildi, CANLIDA SESSİZCE BOŞ DÖNDÜ. Vercel sunucusuz
// işlevin bağımlılıklarını STATİK çözümlüyor ve değişkenle çağrılan bir
// `require`ı göremiyor — dosyalar fonksiyon paketine hiç konmadı ve uç
// nokta "yayında anket yok" dedi.
//
// Hata sınıfı en kötüsü: kod doğru, test yeşil, canlı yanlış. Testin işi bu
// yüzden davranışı değil BİÇİMİ denetlemek.
{
  const ROUTE_FILES = [
    path.join("server", "homePollRoute.js"),
    path.join("server", "motmWeekRoute.js"),
    path.join("server", "motmVoteRoute.js"),
    path.join("api", "[...route].js")
  ];

  for (const file of ROUTE_FILES) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    // YORUMLAR AYIKLANIR. Bu dosyalardaki yorumlar kuralın kendisini
    // anlatıyor ve içlerinde "require(değişken)" ifadesi geçiyor; ham metni
    // taramak testi kendi belgelendirmesine takardı.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[\t ]*\/\/.*$/gm, "");

    // `require(` sonrası TIRNAK gelmeli. Gelmiyorsa argüman bir ifadedir ve
    // çözümleyici onu takip edemez.
    const dynamic = [...code.matchAll(/\brequire\(\s*([^"'`)\s])/g)].map((match) => match[1]);
    assert.equal(dynamic.length, 0,
      `${file}: require() sabit dize almalı — Vercel değişkenli require'ı çözümleyemez ` +
      `(bulunan: ${dynamic.join(", ")})`);

    // Okunan her veri dosyası gerçekten var olmalı: pakete girse bile
    // olmayan bir dosya aynı sessiz boşluğu üretir.
    for (const [, dataFile] of source.matchAll(/require\("\.\.\/(data\/[^"]+)"\)/g)) {
      assert.ok(fs.existsSync(path.join(root, dataFile)), `${file}: ${dataFile} yok`);
    }
  }
}


// ── 15. ANKET SAYFALARI: adres, kanonik, hreflang ve gerçek içerik ────────
//
// Paylaşılan bağlantının gittiği yer burası. Üç şey aynı anda doğru olmak
// zorunda, yoksa paylaşım trafiği ya 404'e ya yanlış ankete düşer:
//
//   • dosya gerçekten üretilmiş olmalı,
//   • `vercel.json` uzantısız adresi o dosyaya bağlamalı,
//   • soru HTML'de GERÇEK İÇERİK olmalı — arama motoru ve paylaşım
//     önizlemesi JavaScript'i beklemez.
{
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "home-polls.json"), "utf8"));
  const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
  const { entries } = listHomePolls({ polls: payload, teams, matches }, { surface: "all" });
  assert.ok(entries.length >= 1, "takvimde anket olmalı");

  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const rewrites = new Map((vercel.rewrites || []).map((rule) => [rule.source, rule.destination]));
  assert.equal(rewrites.get("/anket/:slug"), "/anket/:slug.html",
    "Türkçe anket sayfası için temiz adres kuralı yok");
  assert.equal(rewrites.get("/en/poll/:slug"), "/en/poll/:slug.html",
    "İngilizce anket sayfası için temiz adres kuralı yok");

  for (const entry of entries) {
    const tr = localizePoll(entry.poll, "tr");
    const en = localizePoll(entry.poll, "en");

    for (const view of [
      { poll: tr, file: path.join("anket", `${tr.slug}.html`), canonical: `https://www.futbolradar.com${tr.path}` },
      { poll: en, file: path.join("en", "poll", `${en.slug}.html`), canonical: `https://www.futbolradar.com${en.path}` }
    ]) {
      const file = path.join(root, view.file);
      assert.ok(fs.existsSync(file), `${view.file} üretilmemiş`);
      const html = fs.readFileSync(file, "utf8");

      // Soru hem `<h1>` hem `<title>` içinde: sayfanın konusu odur.
      assert.ok(/<h1 class="home-poll__title"/.test(html), `${view.file}: soru h1 olarak basılmamış`);
      assert.ok(html.includes(`<link rel="canonical" href="${view.canonical}" />`),
        `${view.file}: kanonik adres yanlış`);
      assert.ok(html.includes(`hreflang="tr-TR" href="https://www.futbolradar.com${tr.path}"`),
        `${view.file}: Türkçe hreflang yanlış`);
      assert.ok(html.includes(`hreflang="en" href="https://www.futbolradar.com${en.path}"`),
        `${view.file}: İngilizce hreflang yanlış`);

      // Open Graph ve Twitter kartı: paylaşılan bağlantı önizlemesiz çıkamaz.
      for (const tag of [
        'property="og:title"', 'property="og:description"', 'property="og:image"',
        'property="og:url"', 'name="twitter:card"', 'name="twitter:title"',
        'name="twitter:description"', 'name="twitter:image"'
      ]) {
        assert.ok(html.includes(tag), `${view.file}: ${tag} eksik`);
      }
      assert.ok(html.includes('content="summary_large_image"'),
        `${view.file}: twitter:card büyük kart olmalı`);

      // OG görseli GERÇEKTEN var olmalı — bildirilen ama olmayan bir görsel
      // her ağda görselsiz bir önizleme demek.
      const image = (html.match(/property="og:image" content="https:\/\/www\.futbolradar\.com\/([^"]+)"/) || [])[1];
      assert.ok(image && fs.existsSync(path.join(root, image)), `${view.file}: og:image dosyası yok (${image})`);

      // Seçeneklerin tamamı basılı: liste bir veri iddiasıdır.
      const optionCount = (html.match(/class="home-poll__option"/g) || []).length;
      if (entry.status === "open") {
        assert.equal(optionCount, view.poll.options.length,
          `${view.file}: ${optionCount} seçenek basılı, ${view.poll.options.length} olmalı`);
      }

      // Sayfa BU anketi ister, "şu an açık olanı" değil.
      assert.ok(html.includes(`data-home-poll-source="/api/home-poll?pollId=${encodeURIComponent(entry.poll.id)}"`),
        `${view.file}: anket kimliğe sabitlenmemiş`);
      assert.ok(html.includes("data-home-poll-pinned"), `${view.file}: sabitleme işareti yok`);

      // BAŞLAMAMIŞ ANKET İNDEKSLENMEZ: içinde henüz sonuç yok.
      const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || "";
      if (entry.status === "upcoming") {
        assert.ok(/noindex/.test(robots), `${view.file}: başlamamış anket noindex olmalı`);
      } else {
        assert.ok(!/noindex/.test(robots), `${view.file}: yayındaki anket indekslenmeli`);
      }
    }
  }

  // Site haritası yalnızca indekslenen anketleri taşır.
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  for (const entry of entries) {
    const tr = localizePoll(entry.poll, "tr");
    const loc = `<loc>https://www.futbolradar.com${tr.path}</loc>`;
    if (entry.status === "upcoming") {
      assert.ok(!sitemap.includes(loc), `${tr.slug}: başlamamış anket site haritasında olmamalı`);
    } else {
      assert.ok(sitemap.includes(loc), `${tr.slug}: yayındaki anket site haritasında yok`);
    }
  }
}

// ── 16. PAYLAŞIM: dinamik metin, UTM ve kanallar ──────────────────────────
//
// Paylaşım metni SABİT OLAMAZ: kullanıcının seçtiği takımı ve anketin o anki
// sonucunu söylemek zorunda. Şablonlar tek yerde (servis) duruyor ve yer
// tutucularını taşımak zorunda — yer tutucusuz bir şablon, sessizce herkese
// aynı cümleyi paylaştırırdı.
{
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "home-polls.json"), "utf8"));
  const { poll } = selectHomePoll({ polls: payload, teams });

  for (const locale of ["tr", "en"]) {
    const share = localizePoll(poll, locale).share;
    assert.ok(share, `${locale}: paylaşım şablonları yok`);
    assert.ok(share.voted.includes("{team}") && share.voted.includes("{percent}"),
      `${locale}: "oy verdim" şablonu seçim ve yüzde yer tutucusu taşımalı`);
    assert.ok(share.votedWithoutResult.includes("{team}"),
      `${locale}: sayımsız şablon seçim yer tutucusu taşımalı`);
    // SAYIMSIZ ŞABLONDA YÜZDE OLMAMALI: depo kapalıyken "%0" paylaştırmak,
    // veride olmayan bir sayı iddia etmektir.
    assert.ok(!share.votedWithoutResult.includes("{percent}"),
      `${locale}: sayımsız şablonda yüzde olmamalı`);
    assert.ok(share.leader.includes("{team}") && share.leader.includes("{percent}"),
      `${locale}: lider şablonu takım ve yüzde yer tutucusu taşımalı`);
    assert.ok(share.plain.includes("{question}"), `${locale}: yalın şablon soruyu taşımalı`);
  }

  // UTM: her ağ ayrı kaynak etiketi alır, kampanya anket kimliğinden türer.
  const base = `https://www.futbolradar.com${localizePoll(poll, "tr").path}`;
  const seen = new Set();
  for (const platform of ["x", "whatsapp", "facebook", "telegram", "native", "copy"]) {
    const url = shareUrlFor(base, platform, poll.id);
    assert.ok(url.includes(`utm_source=${platform}`), `${platform}: utm_source yanlış`);
    assert.ok(url.includes("utm_medium=social"), `${platform}: utm_medium yanlış`);
    assert.ok(url.includes(`utm_campaign=poll_${poll.id.replace(/-/g, "_")}`),
      `${platform}: utm_campaign anket kimliğinden türemeli`);
    seen.add(url);
  }
  assert.equal(seen.size, 6, "her ağ AYRI bir adres almalı, yoksa ölçüm ayrışmaz");

  // İşaretleme: istenen kanalların hepsi basılı mı?
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const platform of ["x", "whatsapp", "facebook", "telegram"]) {
    assert.ok(html.includes(`data-poll-share-link="${platform}"`), `${platform} paylaşım düğmesi yok`);
  }
  for (const hook of [
    "data-poll-share-native", "data-poll-share-copy", "data-poll-share-instagram",
    "data-poll-card-format=\"square\"", "data-poll-card-format=\"story\"",
    "data-poll-card-preview", "data-poll-card-download"
  ]) {
    assert.ok(html.includes(hook), `paylaşım kancası eksik: ${hook}`);
  }

  // İstemci native paylaşımı GERÇEKTEN kullanıyor mu (düğme varsa çalışmalı)?
  const client = fs.readFileSync(path.join(root, "site.js"), "utf8");
  assert.ok(client.includes("navigator.share("), "site.js native paylaşımı kullanmıyor");
  assert.ok(client.includes("navigator.canShare"), "site.js görsel paylaşım desteğini sormuyor");
  assert.ok(/CARD_FORMATS[\s\S]*1080[\s\S]*1920/.test(client),
    "site.js 1080×1080 ve 1080×1920 kart biçimlerini tanımlamıyor");

  // Paylaşım sayacı: beyaz liste dışı bir değer tabloya YAZILMAZ.
  const store = require(path.join(root, "services", "homePollVoteStore.js"));
  assert.ok(store.SHARE_PLATFORMS.includes("x"), "paylaşım kanalı listesi eksik");
  assert.equal(store.SHARE_TABLE, "home_poll_shares", "paylaşım tablosu adı değişmiş");
}

// ── 17. MAÇ ANKETİ ALTYAPISI: yüzey, seçenek türetme, kısa pencere ────────
//
// "Bu maçı kim kazanır?" anketi ana sayfa anketiyle AYNI sistemi kullanmak
// zorunda — ikinci bir anket motoru, ikinci bir oy deposu ve ikinci bir
// paylaşım yolu demekti. Ama iki yüzeyin kuralları aynı olamaz: bir maç önü
// penceresi saatlerle ölçülür, ana sayfa anketi iki haftayla.
{
  const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
  const sample = matches[0];
  assert.ok(sample && sample.id, "maç verisi okunamadı");

  const record = {
    id: "mac-anketi-testi",
    surface: "match",
    matchId: sample.id,
    optionSource: "match-outcome",
    startsAt: "2026-09-20T18:00:00+03:00",
    // İKİ SAAT: ana sayfa anketinin 14 günlük alt sınırına takılmamalı.
    endsAt: "2026-09-20T20:00:00+03:00",
    question: { tr: "Bu maçı kim kazanır?", en: "Who wins this match?" }
  };

  const verdict = validatePoll(record, { teams, matches });
  assert.ok(verdict.valid, `maç anketi elendi: ${verdict.errors.join("; ")}`);
  assert.equal(verdict.poll.options.length, 3, "maç anketi ev/beraberlik/deplasman olmalı");
  assert.deepEqual(verdict.poll.options.map((option) => option.id), ["home", "draw", "away"]);
  // BERABERLİĞİN ARMASI YOKTUR: bir sonucu kulüp armasıyla göstermek, o
  // sonucu bir kulübe ait gibi okutur.
  assert.equal(verdict.poll.options[1].logo, "", "beraberlik seçeneğinin arması olmamalı");
  assert.equal(matchOutcomeOptions({ matchId: "yok-boyle-bir-mac" }, { teams, matches }).length, 0,
    "olmayan maç için seçenek üretilmemeli");

  // AYNI PENCERE ANA SAYFA YÜZEYİNDE ELENİR: kural gevşetilmedi, yüzeye bağlandı.
  const asHome = validatePoll({ ...record, surface: "home", optionSource: undefined, options: [
    { id: "a", label: { tr: "A", en: "A" } },
    { id: "b", label: { tr: "B", en: "B" } }
  ] }, { teams, matches });
  assert.ok(!asHome.valid, "iki saatlik pencere ana sayfa anketinde kabul edilmemeli");

  // Maç anketi ANA SAYFAYA DÜŞMEZ ve ana sayfa anketini çakışma sayarak elemez.
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "home-polls.json"), "utf8"));
  const sources = { polls: { polls: [...payload.polls, record] }, teams, matches };
  const home = selectHomePoll(sources, { now: Date.parse("2026-09-20T19:00:00+03:00") });
  assert.equal(home.poll && home.poll.surface, "home", "ana sayfada maç anketi gösterilmemeli");

  const forMatch = selectMatchPoll(sources, sample.id, { now: Date.parse("2026-09-20T19:00:00+03:00") });
  assert.equal(forMatch.status, "open", "maçın anketi o saatte açık olmalı");
  assert.equal(forMatch.poll.id, "mac-anketi-testi");

  // Adres de çalışır: maç anketi de kendi paylaşılabilir sayfasını alır.
  assert.equal(localizePoll(forMatch.poll, "tr").path, "/anket/mac-anketi-testi");

  // Kimliğe göre arama kapanmış anketi de bulur (anket sayfasının ihtiyacı).
  const found = findPoll(sources, { slug: "super-lig-sampiyonu-2026-27" });
  assert.equal(found.poll && found.poll.id, "super-lig-2026-2027-sampiyon");
}


// ── 18. UÇ NOKTA: adrese sabitlenmiş anket ve paylaşım sayacı ─────────────
//
// Anket sayfası BELLİ bir anketi ister (`?pollId=`) ve o anket kapanmış
// olabilir. Ama sabitleme bir AÇIK KAPI OLMAMALI: istemcinin gönderdiği
// kimlik yine takvimden doğrulanıyor ve pencere kapısı yerinde duruyor.
{
  const STORE_PATH = path.join(root, "services", "homePollVoteStore.js");
  const ROUTE_PATH = path.join(root, "server", "homePollRoute.js");
  const API_PATH = path.join(root, "api", "[...route].js");
  const POLLS_PATH = path.join(root, "data", "home-polls.json");

  const HOUR = 60 * 60 * 1000;
  const openPoll = poll({
    id: "sabit-acik", slug: { tr: "sabit-acik-tr", en: "sabit-acik-en" },
    startsAt: new Date(Date.now() - 24 * HOUR).toISOString(),
    endsAt: new Date(Date.now() + 20 * DAY_MS).toISOString()
  });
  const closedPoll = poll({
    id: "sabit-kapali", slug: { tr: "sabit-kapali-tr", en: "sabit-kapali-en" },
    startsAt: new Date(Date.now() - 60 * DAY_MS).toISOString(),
    endsAt: new Date(Date.now() - 30 * DAY_MS).toISOString()
  });

  const shares = [];
  function installHandler() {
    const fake = {
      ...require(STORE_PATH),
      isConfigured: () => true,
      readTally: async () => ({}),
      recordVote: async () => ({ counted: true }),
      findVote: async () => ({ voted: false, optionId: "" }),
      recordShare: async (pollId, platform, locale) => {
        shares.push({ pollId, platform, locale });
        return { recorded: true, reason: "" };
      }
    };
    require.cache[POLLS_PATH] = {
      id: POLLS_PATH, filename: POLLS_PATH, loaded: true,
      exports: { polls: [closedPoll, openPoll] }
    };
    require.cache[STORE_PATH] = { id: STORE_PATH, filename: STORE_PATH, loaded: true, exports: fake };
    delete require.cache[ROUTE_PATH];
    delete require.cache[API_PATH];
    return require(API_PATH);
  }

  // HER İSTEK AYRI BİR IP'DEN. Hız sınırı IP başına sayıyor ve bu bölüm
  // önceki bölümle aynı süreçte koşuyor; ortak bir adres kullanmak testi
  // davranışa değil kotaya takardı.
  let caller = 0;
  function invoke(handler, { method = "GET", url = "/api/home-poll", body = null } = {}) {
    caller += 1;
    const req = { method, url, headers: { "x-forwarded-for": `203.0.113.${caller}` }, body };
    const res = {
      statusCode: 200, headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(payload) { this.body = payload; return this; }
    };
    return Promise.resolve(handler(req, res)).then(() => ({
      status: res.statusCode,
      payload: res.body ? JSON.parse(res.body) : null
    }));
  }

  const handler = installHandler();

  // Sabitlenmemiş istek: takvim "şu an açık olanı" verir.
  {
    const response = await invoke(handler);
    assert.equal(response.payload.data.poll.id, "sabit-acik");
  }

  // Sabitlenmiş istek KAPANMIŞ anketi getirir — anket sayfasının ihtiyacı bu.
  {
    const response = await invoke(handler, { url: "/api/home-poll?pollId=sabit-kapali" });
    assert.equal(response.payload.data.poll.id, "sabit-kapali");
    assert.equal(response.payload.data.status, "closed");
  }

  // Adres (slug) ile de bulunur; paylaşılan bağlantı bu adresi taşıyor.
  {
    const response = await invoke(handler, { url: "/api/home-poll?slug=sabit-kapali-en" });
    assert.equal(response.payload.data.poll.id, "sabit-kapali");
  }

  // PENCERE KAPISI SABİTLEMEYLE AÇILMAZ: kapanmış ankete oy yazılamaz.
  {
    const response = await invoke(handler, {
      method: "POST", body: { pollId: "sabit-kapali", optionId: superLigOptions(teams)[0].id }
    });
    assert.equal(response.status, 409, "kapanmış ankete oy kabul edilmemeli");
    assert.equal(response.payload.error.code, "POLL_CLOSED");
  }

  // Takvimde olmayan kimlik bir anket AÇMAZ.
  {
    const response = await invoke(handler, { url: "/api/home-poll?pollId=uydurma-anket" });
    assert.equal(response.payload.data.poll, null, "takvimde olmayan anket gösterilmemeli");
  }

  // PAYLAŞIM SAYACI: kimlik takvimden doğrulanır, kanal beyaz listeden.
  {
    const response = await invoke(handler, {
      method: "POST", body: { action: "share", pollId: "sabit-acik", platform: "whatsapp", locale: "tr" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.recorded, true);
    assert.deepEqual(shares[shares.length - 1], { pollId: "sabit-acik", platform: "whatsapp", locale: "tr" });
  }
  {
    const response = await invoke(handler, {
      method: "POST", body: { action: "share", pollId: "uydurma-anket", platform: "whatsapp" }
    });
    assert.equal(response.status, 400, "takvimde olmayan anket için paylaşım yazılmamalı");
    assert.equal(response.payload.error.code, "POLL_NOT_FOUND");
  }

  // Paylaşım bir OY DEĞİL: sayaç isteği oy sayımına dokunmamalı.
  {
    const response = await invoke(handler, { url: "/api/home-poll?pollId=sabit-acik" });
    assert.equal(response.payload.data.total, 0, "paylaşım sayacı oy sayımına yazmış");
  }

  delete require.cache[POLLS_PATH];
  delete require.cache[STORE_PATH];
  delete require.cache[ROUTE_PATH];
  delete require.cache[API_PATH];
}

console.log("home-poll OK (18 bölüm)");
