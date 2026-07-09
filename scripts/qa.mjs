import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const pages = [
  "index.html",
  "puan-durumu.html",
  "takimlar.html",
  "oyuncu-radari.html",
  "oyuncu-karsilastir.html",
  "oyuncu-detay.html",
  "players/position/forvet.html",
  "players/league/super-lig.html",
  "canli-skor.html",
  "bugunun-maclari.html",
  "momentum.html",
  "analizler.html"
];
const endpoints = ["matches", "standings", "teams", "players", "momentum", "signals", "analyses", "health"];
const skipDirs = new Set([".git", ".agents", ".codex", "node_modules", "work", "outputs"]);
const failures = [];

function walk(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }

  return out;
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function checkJavaScriptSyntax() {
  for (const file of walk(root, (full) => full.endsWith(".js"))) {
    try {
      new Function(fs.readFileSync(file, "utf8"));
    } catch (error) {
      failures.push(`JS syntax failed: ${path.relative(root, file)}\n${error.message}`);
    }
  }
}

function checkJson() {
  for (const file of walk(path.join(root, "data"), (full) => full.endsWith(".json"))) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      failures.push(`JSON parse failed: ${path.relative(root, file)} ${error.message}`);
    }
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "site.webmanifest"), "utf8"));
    expect(manifest.name === "FutbolRadar", "manifest name mismatch");
    expect(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest icons missing");
  } catch (error) {
    failures.push(`manifest parse failed: ${error.message}`);
  }
}

function pageUrl(page) {
  return `https://www.futbolradar.com/${page === "index.html" ? "" : page}`;
}

function checkSeoAndLinks() {
  const titles = new Map();
  const descriptions = new Map();

  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
    const description = (html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) || [])[1] || "";
    const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i) || [])[1] || "";
    const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1] || "";
    const ogUrl = (html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i) || [])[1] || "";
    const ogImage = (html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) || [])[1] || "";
    const ogTitle = (html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || [])[1] || "";
    const ogDescription = (html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) || [])[1] || "";
    const twitterCard = (html.match(/<meta\s+name="twitter:card"\s+content="([^"]+)"/i) || [])[1] || "";
    const twitterTitle = (html.match(/<meta\s+name="twitter:title"\s+content="([^"]+)"/i) || [])[1] || "";
    const twitterDescription = (html.match(/<meta\s+name="twitter:description"\s+content="([^"]+)"/i) || [])[1] || "";
    const manifestHref = (html.match(/<link\s+rel="manifest"\s+href="([^"]+)"/i) || [])[1] || "";
    const expectedUrl = pageUrl(page);
    const pageDir = path.dirname(page);

    expect(Boolean(title), `${page}: missing title`);
    expect(Boolean(description), `${page}: missing meta description`);
    expect(canonical === expectedUrl, `${page}: canonical mismatch`);
    expect(ogUrl === expectedUrl, `${page}: og:url mismatch`);
    expect(ogImage === "https://www.futbolradar.com/assets/og-image.svg", `${page}: og:image mismatch`);
    expect(robots === "index,follow", `${page}: robots must be index,follow`);
    expect(Boolean(ogTitle), `${page}: missing og:title`);
    expect(Boolean(ogDescription), `${page}: missing og:description`);
    expect(twitterCard === "summary_large_image", `${page}: twitter card mismatch`);
    expect(twitterTitle === ogTitle, `${page}: twitter title should match og:title`);
    expect(twitterDescription === ogDescription, `${page}: twitter description should match og:description`);
    expect(Boolean(manifestHref), `${page}: missing manifest link`);

    if (title) titles.set(title, (titles.get(title) || 0) + 1);
    if (description) descriptions.set(description, (descriptions.get(description) || 0) + 1);

    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = match[1];
      if (/^(https?:|#|mailto:|tel:|data:)/.test(target)) {
        continue;
      }

      const cleanTarget = target.split("#")[0].split("?")[0];
      if (!cleanTarget) {
        continue;
      }

      const resolvedTarget = cleanTarget.startsWith("/")
        ? path.join(root, cleanTarget.replace(/^\/+/, ""))
        : path.resolve(root, pageDir, cleanTarget);
      expect(fs.existsSync(resolvedTarget), `${page}: missing local target ${target}`);
    }
  }

  for (const [title, count] of titles) {
    expect(count === 1, `duplicate title: ${title}`);
  }

  for (const [description, count] of descriptions) {
    expect(count === 1, `duplicate description: ${description}`);
  }

  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  for (const page of pages) {
    expect(sitemap.includes(`<loc>${pageUrl(page)}</loc>`), `sitemap missing ${pageUrl(page)}`);
  }

  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  expect(robots.includes("Sitemap: https://www.futbolradar.com/sitemap.xml"), "robots.txt missing sitemap URL");
  expect(fs.existsSync(path.join(root, "assets", "og-image.svg")), "missing assets/og-image.svg");
  expect(fs.existsSync(path.join(root, "public", "assets", "og-image.svg")), "missing public/assets/og-image.svg");
  expect(fs.existsSync(path.join(root, "site.webmanifest")), "missing site.webmanifest");
  expect(fs.existsSync(path.join(root, "public", "site.webmanifest")), "missing public/site.webmanifest");
}

async function callEndpoint(name, url = `/api/${name}`) {
  const moduleUrl = pathToFileURL(path.join(root, "api", `${name}.js`)).href;
  const { default: handler } = await import(`${moduleUrl}?qa=${Date.now()}-${Math.random()}`);
  let payload = null;
  const response = {
    headers: {},
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return body;
    },
    end(body) {
      payload = JSON.parse(body);
      return payload;
    }
  };

  await handler({ method: "GET", url, headers: {} }, response);
  return { payload, response };
}

async function checkApi() {
  for (const endpoint of endpoints) {
    const { payload, response } = await callEndpoint(endpoint);
    expect(response.statusCode === 200 || response.statusCode === undefined, `${endpoint}: non-200 status`);
    expect(payload && typeof payload.ok === "boolean", `${endpoint}: missing ok boolean`);
    expect(payload && payload.source, `${endpoint}: missing source`);
    expect(payload && payload.updatedAt, `${endpoint}: missing updatedAt`);
    expect(payload && Array.isArray(payload.data), `${endpoint}: data must be array`);
    expect(response.headers["cache-control"] === "public, max-age=0", `${endpoint}: browser cache header mismatch`);
    expect(
      response.headers["cdn-cache-control"] === "public, s-maxage=300, stale-while-revalidate=600",
      `${endpoint}: CDN cache header mismatch`
    );

    if (endpoint === "health") {
      const diagnostics = payload.data[0] || {};
      expect(["mock", "live-ready"].includes(diagnostics.mode), "health: mode mismatch");
      expect(Boolean(diagnostics.providerSource), "health: missing providerSource");
      expect(Boolean(diagnostics.nextAction), "health: missing nextAction");
      expect(Array.isArray(diagnostics.acceptedApiKeyEnvNames), "health: missing accepted API key env names");
      expect(Array.isArray(diagnostics.liveProviderResources), "health: missing live provider resources");
      expect(!JSON.stringify(diagnostics).includes("X-Auth-Token"), "health: should not expose auth header markers");
    }
  }

  const invalidDate = await callEndpoint("matches", "/api/matches?date=yanlis");
  expect(invalidDate.payload.ok === false, "matches invalid date should return ok:false");
  expect(invalidDate.payload.error?.code === "INVALID_DATE", "matches invalid date should return INVALID_DATE");

  const playersResponse = await callEndpoint("players");
  const playerFields = [
    "height",
    "weight",
    "age",
    "nationality",
    "team",
    "league",
    "position",
    "preferredFoot",
    "marketValue",
    "contractUntil",
    "appearances",
    "goals",
    "assists",
    "minutesPlayed",
    "yellowCards",
    "redCards",
    "passAccuracy",
    "shotsPerGame",
    "tacklesPerGame",
    "interceptionsPerGame",
    "rating",
    "providerId",
    "providerName",
    "lastSyncedAt"
  ];
  const firstPlayer = playersResponse.payload.data[0] || {};
  expect(playersResponse.payload.data.length === 6, "players: expected 6 mock players");
  for (const field of playerFields) {
    expect(Object.prototype.hasOwnProperty.call(firstPlayer, field), `players: missing ${field}`);
  }
}

checkJavaScriptSyntax();
checkJson();
checkSeoAndLinks();
await checkApi();

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("FutbolRadar QA passed");
