/**
 * Tek seferlik, izinli resmi sayfa okuması.
 * LaLiga oyuncu sayfası: kilo, 2026/27 başarılı dribling, top kaybı.
 * Bundesliga oyuncu sayfası: kilo.
 * Sayı yoksa veya sayfa oyuncuyla eşleşmezse alan null kalır.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dir = path.join(root, "data", "comparison-module", "players");
const retrievedAt = "2026-11-15";
const ua = "Mozilla/5.0 (compatible; FutbolRadarEditorial/1.0; +https://www.futbolradar.com)";

function slugify(name) {
  const map = { ş: "s", Ş: "s", ğ: "g", Ğ: "g", ü: "u", Ü: "u", ö: "o", Ö: "o", ç: "c", Ç: "c", ı: "i", İ: "i", â: "a", î: "i", û: "u", ă: "a" };
  const folded = String(name || "").replace(/[şŞğĞüÜöÖçÇıİâîûă]/g, (ch) => map[ch] || ch);
  return folded.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function lastToken(name) {
  const parts = slugify(name).split("-").filter(Boolean);
  return parts[parts.length - 1] || "";
}

async function getHtml(url) {
  const response = await fetch(url, { headers: { "User-Agent": ua, Accept: "text/html" }, redirect: "follow" });
  const html = await response.text();
  return { status: response.status, html, finalUrl: response.url };
}

const PAGE_SLUG = {
  "vinicius-junior": "vini-jr"
};
const NAME_HINT = {
  pedri: "pedri",
  raphinha: "raphinha",
  "vinicius-junior": "vinicius"
};

function matchesPlayer(html, player) {
  const title = (html.match(/<title>([^<]+)/i) || ["", ""])[1];
  const token = lastToken(player.name);
  if (token.length > 2 && slugify(title).includes(token)) return true;
  const hint = NAME_HINT[player.slug];
  return Boolean(hint && slugify(html).includes(hint) && /successful_dribbles|WEIGHT/.test(html));
}

function parseLaLiga(html) {
  if (!/2026\/27|Season[\s\S]{0,40}2026/i.test(html)) return null;
  const unique = (values) => [...new Set(values)];
  const weights = unique([...html.matchAll(/WEIGHT[\s\S]{0,500}?(\d{2,3})\s*kg/gi)].map((match) => Number(match[1])));
  const dribbles = unique([...html.matchAll(/"name":"successful_dribbles","stat":(\d+)/g)].map((match) => Number(match[1])));
  const losses = unique([...html.matchAll(/"name":"total_losses_of_possession","stat":(\d+)/g)].map((match) => Number(match[1])));
  return {
    weightKg: weights.length === 1 ? weights[0] : null,
    dribbles: dribbles.length === 1 ? dribbles[0] : null,
    dispossessed: losses.length === 1 ? losses[0] : null
  };
}

function parseBundesliga(html) {
  const weights = [...html.matchAll(/"weight"\s*:\s*(\d{2,3})/g)].map((match) => Number(match[1]));
  const unique = [...new Set(weights)];
  return { weightKg: unique.length === 1 ? unique[0] : null };
}

const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
const report = [];
for (const file of files) {
  const full = path.join(dir, file);
  const player = JSON.parse(fs.readFileSync(full, "utf8"));
  const league = player.identity?.league || "";
  let target = null;
  if (/laliga/i.test(league)) {
    target = { kind: "laliga", url: `https://www.laliga.com/en-GB/player/${PAGE_SLUG[player.slug] || player.slug}` };
  } else if (/bundesliga/i.test(league)) {
    target = { kind: "bundesliga", url: `https://www.bundesliga.com/en/bundesliga/player/${player.slug}` };
  } else {
    continue;
  }
  const page = await getHtml(target.url);
  const row = { slug: player.slug, url: target.url, status: page.status, filled: [] };
  if (page.status !== 200 || !matchesPlayer(page.html, player)) {
    row.skipped = page.status !== 200 ? `http ${page.status}` : "isim eşleşmedi";
    report.push(row);
    await new Promise((resolve) => setTimeout(resolve, 250));
    continue;
  }
  if (target.kind === "laliga") {
    const parsed = parseLaLiga(page.html);
    if (parsed?.weightKg != null) {
      player.identity.weightKg = parsed.weightKg;
      player.identity.weightSourceUrl = target.url;
      player.identity.weightSourceLabel = "Kilo (LaLiga oyuncu sayfası, 2026/27)";
      player.identity.weightRetrievedAt = retrievedAt;
      row.filled.push(`kilo ${parsed.weightKg}`);
    }
    if (parsed?.dribbles != null) {
      player.technical.dribbles = parsed.dribbles;
      player.technical.dribblesScope = "LaLiga 2026/27 başarılı dribling";
      row.filled.push(`dribling ${parsed.dribbles}`);
    }
    if (parsed?.dispossessed != null) {
      player.technical.dispossessed = parsed.dispossessed;
      player.technical.dispossessedScope = "LaLiga 2026/27 top kaybı";
      row.filled.push(`top kaybı ${parsed.dispossessed}`);
    }
    if (row.filled.length) {
      player.technical.officialSourceUrl = target.url;
      player.technical.officialRetrievedAt = retrievedAt;
    }
  } else {
    const parsed = parseBundesliga(page.html);
    if (parsed.weightKg != null) {
      player.identity.weightKg = parsed.weightKg;
      player.identity.weightSourceUrl = target.url;
      player.identity.weightSourceLabel = "Kilo (Bundesliga oyuncu sayfası)";
      player.identity.weightRetrievedAt = retrievedAt;
      row.filled.push(`kilo ${parsed.weightKg}`);
    }
  }
  if (row.filled.length) fs.writeFileSync(full, `${JSON.stringify(player)}\n`);
  report.push(row);
  console.log(`${player.slug}: ${row.filled.join(", ") || row.skipped || "boş"}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const attemptPath = path.join(root, "data", "comparison-module", "source-attempts.json");
const attempts = {
  retrievedAt,
  note: "Ulaşılamayan veya sayı yayınlamayan kaynaklar. Bu alanlar null bırakıldı.",
  attempts: [
    { source: "Understat", url: "https://understat.com/league/EPL/2026", result: "Site 'We will come back soon' sayfası döndü. playersData yok. xG/xA alınamadı." },
    { source: "UEFA.com", url: "https://www.uefa.com/uefachampionsleague/statistics/players/", result: "Oyuncu listesi kabuğu 200 döndü, oyuncu bazında xG/xA sayısı yoktu." },
    { source: "Premier League", url: "https://www.premierleague.com/players/4986/Erling-Haaland/stats", result: "403. İstatistik alınamadı." },
    { source: "FBref", result: "Cloudflare engeli. Koruma aşılmadı, sayı alınmadı." },
    { source: "LaLiga", url: "https://www.laliga.com/en-GB/player/{slug}", result: "Oyuncu sayfasında kilo, successful_dribbles ve total_losses_of_possession bulunduysa yazıldı. xG alanı yoktu." },
    { source: "Bundesliga", url: "https://www.bundesliga.com/en/bundesliga/player/{slug}", result: "Yapısal bio.weight yazıldı. xG etiketi vardı, oyuncuya ait tek sayı yoktu; düz yazıdaki dribling cümlesi kullanılmadı." }
  ],
  pages: report
};
fs.writeFileSync(attemptPath, `${JSON.stringify(attempts, null, 2)}\n`);
console.log(`backfill done: ${report.filter((row) => row.filled?.length).length} sayfa doldu, ${report.length} denendi`);
