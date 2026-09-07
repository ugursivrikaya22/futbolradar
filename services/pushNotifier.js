/**
 * FAVORİ TAKIM PUSH BİLDİRİMİ — GOL VE MAÇ BAŞI.
 *
 * `services/liveScoreStream.js`teki `LiveScoreHub`, her yoklamada önceki
 * anlık görüntüyle yenisini karşılaştırıp (`detectMatchEvents`) gol ve maç
 * başı olaylarını burada tanımlı `notifyMatchEvents`e iletir
 * (`getLiveScoreHub` üzerinden bağlanır — bkz. o dosyadaki gerekçe).
 *
 * TAKIM EŞLEŞTİRMESİ İSİMLE YAPILIR, KİMLİKLE DEĞİL. Maç anlık görüntüsü
 * (`matchSnapshot`) yalnızca `homeTeam`/`awayTeam` görünen adını taşıyor,
 * sağlayıcı takım kimliğini değil — canlı skor hattı bu kimliği hiç
 * toplamıyor. `data/teams.json`daki `name` alanı aynı görünen adı
 * kullandığından (ör. "Fenerbahçe"), eşleştirme metin karşılaştırmasıyla
 * yapılıyor; 18 Süper Lig takımı için bu her zaman birebir örtüşür.
 *
 * YAPILANDIRILMAMIŞSA SESSİZCE HİÇBİR ŞEY GÖNDERMEZ. VAPID anahtarları ya
 * da abonelik deposu yoksa `notifyMatchEvents` erken döner — canlı skor
 * hattının kendisi bundan hiç etkilenmez (bkz. çağıran taraftaki
 * try/catch).
 */

const webPush = require("./webPush");
const pushSubscriptionStore = require("./pushSubscriptionStore");

function loadTeams() {
  try {
    return require("../data/teams.json");
  } catch (error) {
    return [];
  }
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("tr");
}

function slugForTeamName(teamName, teams) {
  const target = normalizeName(teamName);
  if (!target) return null;
  const match = (Array.isArray(teams) ? teams : []).find((team) => normalizeName(team && team.name) === target);
  return match ? String(match.id) : null;
}

function vapidConfig() {
  return {
    publicKey: String(process.env.VAPID_PUBLIC_KEY || "").trim(),
    privateKey: String(process.env.VAPID_PRIVATE_KEY || "").trim(),
    subject: String(process.env.VAPID_SUBJECT || "").trim()
  };
}

function isConfigured() {
  const vapid = vapidConfig();
  return Boolean(vapid.publicKey && vapid.privateKey && vapid.subject) && pushSubscriptionStore.isConfigured();
}

/**
 * Bildirim metni. Aynı payload hem golü atan hem rakip takımın
 * abonelerine gider (ikisi de "kendi maçları" için haber almak ister);
 * bu yüzden metin "kim attı"yı belirtir ama "sen kazandın/kaybettin"
 * demez.
 */
function buildPayload(event) {
  const { match, type, side } = event;
  const home = match.homeTeam || "";
  const away = match.awayTeam || "";
  const scoreHome = match.score && Number.isFinite(match.score.home) ? match.score.home : null;
  const scoreAway = match.score && Number.isFinite(match.score.away) ? match.score.away : null;
  const url = "/canli-skor.html";

  if (type === "kickoff") {
    return {
      title: "🟢 Maç başladı",
      body: `${home} - ${away} başladı.`,
      tag: `kickoff-${match.id}`,
      url
    };
  }

  if (type === "goal") {
    const scorer = side === "home" ? home : away;
    const scoreText = scoreHome !== null && scoreAway !== null ? `${scoreHome}-${scoreAway}` : "";
    const minuteText = match.minute ? ` · ${match.minute}'` : "";
    return {
      title: `⚽ GOL! ${scorer}`,
      body: `${home} ${scoreText} ${away}${minuteText}`.replace(/\s+/g, " ").trim(),
      tag: `goal-${match.id}-${scoreHome}-${scoreAway}`,
      url
    };
  }

  return null;
}

async function sendToSubscriber(subscriber, payload, vapid) {
  try {
    const result = await webPush.sendNotification(
      { endpoint: subscriber.endpoint, keys: { p256dh: subscriber.p256dh, auth: subscriber.auth } },
      payload,
      { vapidPublicKey: vapid.publicKey, vapidPrivateKey: vapid.privateKey, vapidSubject: vapid.subject }
    );
    if (result.expired) {
      await pushSubscriptionStore.removeSubscription(subscriber.endpoint);
    } else if (result.ok) {
      await pushSubscriptionStore.markSent(subscriber.endpoint);
    }
  } catch (error) {
    // Tek bir aboneye gönderim hatası (ağ, geçici 5xx) diğerlerini etkilemez
    // ve canlı skor hattını asla kesmez.
  }
}

/** `LiveScoreHub`in çağırdığı kanca. Bkz. `services/liveScoreStream.js` `onMatchEvents`. */
async function notifyMatchEvents(events) {
  if (!Array.isArray(events) || !events.length || !isConfigured()) return;

  const vapid = vapidConfig();
  const teams = loadTeams();

  for (const event of events) {
    const payload = buildPayload(event);
    if (!payload) continue;

    const slugs = [...new Set([
      slugForTeamName(event.match.homeTeam, teams),
      slugForTeamName(event.match.awayTeam, teams)
    ].filter(Boolean))];

    for (const slug of slugs) {
      let subscribers = [];
      try {
        subscribers = await pushSubscriptionStore.listByTeam(slug);
      } catch (error) {
        continue;
      }
      if (!subscribers.length) continue;
      await Promise.allSettled(subscribers.map((subscriber) => sendToSubscriber(subscriber, payload, vapid)));
    }
  }
}

module.exports = {
  buildPayload,
  isConfigured,
  notifyMatchEvents,
  slugForTeamName,
  vapidConfig
};
