#!/usr/bin/env node
/**
 * Süper Lig takımlarının maç takvimini canlı bir kaynaktan tazeler.
 *
 * Neden ayrı bir dosya (data/fixture-calendar.json)?
 * data/matches.json elle doğrulanan, analiz taşıyan editoryal veri seti;
 * maç analizi üretici ve sayfa üretici doğrudan onu okuyor. Sağlayıcıdan
 * gelen ham fikstür satırlarını oraya yazmak, doğrulanmamış kayıtların
 * analiz/sayfa üretimine sızması demek olurdu. Bu yüzden sağlayıcı takvimi
 * kendi dosyasında durur; API katmanı iki kaynağı okuma anında birleştirir
 * ve çakışmada her zaman elle doğrulanmış kayıt kazanır.
 *
 * Kaynak: TheSportsDB v1. Ücretsiz/anahtarsız çalışır (THESPORTSDB_API_KEY
 * ile yükseltilebilir), API-Football'un ücretsiz paketinin aksine içinde
 * bulunulan sezona erişimi vardır. Takım başına eventsnext/eventslast
 * çağrılır; gün bazlı uç nokta ücretsiz katmanda eksik sonuç döndürüyor.
 *
 * Kullanım:
 *   node scripts/sync-fixture-calendar.mjs           # dry-run, sadece rapor
 *   node scripts/sync-fixture-calendar.mjs --apply   # dosyaya yaz
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { findCompetition, normalizeKey } = require("../services/competitionCatalog.js");

const root = process.cwd();
const OUTPUT_PATH = path.join(root, "data", "fixture-calendar.json");
const API_KEY = process.env.THESPORTSDB_API_KEY || "3";
const API_ROOT = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const APPLY = process.argv.includes("--apply");
// Ücretsiz katman dakikada ~30 istek kabul ediyor; 36 istek bu aralıkla
// limitin altında kalır. Daha hızlı gitmek yarısı boş dönen bir takvim
// üretiyordu.
const REQUEST_GAP_MS = 2100;
const REQUEST_TIMEOUT_MS = 12000;
const REQUEST_RETRIES = 2;
// Yalnızca yakın pencere tutulur: geçmiş sonuçlar için canlı skor/biten maç
// listesi, ileri için fikstür. Sınırsız büyüyen bir takvim dosyası hem
// gereksiz hem de bayatlama riski.
const PAST_WINDOW_DAYS = 3;
// 35 gün, sezon açılışını her koşulda kapsar. Daha dar bir pencere (21 gün)
// temmuz sonunda 16 Ağustos'taki ilk hafta maçlarını dışarıda bırakıyor ve
// o tarihe giden kullanıcı, veri elimizdeyken boş liste görüyordu. Pencereyi
// genişletmek ek istek maliyeti getirmiyor: sağlayıcıdan takım başına gelen
// olaylar zaten tek çağrıda çekiliyor, fark yalnızca kaçının saklandığı.
const FUTURE_WINDOW_DAYS = 35;

/**
 * TheSportsDB takım kimlikleri. Bir kere çözülüp sabitlendi: her koşuda 18
 * ek arama isteği atmak ücretsiz katmanın hız sınırını gereksiz zorlar.
 * `providerName`, sağlayıcının yazımını sitenin kanonik takım adına
 * eşlemek için var (ör. "İstanbul Başakşehir" -> "Başakşehir").
 */
const TRACKED_TEAMS = [
  { id: "133804", name: "Galatasaray" },
  { id: "133807", name: "Fenerbahçe" },
  { id: "133794", name: "Beşiktaş" },
  { id: "133796", name: "Trabzonspor" },
  { id: "133797", name: "Samsunspor" },
  { id: "134589", name: "Başakşehir", providerName: "İstanbul Başakşehir" },
  { id: "133870", name: "Kocaelispor" },
  { id: "138977", name: "Eyüpspor" },
  { id: "133834", name: "Kasımpaşa" },
  { id: "133885", name: "Çaykur Rizespor", providerName: "Rizespor" },
  { id: "138951", name: "Çorum FK", providerName: "Çorum" },
  { id: "135891", name: "Göztepe" },
  { id: "133835", name: "Konyaspor" },
  { id: "133798", name: "Gençlerbirliği" },
  { id: "138092", name: "Gaziantep FK", providerName: "Gaziantep" },
  { id: "138959", name: "Amed Sportif Faaliyetler", providerName: "Amed" },
  { id: "134272", name: "Erzurumspor FK", providerName: "Erzurumspor" },
  { id: "135676", name: "Alanyaspor" }
];

const TEAM_NAME_BY_PROVIDER = new Map(
  TRACKED_TEAMS.map((team) => [normalizeKey(team.providerName || team.name), team.name])
);

function canonicalTeamName(providerName) {
  return TEAM_NAME_BY_PROVIDER.get(normalizeKey(providerName)) || String(providerName || "").trim();
}

function slug(value) {
  return normalizeKey(value);
}

function istanbulDateOnly(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function istanbulParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

/**
 * TheSportsDB `strTimestamp` UTC'dir. Site tamamen TSİ üzerinden çalıştığı
 * için burada +03:00 ofsetli ISO değerine çevrilir; böylece hem API hem de
 * önyüz tarih karşılaştırmaları (ilk 10 karakter) doğru güne düşer.
 */
function toIstanbulIso(timestamp) {
  const parsed = new Date(`${String(timestamp).replace(" ", "T").replace(/Z?$/, "")}Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const { date, time } = istanbulParts(parsed);
  return { iso: `${date}T${time}:00+03:00`, date, time };
}

const STATUS_MAP = new Map([
  ["NS", "SCHEDULED"],
  ["TBD", "SCHEDULED"],
  ["1H", "LIVE"],
  ["2H", "LIVE"],
  ["HT", "LIVE"],
  ["ET", "LIVE"],
  ["BT", "LIVE"],
  ["P", "LIVE"],
  ["LIVE", "LIVE"],
  ["FT", "FINISHED"],
  ["AET", "FINISHED"],
  ["PEN", "FINISHED"],
  ["MATCH FINISHED", "FINISHED"],
  ["PST", "POSTPONED"],
  ["CANC", "CANCELLED"],
  ["ABD", "CANCELLED"]
]);

function normalizeStatus(event) {
  const raw = String(event.strStatus || "").trim().toUpperCase();
  if (STATUS_MAP.has(raw)) {
    return STATUS_MAP.get(raw);
  }

  if (String(event.strPostponed || "").toLowerCase() === "yes") {
    return "POSTPONED";
  }

  const hasScore = event.intHomeScore !== null && event.intHomeScore !== undefined && event.intHomeScore !== "";
  return hasScore ? "FINISHED" : "SCHEDULED";
}

function scoreValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    try {
      return await fetchOnce(url);
    } catch (error) {
      lastError = error;
      // Hız limiti/geçici hata: artan bekleme ile tekrar dene.
      await sleep(REQUEST_GAP_MS * (attempt + 1));
    }
  }

  throw lastError;
}

function normalizeEvent(event) {
  const competition = findCompetition(event.strLeague);
  // Katalog dışı turnuvalar (alt ligler, kupa test ligleri) editoryal
  // kapsam dışı; tahmin yürütmek yerine atlanır.
  if (!competition) {
    return null;
  }

  const stamp = toIstanbulIso(event.strTimestamp || `${event.dateEvent}T${event.strTime || "00:00:00"}`);
  if (!stamp) {
    return null;
  }

  const homeTeam = canonicalTeamName(event.strHomeTeam);
  const awayTeam = canonicalTeamName(event.strAwayTeam);
  if (!homeTeam || !awayTeam) {
    return null;
  }

  return {
    id: `${slug(homeTeam)}-${slug(awayTeam)}-${stamp.date}`,
    // Kimlik hem eski alanda (geriye dönük uyumluluk) hem de isim alanlı
    // haritada tutulur. İsim alanı şart: bu bir TheSportsDB olay numarası ve
    // API-Football fixture id'si sanılıp o sağlayıcıya gönderilirse istek
    // sessizce boşa gider.
    providerId: String(event.idEvent || ""),
    providerIds: event.idEvent ? { theSportsDb: String(event.idEvent) } : {},
    competitionId: competition.id,
    league: competition.name,
    kickoff: stamp.iso,
    time: stamp.time,
    venue: event.strVenue || null,
    homeTeam,
    awayTeam,
    status: normalizeStatus(event),
    score: {
      home: scoreValue(event.intHomeScore),
      away: scoreValue(event.intAwayScore)
    },
    round: event.intRound ? Number(event.intRound) || null : null,
    dataStatus: "provider",
    source: "thesportsdb",
    sourceUrls: event.idEvent ? [`https://www.thesportsdb.com/event/${event.idEvent}`] : []
  };
}

function withinWindow(match, today) {
  const start = new Date(`${today}T00:00:00+03:00`);
  const matchDate = new Date(`${String(match.kickoff).slice(0, 10)}T00:00:00+03:00`);
  const diffDays = Math.round((matchDate.getTime() - start.getTime()) / 86400000);
  return diffDays >= -PAST_WINDOW_DAYS && diffDays <= FUTURE_WINDOW_DAYS;
}

async function collectMatches() {
  const collected = new Map();
  const failures = [];

  for (const team of TRACKED_TEAMS) {
    for (const endpoint of ["eventsnext", "eventslast"]) {
      try {
        const payload = await fetchJson(`${API_ROOT}/${endpoint}.php?id=${team.id}`);
        const events = payload.events || payload.results || [];
        for (const event of events) {
          const normalized = normalizeEvent(event);
          if (normalized) {
            // Aynı maç iki takımın da beslemesinden gelir; sağlayıcı
            // kimliği olan kayıt tercih edilir, sonra ilk gelen kalır.
            const existing = collected.get(normalized.id);
            if (!existing || (!existing.providerId && normalized.providerId)) {
              collected.set(normalized.id, normalized);
            }
          }
        }
      } catch (error) {
        failures.push(`${team.name}/${endpoint}: ${error.message}`);
      }
      await sleep(REQUEST_GAP_MS);
    }
  }

  return { matches: [...collected.values()], failures };
}

async function main() {
  const today = istanbulDateOnly(new Date());
  const { matches, failures } = await collectMatches();

  // Boş çekim koruması: sağlayıcı tümüyle sessizse mevcut takvimi silmek
  // yerine hiçbir şey yapmadan çıkılır.
  if (!matches.length) {
    console.error(`Fixture calendar sync aborted: no usable events returned (${failures.length} request failures).`);
    if (failures.length) {
      console.error(failures.slice(0, 5).join("\n"));
    }
    process.exitCode = failures.length ? 1 : 0;
    return;
  }

  const windowed = matches
    .filter((match) => withinWindow(match, today))
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));

  const previous = fs.existsSync(OUTPUT_PATH)
    ? JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"))
    : { matches: [] };
  const previousCount = Array.isArray(previous.matches) ? previous.matches.length : 0;

  // Sayı düşüşü koruması: sağlayıcı kısmi cevap verdiyse (ör. hız limiti)
  // dolu bir takvimi yarısına indirmek yerine mevcut dosya korunur.
  if (previousCount >= 6 && windowed.length < previousCount * 0.5) {
    console.error(
      `Fixture calendar sync aborted: provider returned ${windowed.length} matches vs ${previousCount} stored (>50% drop).`
    );
    process.exitCode = 1;
    return;
  }

  const output = {
    source: "TheSportsDB",
    provider: "thesportsdb",
    fetchedAt: new Date().toISOString(),
    windowDays: { past: PAST_WINDOW_DAYS, future: FUTURE_WINDOW_DAYS },
    teamCount: TRACKED_TEAMS.length,
    requestFailures: failures.length,
    matches: windowed
  };

  const todayCount = windowed.filter((match) => String(match.kickoff).slice(0, 10) === today).length;
  console.log(
    `Fixture calendar: ${windowed.length} matches in window (${todayCount} today, ${failures.length} request failures).`
  );

  if (!APPLY) {
    console.log("Dry run - use --apply to write data/fixture-calendar.json");
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, OUTPUT_PATH)}`);
}

await main();
