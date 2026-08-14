import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("page.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const fixtures = JSON.parse(fs.readFileSync("data/super-lig-fixtures.json", "utf8"));
const title = "Süper Lig başlıyor: Galatasaray - Çorum FK saat 21:30'da";

assert.ok(html.includes(`<title>${title}</title>`));
assert.match(html, /data-super-lig-launch/);
assert.match(html, /Arca Çorum FK/);
assert.match(html, /2026-08-14T21:30:00\+03:00/);
assert.match(html, /RAMS Park/);
assert.ok(html.indexOf("data-super-lig-launch") < html.indexOf('id="hero-canli-skor"'));
assert.match(css, /\.super-lig-launch-team strong[\s\S]*?white-space:\s*nowrap/);
assert.match(css, /\.super-lig-launch-card\.is-live/);
assert.match(css, /\.super-lig-launch\s*\{\s*order:\s*-2;/);
assert.match(css, /\.super-lig-launch-card\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/);
assert.match(css, /\.super-lig-launch\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/);
assert.doesNotMatch(css, /\.super-lig-launch-card\s*\{[^}]*min-height:\s*(?:clamp\(|260px)/);
assert.match(app, /function initSuperLigLaunchCard\(\)/);
assert.match(app, /Date\.now\(\) >= kickoff/);

const round = fixtures.rounds.find((item) => item.round === 1);
const match = round.matches.find((item) => item.id === "tff-tsl-2026-r01-galatasaray-corum-fk");
assert.equal(match.kickoff, "2026-08-14T21:30:00+03:00");
assert.equal(match.venue, "RAMS Park");
console.log("Süper Lig launch card checks passed");
