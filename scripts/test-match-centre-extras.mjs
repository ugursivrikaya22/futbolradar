#!/usr/bin/env node
/** Zenginleştirilmiş maç merkezi: köşe yazısı eşleşmesi, "Maçın 5 dakikası", Radar TV, yayıncı bağlantısı, H2H. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as extras from "./lib/matchCentreExtras.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { sameClub } = require("../services/superLigTeams.js");
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
let passed = 0;
const test = (name, run) => { run(); passed += 1; console.log(`  ok  ${name}`); };

test("köşe yazısı: iki takım etiketi + tarih penceresi (-2/+3 gün)", () => {
  const columns = [
    { title: "Derbi analizi", path: "kose-yazilari/a.html", date: "2026-09-06T10:00:00+03:00", tags: ["Fenerbahçe", "Beşiktaş", "Taktik"] },
    { title: "Tek takım", path: "kose-yazilari/b.html", date: "2026-09-05T10:00:00+03:00", tags: ["Fenerbahçe"] },
    { title: "Eski yazı", path: "kose-yazilari/c.html", date: "2026-08-20T10:00:00+03:00", tags: ["Fenerbahçe", "Beşiktaş"] },
    { title: "Taslak", path: "kose-yazilari/d.html", date: "2026-09-05T10:00:00+03:00", tags: ["Fenerbahçe", "Beşiktaş"], isPublic: false }
  ];
  const out = extras.relatedColumnsFor({ columns, homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: "2026-09-05T20:00:00+03:00", sameClub });
  assert.deepEqual(out.map((c) => c.path), ["kose-yazilari/a.html"]);
  assert.equal(out[0].tactical, true);
  assert.deepEqual(extras.relatedColumnsFor({ columns, homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: null, sameClub }), []);
});

const report = (over = {}) => ({
  coverageGrade: "events-only",
  dataStatus: "partial",
  digest: {
    turningPoints: { status: "ready", moments: [{ minute: "49'", team: "B", type: "Gol", detail: "Y" }, { minute: "23'", team: "A", type: "Gol", detail: "X" }] },
    lateGame: { status: "ready", moments: [{ minute: "90+2'", team: "A", type: "Kırmızı Kart", detail: "Z" }, { minute: "49'", team: "B", type: "Gol", detail: "Y" }] },
    tactical: { status: "unavailable", notes: [] }
  },
  ...over
});

test("Maçın 5 dakikası: yalnızca hazır rapor olayları, dakika sırası, tekrar yok, en fazla 5", () => {
  const moments = extras.fiveMinutesFrom(report());
  assert.deepEqual(moments.map((m) => m.minute), ["23'", "49'", "90+2'"]);
  assert.equal(extras.fiveMinutesFrom(report({ coverageGrade: "awaiting-provider" })).length, 0, "sağlayıcı verisi yoksa yok");
  assert.equal(extras.fiveMinutesFrom(report({ dataStatus: "minimal" })).length, 0);
  assert.equal(extras.fiveMinutesFrom(null).length, 0);
  const many = report();
  many.digest.turningPoints.moments = Array.from({ length: 8 }, (_, i) => ({ minute: `${i * 10 + 1}'`, type: "Gol", detail: `P${i}` }));
  assert.equal(extras.fiveMinutesFrom(many).length, 5);
  const html = extras.fiveMinutesSectionHtml(extras.fiveMinutesFrom(many));
  assert.match(html, /Maçın 5 dakikası/);
  assert.match(extras.fiveMinutesSectionHtml(moments), /Maçın 3 kritik anı/);
  assert.equal(extras.fiveMinutesSectionHtml([]), "");
  assert.doesNotMatch(html, /<iframe|<video/);
});

test("Radar TV: yalnızca geçerli kimlikli küratörlü kayıt; yoksa hiçbir şey", () => {
  const store = { videos: [
    { matchSlug: "a-b", provider: "youtube", videoId: "dQw4w9WgXcQ", title: "Analiz", publishedAt: "2026-10-01T10:00:00Z" },
    { matchSlug: "a-b", provider: "youtube", videoId: "kisa", title: "Bozuk", publishedAt: "2026-10-01T10:00:00Z" },
    { matchSlug: "a-b", provider: "vimeo", videoId: "123456789", title: "", publishedAt: "2026-10-01T10:00:00Z" },
    { matchSlug: "c-d", provider: "vimeo", videoId: "123456789", title: "Başka maç", publishedAt: "2026-10-01T10:00:00Z" }
  ] };
  const videos = extras.radarTvFor(store, "a-b");
  assert.equal(videos.length, 1);
  assert.equal(videos[0].url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.match(extras.radarTvSectionHtml(videos, "noopener noreferrer"), /id="radar-tv"/);
  assert.equal(extras.radarTvSectionHtml(extras.radarTvFor({ videos: [] }, "a-b"), ""), "");
  const real = JSON.parse(fs.readFileSync(path.join(root, "data", "radar-tv.json"), "utf8"));
  assert.ok(Array.isArray(real.videos), "data/radar-tv.json videos dizisi");
  for (const video of real.videos) assert.equal(extras.radarTvFor({ videos: [video] }, video.matchSlug).length, 1, `geçersiz Radar TV kaydı: ${JSON.stringify(video)}`);
});

test("resmî yayıncı: doğrulanmış kayıt + beyaz liste + https", () => {
  assert.deepEqual(extras.broadcasterLinkFor({ turkey: "TRT 1", sourceUrl: "https://www.trt1.com.tr/yayin-akisi" }, isAllowedSourceUrl), { channel: "TRT 1", url: "https://www.trt1.com.tr/yayin-akisi" });
  assert.equal(extras.broadcasterLinkFor({ turkey: "X TV", sourceUrl: "https://ornek-yayin.example/akis" }, isAllowedSourceUrl), null);
  assert.equal(extras.broadcasterLinkFor({ turkey: "ATV", sourceUrl: "" }, isAllowedSourceUrl), null);
  assert.equal(extras.broadcasterLinkFor(null, isAllowedSourceUrl), null);
  const html = extras.deepLinksSectionHtml({ links: [], broadcaster: { channel: "TRT 1", url: "https://www.trt1.com.tr/yayin-akisi" }, sourceRel: "nofollow noopener noreferrer" });
  assert.match(html, /rel="nofollow noopener noreferrer"/);
  assert.equal(extras.deepLinksSectionHtml({ links: [null], broadcaster: null, sourceRel: "" }), "");
});

test("taktik notları yalnızca hazır bölümden", () => {
  assert.deepEqual(extras.tacticalNotesFrom(report()), []);
  assert.deepEqual(extras.tacticalNotesFrom({ digest: { tactical: { status: "ready", notes: ["Not", " "] } } }), ["Not"]);
});

test("üretici: Türkçe sayfaya bağlanır, H2H 10 maç ve maç gününden önce", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "generate-match-seo-pages.mjs"), "utf8");
  assert.match(src, /locale === "tr" \? matchCentreExtras\(/);
  assert.match(src, /istanbulDay\(row\.date\) < kickoffDay/);
  assert.match(src, /\.slice\(0, 10\)/);
  const client = fs.readFileSync(path.join(root, "scripts", "lib", "matchCentreExtras.mjs"), "utf8");
  assert.doesNotMatch(client, /fetch\(|XMLHttpRequest/);
});

test("üretilmiş sayfalar (varsa): bölüm kimlikleri tekil, uydurma metin yok", () => {
  const dir = path.join(root, "mac");
  if (!fs.existsSync(dir)) return;
  let checked = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    if (!html.includes('id="mac-merkezi"')) continue;
    checked += 1;
    for (const id of ["mac-merkezi", "macin-5-dakikasi", "radar-tv"]) assert.ok((html.match(new RegExp(`id="${id}"`, "g")) || []).length <= 1, `${file}: #${id} tekil`);
    assert.doesNotMatch(html, /<iframe[^>]+(youtube|vimeo)/, `${file}: CSP frame-src izin vermiyor, iframe yok`);
  }
  console.log(`  ..  ${checked} sayfada #mac-merkezi denetlendi`);
});

console.log(`test-match-centre-extras: ${passed} test geçti`);
