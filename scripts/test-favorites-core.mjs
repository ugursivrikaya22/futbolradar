#!/usr/bin/env node
/**
 * FAVORİ DEPOSU (favorites-core.js) — doğrulama, sınırlar, eski anahtarlar, sıfırlama,
 * paylaşım bağlantısı ve kötü niyetli/bozuk girdi.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../favorites-core.js");

let failures = 0;
const check = (condition, message) => { if (!condition) { failures += 1; console.error(`  FAIL ${message}`); } else console.log(`  ok  ${message}`); };

function memoryStorage(initial = {}, { failWrites = false, failReads = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => { if (failReads) throw new Error("denied"); return map.has(key) ? map.get(key) : null; },
    setItem: (key, value) => { if (failWrites) throw new Error("quota"); map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}
const BASE = "https://www.futbolradar.com/";
const make = (storage, extra = {}) => core.createStore({ storage, base: BASE, ...extra });

// 1. Takım seçimi, birincil takım, sınır
{
  const store = make(memoryStorage());
  check(store.primaryTeam() === "", "boş depoda birincil takım yok");
  check(store.setPrimaryTeam("galatasaray") && store.primaryTeam() === "galatasaray", "favori takım seçilir");
  check(store.addTeam("fenerbahce") && store.addTeam("besiktas") && store.addTeam("trabzonspor") && store.addTeam("564"), "dört büyük takım + sayısal sağlayıcı kimliği eklenir");
  check(!store.addTeam("samsunspor") && store.getState().teams.length === 5, `en çok ${core.MAX_TEAMS} takım: altıncısı reddedilir, eskiler silinmez`);
  check(store.setPrimaryTeam("besiktas") && store.getState().teams[0] === "besiktas" && store.getState().teams.length === 5, "favori değiştirme: yeni birincil başa geçer, liste şişmez");
  check(store.addTeam("BESIKTAS") && store.getState().teams.length === 5, "büyük/küçük harf farkı aynı takımdır (çift kayıt yok)");
  check(store.removeTeam("trabzonspor") && !store.hasTeam("trabzonspor"), "takım çıkarılır");
}

// 2. Geçersiz kimlikler
{
  const store = make(memoryStorage());
  for (const bad of ["", "   ", "<script>alert(1)</script>", "../../etc/passwd", "a b", "x".repeat(200), null, undefined, {}, [], "javascript:alert(1)", "é"]) {
    check(!store.addTeam(bad) && !store.setPrimaryTeam(bad), `hatalı takım kimliği reddedilir: ${JSON.stringify(bad)?.slice(0, 40)}`);
  }
  check(store.getState().teams.length === 0, "hatalı kimlikler depoya girmedi");
  for (const bad of ["", "../x", "a/b", "<img src=x onerror=1>", "id with space", "x".repeat(300), null]) {
    check(store.toggleMatch({ id: bad, home: "A", away: "B" }).ok === false, `hatalı maç kimliği reddedilir: ${JSON.stringify(bad)?.slice(0, 40)}`);
  }
  check(store.getState().matches.length === 0, "hatalı maç kimlikleri depoya girmedi");
}

// 3. Favori maç ekleme / çıkarma, tarih saklanmaz
{
  let tick = 1000;
  const store = make(memoryStorage(), { now: () => (tick += 1) });
  const record = { id: "galatasaray-kasimpasa-2026-10-09", home: "Galatasaray", away: "Kasımpaşa", href: "./mac/galatasaray-kasimpasa-2026-10-09.html", kickoff: "2026-10-09T20:00:00+03:00", score: { home: 3, away: 1 }, status: "FINISHED" };
  const added = store.toggleMatch(record);
  check(added.ok && added.active && store.hasMatch(record.id), "favori maç eklenir");
  const saved = store.getState().matches[0];
  check(saved.href === "/mac/galatasaray-kasimpasa-2026-10-09.html", "göreli bağlantı aynı kaynaklı yola çevrilir");
  check(!("kickoff" in saved) && !("score" in saved) && !("status" in saved), "tarih, saat ve skor saklanmaz (maç ertelenirse bayat kopya olmaz)");
  const removed = store.toggleMatch(record);
  check(removed.ok && !removed.active && !store.hasMatch(record.id), "aynı düğmeyle favoriden çıkarılır");
  for (let i = 0; i < core.MAX_MATCHES; i += 1) store.toggleMatch({ id: `m-${i}`, home: "A", away: "B" });
  const full = store.toggleMatch({ id: "m-overflow", home: "A", away: "B" });
  check(full.ok === false && full.full === true && store.getState().matches.length === core.MAX_MATCHES, `en çok ${core.MAX_MATCHES} maç: dolunca reddedilir ve kullanıcıya bildirilebilir`);
}

// 4. Kötü niyetli ve bozuk depo içeriği okunurken süzülür
{
  const evil = {
    v: 1,
    teams: ["galatasaray", "<script>alert(1)</script>", "javascript:alert(1)", {}, [], null, "galatasaray", "fenerbahce", "a".repeat(100)],
    matches: [
      { id: "ok-1", home: "<img src=x onerror=alert(1)>Ev", away: "Dep\u0000​‮", href: "javascript:alert(1)", addedAt: "x" },
      { id: "ok-2", home: "A", away: "B", href: "//evil.example/x" },
      { id: "ok-3", home: "A", away: "B", href: "https://evil.example/mac/x" },
      { id: "ok-4", home: "A", away: "B", href: "/mac/ok-4.html" },
      { id: "ok-5", home: "A", away: "B", href: "data:text/html,<script>alert(1)</script>" },
      { id: "ok-6", home: "A", away: "B", href: "/mac/x\"onmouseover=\"alert(1)" },
      { id: "bad id", home: "A", away: "B" },
      { id: "ok-1", home: "dup", away: "dup" },
      "string", 42, null, { id: { nested: true } }, { id: ["x"] }
    ]
  };
  const state = core.normalize(evil, BASE);
  check(JSON.stringify(state.teams) === JSON.stringify(["galatasaray", "fenerbahce"]), "bozuk/kötü niyetli takım kimlikleri ve yinelenenler atılır");
  check(state.matches.map((m) => m.id).join(",") === "ok-1,ok-2,ok-3,ok-4,ok-5,ok-6", "yalnızca geçerli ve tekil maç kimlikleri kalır");
  check(state.matches.every((m) => /^\/[A-Za-z0-9\/_\-.%~?=&#:+,]*$/.test(m.href)), "her bağlantı güvenli, aynı kaynaklı bir yol (javascript:, data:, başka alan adı, protokol-göreli hepsi düşer)");
  check(state.matches[0].href === "/mac-detay.html?id=ok-1", "geçersiz bağlantı güvenli varsayılana düşer");
  check(!/[\u0000​‮]/.test(state.matches[0].away), "kontrol ve yön değiştirici karakterler metinden temizlenir");
  check(state.matches[0].home === "<img src=x onerror=alert(1)>Ev", "metin olduğu gibi saklanır (HTML'e DEĞİL, textContent ile yazılacak; kaçış çağıranın işi)");
  for (const raw of ["not json", "[]", "null", "42", "{\"teams\":\"x\"}", "{\"matches\":{}}", ""]) {
    const parsed = core.parse(raw, BASE);
    check(parsed.teams.length === 0 && parsed.matches.length === 0, `bozuk depo içeriği boş duruma düşer: ${JSON.stringify(raw)}`);
  }
}

// 5. Eski anahtarlarla geriye uyum ve eşzamanlı yazım
{
  const legacy = memoryStorage({ "futbolradar-favourite-team": "fenerbahce" });
  const store = make(legacy);
  check(store.primaryTeam() === "fenerbahce", "eski anahtar (futbolradar-favourite-team) okunur");
  const pwa = memoryStorage({ fr_favorite_team: "besiktas" });
  check(make(pwa).primaryTeam() === "besiktas", "PWA panelinin eski anahtarı (fr_favorite_team) okunur");
  const both = memoryStorage();
  const s = make(both);
  s.setPrimaryTeam("trabzonspor");
  check(both.map.get("futbolradar-favourite-team") === "trabzonspor" && both.map.get("fr_favorite_team") === "trabzonspor", "birincil takım eski anahtarlara eşzamanlı yazılır (ana sayfa, PWA paneli, radar kartı aynı seçimi görür)");
  s.removeTeam("trabzonspor");
  check(!both.map.has("futbolradar-favourite-team") && !both.map.has("fr_favorite_team"), "son takım çıkınca eski anahtarlar da silinir");
  const poisoned = memoryStorage({ "futbolradar-favourite-team": "<script>" });
  check(make(poisoned).primaryTeam() === "", "eski anahtardaki kötü değer yok sayılır");
}

// 6. Sıfırlama (KVKK) ve olay bildirimi
{
  const events = [];
  const storage = memoryStorage();
  const store = make(storage, { onChange: (state) => events.push(state) });
  store.setPrimaryTeam("galatasaray");
  store.toggleMatch({ id: "m-1", home: "A", away: "B" });
  check(storage.map.size >= 2, "depoda favoriler var");
  check(store.clearAll() === true, "clearAll başarılı");
  check(storage.map.size === 0, "sıfırlama: yeni anahtar ve iki eski anahtar tamamen silinir (geride kişisel veri kalmaz)");
  check(store.getState().teams.length === 0 && store.getState().matches.length === 0, "sıfırlamadan sonra durum boş");
  check(events.length >= 3 && events[events.length - 1].teams.length === 0, "her değişiklikte olay yayınlanır (başka bileşenler güncellenir)");
}

// 7. Depo kapalı/dolu: sessizce çalışır
{
  const readonly = make(memoryStorage({}, { failWrites: true }));
  check(readonly.setPrimaryTeam("galatasaray") === false, "yazma reddedilirse (gizli sekme/kota) false döner, hata fırlatmaz");
  const unreadable = make(memoryStorage({}, { failReads: true }));
  check(unreadable.getState().teams.length === 0 && unreadable.primaryTeam() === "", "okuma reddedilirse boş durum, hata yok");
  const none = core.createStore({});
  check(none.getState().teams.length === 0 && none.clearAll() === false, "depo yoksa (null) güvenle boş çalışır");
}

// 8. Paylaşım bağlantıları
{
  const links = core.shareLinks({ home: "Galatasaray", away: "Fenerbahçe", href: "/mac/galatasaray-fenerbahce-2026-12-05.html" }, "https://www.futbolradar.com");
  check(links.url === "https://www.futbolradar.com/mac/galatasaray-fenerbahce-2026-12-05.html", "paylaşım bağlantısı doğru maç sayfasına gider (mutlak adres)");
  check(links.title === "Galatasaray – Fenerbahçe | FutbolRadar", "paylaşım başlığı maçı adlandırır");
  check(links.whatsapp.startsWith("https://wa.me/?text=") && decodeURIComponent(links.whatsapp).includes(links.url), "WhatsApp bağlantısı başlık + adresi taşır");
  check(links.x.startsWith("https://x.com/intent/post?") && decodeURIComponent(links.x).includes(links.url), "X bağlantısı başlık + adresi taşır");
  const evil = core.shareLinks({ home: "A", away: "B", href: "javascript:alert(1)" }, "https://www.futbolradar.com");
  check(evil.url === "https://www.futbolradar.com/", "tehlikeli bağlantı paylaşılmaz (ana sayfaya düşer)");
  const other = core.shareLinks({ home: "A", away: "B", href: "https://evil.example/x" }, "https://www.futbolradar.com");
  check(other.url === "https://www.futbolradar.com/", "başka alan adı paylaşılmaz");
}

if (failures) { console.error(`favorites-core: ${failures} hata`); process.exit(1); }
console.log("favorites-core: tamam");
