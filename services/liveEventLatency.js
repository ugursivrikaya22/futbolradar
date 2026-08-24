/**
 * CANLI SKOR VERİ HATTI — UÇTAN UCA GECİKME ÖLÇÜMÜ.
 *
 * NEDEN BU DOSYA VAR. Sitenin canlı skor hattı beş ayrı katmandan geçiyor:
 *
 *   1. Sağlayıcı (API-Football)  → maçın kaçıncı dakikasında ne olduğunu bilir.
 *   2. Bizim çekmemiz (fetch)    → `/api/matches?live=all` veya
 *                                  `/api/match-detail` isteği sağlayıcıya gider.
 *   3. Kütüğe yazma (db write)   → bu satırın kalıcı depoya (Supabase) düştüğü an.
 *   4. API yanıtı (api response) → istemciye gönderdiğimiz JSON'ın zaman damgası.
 *   5. Ekrana düşme (render)     → tarayıcının DOM'u güncellediği an.
 *
 * Bu beş anın hiçbiri tek bir yerde toplanmıyordu; "canlı skor kaç saniye
 * gecikiyor" sorusunun cevabı yoktu, yalnızca "veri ne kadar bayat"
 * (services/dataFreshness.js) ve "senkron ne zaman koştu"
 * (services/pipelineDiagnostics.js) biliniyordu. Bu modül GOL olayları için
 * beşini de tek satırda toplar.
 *
 * SAĞLAYICI ZAMAN DAMGASI YOK — TAHMİN EDİLİR, UYDURULMAZ.
 *
 * API-Football gol olayı için mutlak saat vermiyor, yalnızca maçın kaçıncı
 * dakikası (`elapsed`/`extra`, örn. "45+2"). `estimateProviderTime()` bu
 * yüzden kickoff + dakika toplayarak bir TAHMİN üretir; gerçek golün hangi
 * saniyede atıldığını değil, "sağlayıcının dakika bilgisine göre olması
 * gereken saat"i söyler. Her yerde `estimated`/`tahmini` etiketiyle geçer —
 * `first_seen_at` (bizim gerçekten gördüğümüz an) ile karıştırılmamalı.
 *
 * DEPO: SUPABASE, GERİ DÜŞÜŞ BELLEK-İÇİ.
 *
 * Üretimde Supabase yapılandırılıyken satır oraya yazılır (services/
 * supabase/client.js, PostgREST). Yapılandırılmadığında (yerel geliştirme,
 * bu depodaki sandbox gibi) ya da geçici bir Supabase hatasında modül
 * SESSİZCE BAŞARISIZ OLMAZ: bellek-içi halka arabelleğe düşer VE her
 * durumda `[futbolradar:live-latency]` etiketiyle konsola tek satır yazar
 * — üretimdeki sunucu kütüğü Supabase olmadan da okunabilir kalır. Bellek-içi
 * yol yalnızca SICAK bir işlev örneği içinde kalıcıdır; çoklu örnek/soğuk
 * başlangıçta paylaşılmaz, bu yüzden tek kaynak olarak GÜVENİLMEZ — üretim
 * ölçümü Supabase'e bağlıdır.
 */

const { createRequire } = require("module");
const require_ = createRequire(__filename);
const supabaseEnv = require("./supabase/env.js");

const TABLE = "live_event_latency";
const MEMORY_LIMIT_PER_MATCH = 200;

/** Bellek-içi geri düşüş — anahtar: event_key. Tek sıcak örnekte kalıcı. */
const memoryStore = new Map();

function nowIso() {
  return new Date().toISOString();
}

/**
 * Sağlayıcının "45+2" biçimindeki dakika metnini toplam dakikaya çevirir.
 * Uzatma bölümü göz ardı edilmez: 90+3 gerçek zamanda 90. dakikadan sonra
 * gelir, `90` dönmek tahmini üç dakika erken gösterirdi.
 */
function parseElapsedMinutes(minuteLabel) {
  const match = String(minuteLabel || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!match) return null;
  const base = Number(match[1]);
  const extra = match[2] ? Number(match[2]) : 0;
  return Number.isFinite(base) ? base + extra : null;
}

/**
 * Kickoff + dakika = tahmini sağlayıcı zamanı. `kickoffIso` yoksa ya da
 * dakika okunamıyorsa `null` döner — boş alanı sıfırla ya da kickoff'un
 * kendisiyle doldurmak, "bu golün saatini biliyoruz" yanlış izlenimini
 * verirdi.
 */
function estimateProviderTime(kickoffIso, minuteLabel) {
  const minutes = parseElapsedMinutes(minuteLabel);
  const kickoffMs = kickoffIso ? Date.parse(kickoffIso) : NaN;
  if (minutes === null || !Number.isFinite(kickoffMs)) return null;
  return new Date(kickoffMs + minutes * 60000).toISOString();
}

/**
 * Normalleştirilmiş olay listesinden (services/providers/apiFootballProvider.js
 * `normalizeFixtureEvents`) GERÇEK golleri seçer. API-Football sözlüğüne
 * göre: `type === "Goal"`, ama `detail === "Missed Penalty"` bir gol
 * DEĞİLDİR — kaçırılan penaltı da "Goal" türünde gelir, skor değiştirmez.
 * İstemcideki `mdEventKind` (app.js) serbest metin arıyor ve mock/gerçek
 * sağlayıcı arasında dil farkına duyarlı; bu fonksiyon sağlayıcının
 * belgelenmiş İngilizce sözlüğüne karşı çalışır, ekran sınıflandırmasından
 * bağımsızdır.
 */
function classifyGoalEvents(events) {
  return (Array.isArray(events) ? events : []).filter((event) => {
    const type = String((event && event.type) || "").trim().toLowerCase();
    const detail = String((event && event.detail) || "").trim().toLowerCase();
    return type === "goal" && detail !== "missed penalty";
  });
}

function playerNameOf(event) {
  // normalizeFixtureEvents `value`yi "Oyuncu · Asist: ... · Detay" diye
  // birleştiriyor; ilk parça her zaman oyuncu adı.
  const value = String((event && event.value) || "");
  const first = value.split("·")[0].trim();
  return first || null;
}

function teamSideOf(event, homeTeam, awayTeam) {
  const teamName = String((event && event.team && event.team.name) || "").trim().toLocaleLowerCase("tr");
  if (!teamName) return null;
  if (homeTeam && teamName === String(homeTeam).trim().toLocaleLowerCase("tr")) return "home";
  if (awayTeam && teamName === String(awayTeam).trim().toLocaleLowerCase("tr")) return "away";
  return null;
}

/**
 * Aynı golün iki yoklamada iki kez loglanmaması için tekil anahtar.
 * Sağlayıcı bir olay kimliği vermiyor; maç + takım + oyuncu + dakika +
 * tür birleşimi pratikte tekildir (aynı oyuncu aynı dakikada iki gol
 * atamaz).
 */
function computeEventKey(matchId, event, homeTeam, awayTeam) {
  const side = teamSideOf(event, homeTeam, awayTeam) || "unknown";
  const player = (playerNameOf(event) || "bilinmiyor").toLocaleLowerCase("tr");
  const minute = String((event && event.time) || "").replace(/'/g, "");
  return `${matchId}::goal::${side}::${player}::${minute}`;
}

function memoryListFor(matchId) {
  if (!memoryStore.has(matchId)) memoryStore.set(matchId, new Map());
  return memoryStore.get(matchId);
}

/** Sıcak örnek uzun bir maç boyunca canlı kalırsa arabellek sınırsız büyümesin. */
function trimMemory(matchId) {
  const bucket = memoryListFor(matchId);
  if (bucket.size <= MEMORY_LIMIT_PER_MATCH) return;
  const oldestFirst = Array.from(bucket.entries())
    .sort((left, right) => Date.parse(left[1].firstSeenAt) - Date.parse(right[1].firstSeenAt));
  for (const [key] of oldestFirst.slice(0, bucket.size - MEMORY_LIMIT_PER_MATCH)) {
    bucket.delete(key);
  }
}

function logLine(record) {
  const fetchToDb = record.dbWrittenAt && record.firstSeenAt
    ? Date.parse(record.dbWrittenAt) - Date.parse(record.firstSeenAt)
    : null;
  console.log(
    `[futbolradar:live-latency] match=${record.matchId} event=${record.eventKey} ` +
    `store=${record.store} minute=${record.providerElapsedMinute} ` +
    `firstSeenAt=${record.firstSeenAt} dbWrittenAt=${record.dbWrittenAt} ` +
    `fetchToDbMs=${fetchToDb === null ? "n/a" : fetchToDb}`
  );
}

/**
 * Yeni gözlemlenen gol olaylarını kütüğe yazar. Zaten bilinen bir
 * `eventKey` yeniden yazılmaz (aynı golü her yoklamada tekrar loglamak,
 * "ilk gördüğümüz an" ölçümünü anlamsızlaştırırdı) — bunun için önce
 * `listRecent` ile bilinen anahtarlar okunur, ÇAĞIRAN bu diff'i yapar
 * (bkz. api/live-latency.js); bu fonksiyon yalnızca kendisine verilen
 * olayları yazar.
 *
 * `firstSeenAt` ÇAĞIRANDAN gelir: sağlayıcıya isteğin GÖNDERİLDİĞİ an,
 * bu modülün kendi `Date.now()`u değil — ölçüm ağ gecikmesini de
 * kapsasın diye.
 */
async function recordObservedGoals({ matchId, kickoff, homeTeam, awayTeam, events, firstSeenAt }) {
  const goals = classifyGoalEvents(events);
  const stampedFirstSeenAt = firstSeenAt || nowIso();
  const configured = supabaseEnv.isConfigured();
  const client = configured ? require_("./supabase/client.js") : null;

  const results = [];
  for (const event of goals) {
    const eventKey = computeEventKey(matchId, event, homeTeam, awayTeam);
    const record = {
      matchId,
      eventKey,
      eventKind: "goal",
      teamSide: teamSideOf(event, homeTeam, awayTeam),
      playerName: playerNameOf(event),
      providerElapsedMinute: String(event.time || ""),
      providerTimeEstimated: estimateProviderTime(kickoff, event.time),
      firstSeenAt: stampedFirstSeenAt
    };

    const writeStart = Date.now();
    let store = "memory";

    if (client) {
      try {
        await client.upsert(TABLE, [{
          match_id: record.matchId,
          event_key: record.eventKey,
          event_kind: record.eventKind,
          team_side: record.teamSide,
          player_name: record.playerName,
          provider_elapsed_minute: record.providerElapsedMinute,
          provider_time_estimated: record.providerTimeEstimated,
          first_seen_at: record.firstSeenAt,
          db_written_at: nowIso()
        }], "event_key");
        store = "supabase";
      } catch (error) {
        // Supabase yazımı başarısız olsa da ölçüm kaybolmaz: bellek-içi
        // yola düşer. Aynı "gerekli değil" ilkesi run-scheduled-update.mjs
        // supabase-sync adımında da geçerli.
        console.warn(`[futbolradar:live-latency] supabase-write-failed match=${matchId} event=${eventKey}: ${error.message}`);
      }
    }

    const dbWrittenAt = nowIso();
    const dbWriteDurationMs = Date.now() - writeStart;
    const finalRecord = { ...record, dbWrittenAt, apiResponseAt: null, clientRenderedAt: null, store, dbWriteDurationMs };

    if (store === "memory") {
      memoryListFor(matchId).set(eventKey, finalRecord);
      trimMemory(matchId);
    }

    logLine(finalRecord);
    results.push(finalRecord);
  }

  return results;
}

/**
 * Bir maçın bilinen gol kayıtlarını döndürür (en yeni önce). Supabase
 * yapılandırılıysa oradan okunur; değilse bu sıcak örneğin bellek-içi
 * arabelleğinden — bkz. dosya başlığındaki "tek kaynak olarak
 * güvenilmez" notu.
 */
async function listRecent({ matchId, limit = 50 } = {}) {
  if (!matchId) return [];

  if (supabaseEnv.isConfigured()) {
    try {
      const client = require_("./supabase/client.js");
      const rows = await client.select(TABLE, {
        filters: { match_id: `eq.${matchId}` },
        order: "first_seen_at.desc",
        limit
      });
      return rows.map((row) => ({
        matchId: row.match_id,
        eventKey: row.event_key,
        eventKind: row.event_kind,
        teamSide: row.team_side,
        playerName: row.player_name,
        providerElapsedMinute: row.provider_elapsed_minute,
        providerTimeEstimated: row.provider_time_estimated,
        firstSeenAt: row.first_seen_at,
        dbWrittenAt: row.db_written_at,
        apiResponseAt: row.api_response_at,
        clientRenderedAt: row.client_rendered_at,
        store: "supabase"
      }));
    } catch (error) {
      console.warn(`[futbolradar:live-latency] supabase-read-failed match=${matchId}: ${error.message}`);
      // Okuma başarısızsa bellek-içi yola düş — aşağıda devam eder.
    }
  }

  const memory = Array.from(memoryListFor(matchId).values());
  return memory
    .sort((left, right) => Date.parse(right.firstSeenAt) - Date.parse(left.firstSeenAt))
    .slice(0, limit);
}

/**
 * BİRDEN FAZLA MAÇIN bilinen gol kayıtlarını TEK sorguda döner.
 *
 * `listRecent` tek maça bakıyor; günlük sağlık kontrolü (services/
 * dailyHealthCheckService.js) "son bir-iki günün genel gecikmesi nedir"
 * sorusunu soruyor ve bunun için maç başına ayrı istek atmak (onlarca maç
 * olabilir) gereksiz ağ turu demek. Supabase yapılandırılıysa PostgREST'in
 * `in.(...)` operatörüyle TEK istekte çekilir; değilse bellek-içi
 * arabellekler (yalnızca bu sıcak örnekte kalıcı) birleştirilir.
 */
async function listRecentAcrossMatches({ matchIds, limit = 500 } = {}) {
  const ids = Array.from(new Set((Array.isArray(matchIds) ? matchIds : []).map(String).filter(Boolean)));
  if (!ids.length) return [];

  if (supabaseEnv.isConfigured()) {
    try {
      const client = require_("./supabase/client.js");
      const rows = await client.select(TABLE, {
        filters: { match_id: `in.(${ids.join(",")})` },
        order: "first_seen_at.desc",
        limit
      });
      return rows.map((row) => ({
        matchId: row.match_id,
        eventKey: row.event_key,
        eventKind: row.event_kind,
        teamSide: row.team_side,
        playerName: row.player_name,
        providerElapsedMinute: row.provider_elapsed_minute,
        providerTimeEstimated: row.provider_time_estimated,
        firstSeenAt: row.first_seen_at,
        dbWrittenAt: row.db_written_at,
        apiResponseAt: row.api_response_at,
        clientRenderedAt: row.client_rendered_at,
        store: "supabase"
      }));
    } catch (error) {
      console.warn(`[futbolradar:live-latency] supabase-read-failed matches=${ids.length}: ${error.message}`);
      // Okuma başarısızsa bellek-içi yola düş — aşağıda devam eder.
    }
  }

  const combined = ids.flatMap((matchId) => Array.from(memoryListFor(matchId).values()));
  return combined
    .sort((left, right) => Date.parse(right.firstSeenAt) - Date.parse(left.firstSeenAt))
    .slice(0, limit);
}

/**
 * İstemcinin "ekrana bastım" işaretini aynı satıra yazar. Anahtar
 * bilinmiyorsa (ör. Supabase'e daha önce yazılamadıysa) `null` döner —
 * uydurma bir eşleşme aranmaz.
 */
async function markRendered({ eventKey, clientRenderedAt }) {
  if (!eventKey) return null;
  const stamped = clientRenderedAt || nowIso();

  if (supabaseEnv.isConfigured()) {
    try {
      const client = require_("./supabase/client.js");
      await client.upsert(TABLE, [{ event_key: eventKey, client_rendered_at: stamped }], "event_key");
      const [row] = await client.select(TABLE, { filters: { event_key: `eq.${eventKey}` }, limit: 1 });
      if (row) {
        return {
          matchId: row.match_id,
          eventKey: row.event_key,
          firstSeenAt: row.first_seen_at,
          dbWrittenAt: row.db_written_at,
          apiResponseAt: row.api_response_at,
          clientRenderedAt: row.client_rendered_at
        };
      }
    } catch (error) {
      console.warn(`[futbolradar:live-latency] supabase-render-mark-failed event=${eventKey}: ${error.message}`);
    }
  }

  for (const bucket of memoryStore.values()) {
    if (bucket.has(eventKey)) {
      const record = { ...bucket.get(eventKey), clientRenderedAt: stamped };
      bucket.set(eventKey, record);
      return record;
    }
  }

  return null;
}

/** Yanıt gönderilmeden hemen önce `api_response_at`ı loglanan satırlara işler. */
async function markApiResponded(records, apiResponseAt) {
  const stamped = apiResponseAt || nowIso();
  const withResponse = (Array.isArray(records) ? records : []).map((record) => ({ ...record, apiResponseAt: stamped }));

  if (supabaseEnv.isConfigured() && withResponse.length) {
    try {
      const client = require_("./supabase/client.js");
      await client.upsert(
        TABLE,
        withResponse.map((record) => ({ event_key: record.eventKey, api_response_at: stamped })),
        "event_key"
      );
    } catch (error) {
      console.warn(`[futbolradar:live-latency] supabase-api-stamp-failed: ${error.message}`);
    }
  }

  for (const record of withResponse) {
    const bucket = memoryListFor(record.matchId);
    if (bucket.has(record.eventKey)) {
      bucket.set(record.eventKey, { ...bucket.get(record.eventKey), apiResponseAt: stamped });
    }
  }

  return withResponse;
}

module.exports = {
  MEMORY_LIMIT_PER_MATCH,
  classifyGoalEvents,
  computeEventKey,
  estimateProviderTime,
  listRecent,
  listRecentAcrossMatches,
  markApiResponded,
  markRendered,
  parseElapsedMinutes,
  playerNameOf,
  recordObservedGoals,
  teamSideOf
};
