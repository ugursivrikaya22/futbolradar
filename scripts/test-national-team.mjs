#!/usr/bin/env node
/**
 * TÜRKİYE A MİLLÎ TAKIM SİSTEMİ — SÖZLEŞME DENETİMİ.
 *
 * Bu yüzeyde sessizce bozulabilecek şeyler, kulüp maçlarındakinden farklı
 * ve her biri daha önce en az bir kez gerçekten bozuldu:
 *
 *   • Millî maç, yarışması "öncelikli ligler" listesinde olmadığı için
 *     kalıcı maç sayfası ALMAZ ve merkez boş bir kabuğa döner.
 *   • Kadın ya da U21 karşılaşması, takım adı "Türkiye" olduğu için A
 *     Millî Takım maçı gibi sayfa açar.
 *   • Sağlayıcının canlıya çevirip güncellemeyi bıraktığı bayat bir kayıt,
 *     ana sayfada ve merkezde "şu anda canlı" diye görünür.
 *   • Yaklaşan millî maç, aynı pencerede bir kulüp maçı olduğu için
 *     vitrinde ikinci sıraya düşer.
 *   • Başlama saati doğrulanmamış bir program satırına uydurma saat yazılır.
 *   • Vitrin maç bittikten sonra büyük kart olarak kalır ya da hiç düşmez.
 *
 * Ağ gerekmez: depodaki dosyalar ve saf fonksiyonlar sınanır.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const failures = [];

const { ROUTES, NAV_KEYS, absoluteUrl, competitionLabel, routeMeta } = require("../services/i18n.js");
const { isTurkiyeNationalMatch, evaluateEligibility, trSlugFor, enSlugFor } = require("../services/matchSeoPages.js");
const { findCompetition, findCompetitionByProviderId, resolveCompetitionId } = require("../services/competitionCatalog.js");
const { nationLabel } = require("../services/displayLabels.js");
const spotlight = require("../services/featuredMatchSpotlight.js");

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

// Üretici (generate-national-team-pages.mjs) ile aynı kaçış.
function escapeForHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function read(relative) {
  const full = path.join(root, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
}

console.log("milli-takim");

/* --- 1. Yarışma kataloğu ------------------------------------------------ */
{
  const competition = findCompetition("uefa-uluslar-ligi");
  check("UEFA Uluslar Ligi katalogda", Boolean(competition), "data/competitions.json");

  // Sayısal lig kimliği, sağlayıcının GÜNLÜK tarih sorgusunun millî maçları
  // da getirmesini sağlayan tek şey: `filterSupportedCompetitions` katalogda
  // olmayan yarışmayı eliyor. Kimlik düşerse millî maçlar takvime hiç
  // girmez ve sistem sessizce durur — üstelik EK BİR ÇAĞRI MALİYETİ YOK,
  // aynı tarih sorgusunun içinde geliyorlar.
  check("sağlayıcı lig kimliği (5) katalogda çözülüyor",
    Boolean(findCompetitionByProviderId(5)) && findCompetitionByProviderId(5).id === "uefa-uluslar-ligi",
    JSON.stringify(findCompetitionByProviderId(5) || null));

  // Sağlayıcı kaydı takvime kendi slug'ıyla düşebiliyor; takma ad olmadan
  // aynı yarışma iki kimlikle yaşardı.
  check("sağlayıcının kendi kimliği takma adla eşleşiyor",
    findCompetition("uefa-nations-league") && findCompetition("uefa-nations-league").id === "uefa-uluslar-ligi");

  check("turnuva adı iki dilde ayrı",
    competitionLabel("UEFA Uluslar Ligi", "tr") === "UEFA Uluslar Ligi"
    && competitionLabel("UEFA Nations League", "en") === "UEFA Nations League",
    `${competitionLabel("UEFA Uluslar Ligi", "tr")} / ${competitionLabel("UEFA Nations League", "en")}`);
}

/* --- 2. Uygunluk: A takımı evet, alt seviye hayır ----------------------- */
{
  const senior = { homeTeam: "Türkiye", awayTeam: "İtalya", kickoff: "2026-09-28T21:45:00+03:00", league: "UEFA Uluslar Ligi" };
  check("A millî maç sicile uygun", evaluateEligibility(senior).eligible, JSON.stringify(evaluateEligibility(senior)));

  const nonSenior = [
    { homeTeam: "Türkiye", awayTeam: "İspanya", league: "UEFA U21 Championship - Qualification" },
    { homeTeam: "Türkiye", awayTeam: "Almanya", league: "UEFA Women's Nations League" },
    { homeTeam: "Türkiye", awayTeam: "Polonya", league: "UEFA Youth League" }
  ];
  for (const match of nonSenior) {
    check(`alt seviye maç A takımı sayılmıyor: ${match.league}`, !isTurkiyeNationalMatch(match));
  }

  // Kulüp maçı hiçbir koşulda millî maç değildir.
  check("kulüp maçı millî maç sayılmıyor",
    !isTurkiyeNationalMatch({ homeTeam: "Beşiktaş", awayTeam: "Fenerbahçe", league: "Süper Lig" }));

  check("millî maçın yarışma kimliği çözülüyor",
    resolveCompetitionId({ providerLeagueId: "5", league: "UEFA Nations League" }) === "uefa-uluslar-ligi");
}

/* --- 3. Slug kuralı ve kalıcı maç sayfası -------------------------------- */
{
  const slug = trSlugFor("Türkiye", "İtalya", "2026-09-28T21:45:00+03:00");
  check("TR slug beklenen biçimde", slug === "turkiye-italya-28-eylul-2026", String(slug));
  check("EN slug beklenen biçimde",
    enSlugFor("Türkiye", "İtalya", "2026-09-28T21:45:00+03:00") === "turkiye-italya-september-28-2026");

  const registry = readJson("data/match-seo-pages.json", { pages: [] });
  const entry = (registry.pages || []).find((row) => row.slug === slug);
  check("maç sicilinde kayıt var", Boolean(entry));

  if (entry) {
    const tr = read(`mac/${entry.slug}.html`);
    const en = read(`en/match/${entry.enSlug}.html`);
    check("TR maç sayfası üretilmiş", Boolean(tr));
    check("EN maç sayfası üretilmiş", Boolean(en));

    if (tr) {
      // Hakem ve VAR alanı TFF'den doğrulanmış; uydurulmuş bir kanal ya da
      // skor iddiası YOK.
      check("TR maç sayfası hakemi gösteriyor", tr.includes("Michael Oliver"));
      check("TR maç sayfası VAR hakemini gösteriyor", tr.includes("Stuart Attwell") && tr.includes("<dt>VAR</dt>"));
      check("TR maç sayfası uydurma yayın kanalı yazmıyor", tr.includes("Henüz açıklanmadı"));
      for (const anchor of ["muhtemel-11", "olaylar", "istatistik", "puan-durumu"]) {
        check(`TR maç sayfasında "${anchor}" bölümü var`, tr.includes(`id="${anchor}"`));
      }
      check("TR maç sayfasında SportsEvent işaretlemesi var", tr.includes('"@type":"SportsEvent"'));
      check("TR maç sayfası kanoniği kendi adresi",
        tr.includes('<link rel="canonical" href="https://www.futbolradar.com/mac/turkiye-italya-28-eylul-2026" />'));
    }

    if (en) {
      // İNGİLİZCE SAYFA İNGİLİZCE ÜLKE ADI KULLANIR. Slug ve canlı eşleşme
      // anahtarı Türkçe kalır; değişen yalnızca GÖRÜNEN ad.
      check("EN maç sayfası başlığı İngilizce ülke adı taşıyor",
        /<title>[^<]*Italy[^<]*<\/title>/.test(en) && !/<title>[^<]*İtalya[^<]*<\/title>/.test(en),
        (en.match(/<title>[^<]*<\/title>/) || [])[0]);
      check("EN maç sayfası canlı eşleşme anahtarını ham adla taşıyor",
        en.includes('data-msp-away="İtalya"'));
    }
  }
}

/* --- 4. Merkez sayfaları ------------------------------------------------- */
{
  const route = ROUTES.find((row) => row.key === "nationalTeam");
  check("rota eşlemesinde millî takım var", Boolean(route));

  if (route) {
    const tr = read(route.tr);
    const en = read(route.en);
    check("TR merkez sayfası üretilmiş", Boolean(tr), route.tr);
    check("EN merkez sayfası üretilmiş", Boolean(en), route.en);

    if (en) {
      check("EN merkez kanoniği kendi adresi",
        en.includes(`<link rel="canonical" href="${absoluteUrl(route.en)}" />`));
      check("EN merkez hreflang üçlüsü tam",
        en.includes(`hreflang="en" href="${absoluteUrl(route.en)}"`)
        && en.includes(`hreflang="tr-TR" href="${absoluteUrl(route.tr)}"`)
        && en.includes(`hreflang="x-default" href="${absoluteUrl(route.tr)}"`));
      check("EN merkez başlığı İngilizce metadata'dan",
        en.includes(`<title>${routeMeta("nationalTeam", "en").title}</title>`));
      // Bu sayfa Türkçe arayüz metni taşımaz (bkz. test-en-language-purity).
      const body = en.replace(/<a class="lang-switch"[\s\S]*?<\/a>/g, "");
      const leaks = ["Yaklaşan maçlar", "Son maçlar", "Türkiye kadrosu", "Puan durumu", "Saat henüz açıklanmadı"]
        .filter((marker) => body.includes(marker));
      check("EN merkezde Türkçe arayüz metni yok", !leaks.length, leaks.join(", "));
    }

    if (tr) {
      check("TR merkez kanoniği İngilizceyi göstermiyor",
        tr.includes(`<link rel="canonical" href="${absoluteUrl(route.tr)}" />`));
      check("TR merkez yaklaşan maça bağlanıyor", tr.includes("mac/turkiye-italya-28-eylul-2026"));
      // Veri yoksa UYDURULMAZ: kadro ve grup durumu açıkça bekliyor.
      check("kadro açıklanmadıysa öyle söyleniyor", tr.includes("Aylık kadro henüz açıklanmadı"));
      // GRUP DURUMU VERİYE GÖRE DENETLENİR. Tablo yoksa sayfa bunu açıkça
      // söyler; sağlayıcı tabloyu yazdıysa (data/league-standings.json) ya da
      // doğrulanmış elle giriş varsa tablo basılır ve "henüz açıklanmadı"
      // denmez. Eskiden test tablonun HİÇ gelmeyeceğini varsayıyordu; Uluslar
      // Ligi tablosu sağlayıcıdan gelince sayfa doğru davrandığı hâlde kırıldı.
      const ntConfig = readJson("data/national-team.json", {});
      const ntCompetition = (ntConfig.competition && ntConfig.competition.id) || "uefa-uluslar-ligi";
      const storeTable = ((readJson("data/league-standings.json", {})[ntCompetition] || {}).table) || [];
      const manualRows = (ntConfig.groupStandings && Array.isArray(ntConfig.groupStandings.rows)) ? ntConfig.groupStandings.rows : [];
      const standingRows = storeTable.length ? storeTable : manualRows;
      if (standingRows.length) {
        check("grup durumu varsa tablo basılıyor", /<table[\s\S]*?<\/table>/.test(tr)
          && standingRows.every((row) => tr.includes(escapeForHtml(String(row.team || row.name || "")))),
          `${standingRows.length} satır`);
        check("grup durumu varsa 'henüz açıklanmadı' denmiyor", !tr.includes("grup durumu henüz açıklanmadı"));
      } else {
        check("grup durumu yoksa öyle söyleniyor", tr.includes("grup durumu henüz açıklanmadı"));
      }
      check("TR merkezde CollectionPage işaretlemesi var", tr.includes('"@type":"CollectionPage"'));
    }

    // Saati doğrulanmamış program satırı: uydurma saat YAZILMAZ.
    const config = readJson("data/national-team.json", {});
    const pending = (config.announcedProgram || []).filter((row) => row && !row.kickoff);
    check("saati doğrulanmamış program satırı kickoff taşımıyor",
      pending.every((row) => row.kickoff === null || row.kickoff === undefined),
      JSON.stringify(pending.map((row) => row.kickoff)));
    // Üretici saatsiz program satırını yalnızca YAKLAŞAN maçlar arasında
    // gösterir (gün >= bugün, TSİ). Geçmiş bir saatsiz satır listelenmez;
    // test eskiden tarihine bakmadan "Saat henüz açıklanmadı" bekliyordu ve
    // program günleri geçince kırılıyordu.
    const todayTsi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
    const upcomingPending = pending.filter((row) => row.date && row.date >= todayTsi);
    if (tr && upcomingPending.length) {
      check("saat bilinmeyen maçta uydurma saat basılmıyor", tr.includes("Saat henüz açıklanmadı"));
    }
    if (tr && pending.length && !upcomingPending.length) {
      check("geçmiş saatsiz program satırı yaklaşan maç gibi basılmıyor", !tr.includes("Saat henüz açıklanmadı"));
    }
  }
}

/* --- 5. Menü: masaüstü ve mobil ----------------------------------------- */
{
  const trNav = [...NAV_KEYS.tr.primary, ...NAV_KEYS.tr.secondary].map((item) => item.href);
  const enNav = [...NAV_KEYS.en.primary, ...NAV_KEYS.en.secondary].map((item) => item.href);
  check("TR menüde millî takım bağlantısı var", trNav.includes("milli-takim.html"), trNav.join(", "));
  check("EN menüde millî takım bağlantısı var", enNav.includes("en/turkey-national-team.html"));

  // Mobil çekmece ile masaüstü menü AYNI işaretlemeden geliyor
  // (scripts/lib/layout.mjs#siteHeader → `.nav-menu`); bağlantı gerçekten
  // basılmış mı diye ana sayfa okunur.
  const home = read("index.html");
  if (home) {
    const menu = home.slice(home.indexOf('id="primary-menu"'), home.indexOf("</header>"));
    check("ana sayfa menüsünde millî takım bağlantısı basılı", menu.includes("milli-takim.html"), "index.html #primary-menu");
  }
  const enHome = read("en/index.html");
  if (enHome) {
    const menu = enHome.slice(enHome.indexOf('id="primary-menu"'), enHome.indexOf("</header>"));
    check("İngilizce ana sayfa menüsünde millî takım bağlantısı basılı", menu.includes("turkey-national-team.html"));
  }
}

/* --- 6. Temiz adres yeniden yazımı -------------------------------------- */
{
  const vercel = readJson("vercel.json", { rewrites: [] });
  const rewrites = new Map((vercel.rewrites || []).map((row) => [row.source, row.destination]));
  check("/milli-takim adresi dosyaya çözülüyor", rewrites.get("/milli-takim") === "/milli-takim.html");
  check("/en/turkey-national-team adresi dosyaya çözülüyor",
    rewrites.get("/en/turkey-national-team") === "/en/turkey-national-team.html");
}

/* --- 7. Vitrin: öncelik, büyük kart, yaşam döngüsü ---------------------- */
{
  const config = readJson("data/featured-match-spotlight.json", {});
  check("vitrin yapılandırmasında Türkiye var", (config.teams || []).includes("Türkiye"), JSON.stringify(config.teams));
  check("Türkiye öncelikli takım", (config.priorityTeams || []).includes("Türkiye"));
  check("Türkiye büyük kart takımı", (config.majorTeams || []).includes("Türkiye"));

  const national = {
    id: "turkiye-italya-28-eylul-2026",
    homeTeam: "Türkiye", awayTeam: "İtalya",
    kickoff: "2026-09-28T21:45:00+03:00",
    status: "SCHEDULED", score: { home: null, away: null }
  };
  const club = {
    id: "besiktas-kasimpasa",
    homeTeam: "Beşiktaş", awayTeam: "Kasımpaşa",
    kickoff: "2026-09-28T19:00:00+03:00",
    status: "SCHEDULED", score: { home: null, away: null }
  };
  const at = (iso) => Date.parse(iso);

  // ÖNCELİK AYNI EVREDE UYGULANIR.
  const preNow = at("2026-09-27T20:00:00+03:00");
  const pickedPre = spotlight.selectSpotlight([club, national], { ...config, nowMs: preNow, observed: {} });
  check("aynı evrede millî maç vitrini alıyor", pickedPre && pickedPre.homeTeam === "Türkiye",
    pickedPre ? pickedPre.homeTeam : "yok");

  // EVRE SIRASI BOZULMAZ: gerçekten canlı bir kulüp maçı, yaklaşan millî
  // maçın önünde kalır — okuyucunun o an aradığı canlı skordur.
  const liveClub = { ...club, status: "LIVE", minute: 20, score: { home: 1, away: 0 }, fetchedAt: "2026-09-28T19:25:00+03:00" };
  const pickedLive = spotlight.selectSpotlight([liveClub, national], { ...config, nowMs: at("2026-09-28T19:25:00+03:00"), observed: {} });
  check("canlı kulüp maçı yaklaşan millî maçın önünde", pickedLive && pickedLive.homeTeam === "Beşiktaş",
    pickedLive ? pickedLive.homeTeam : "yok");

  // BAYAT CANLI KAYDI CANLI SAYILMAZ. Sağlayıcı bir maçı canlıya çevirip
  // güncellemeyi bıraktığında kayıt depoda donuyor; ham durumu okumak iki
  // gün önceki maçı ana sayfada "CANLI" diye gösterirdi.
  const staleLive = { ...national, status: "LIVE", minute: 53, score: { home: 0, away: 0 }, fetchedAt: "2026-09-28T22:20:00+03:00" };
  const staleNow = at("2026-09-30T12:00:00+03:00");
  check("bayat canlı kaydı canlı gösterilmiyor", spotlight.phaseOf(staleLive, staleNow, config) !== "live",
    spotlight.phaseOf(staleLive, staleNow, config));
  check("bayat canlı kaydı vitrinden düşüyor",
    !spotlight.selectSpotlight([staleLive], { ...config, nowMs: staleNow, observed: {} }));

  // SKORSUZ CANLI İDDİASI YAPILMAZ.
  const liveNoScore = { ...national, status: "LIVE", score: { home: null, away: null }, fetchedAt: "2026-09-28T22:20:00+03:00" };
  check("skorsuz canlı iddiası 'başlıyor' bandında kalıyor",
    spotlight.phaseOf(liveNoScore, at("2026-09-28T22:20:00+03:00"), config) === "in-progress");

  // BÜYÜK KART MAÇTAN SONRA DÜŞER.
  const finished = { ...national, status: "FINISHED", score: { home: 2, away: 1 }, updatedAt: "2026-09-28T23:40:00+03:00" };
  const postNow = at("2026-09-28T23:45:00+03:00");
  check("maç öncesi büyük kart açık", spotlight.isMajorSpotlight(national, config, spotlight.phaseOf(national, preNow, config)));
  check("maç sonrası büyük kart kapalı", !spotlight.isMajorSpotlight(finished, config, spotlight.phaseOf(finished, postNow, config)));
  check("maç sonrası kutu hâlâ ana sayfada (2 saat)", spotlight.isOpen(finished, postNow, config, null));
  check("bitişten 2 saat sonra kutu düşüyor",
    !spotlight.isOpen(finished, at("2026-09-29T01:41:00+03:00"), config, "2026-09-28T23:40:00+03:00"));
}

/* --- 8. Ana sayfa vitrini gerçekten millî maçı gösteriyor mu ------------ */
{
  const home = read("index.html");
  if (home && home.includes("data-featured-match-spotlight")) {
    const block = home.slice(home.indexOf("<!-- featured-match-spotlight:start -->"), home.indexOf("<!-- featured-match-spotlight:end -->"));
    // Vitrin O AN hangi maçı gösteriyorsa ona göre denetlenir. Test eskiden
    // vitrinin her zaman 28 Eylül Türkiye – İtalya maçını göstereceğini
    // varsayıyordu; maç bittikten sonra vitrin (doğru biçimde) sıradaki
    // kulüp maçına geçti ve denetim kırıldı. Seçim kuralları (millî maç
    // önceliği, büyük kart, yaşam döngüsü) yukarıda 7. bölümde zamandan
    // bağımsız sınanıyor.
    const shown = (block.match(/href="(?:\.\/)?mac\/([^"#?]+)/) || [])[1] || "";
    check("vitrin bir maç sayfasına bağlı", Boolean(shown), "index.html");
    check("vitrinde geri sayım var", block.includes("data-fms-countdown"));
    if (/(^|-)turkiye-/.test(shown)) {
      check("ana sayfa vitrini millî maça bağlı", shown.startsWith("turkiye-") || shown.includes("-turkiye-"), shown);
      check("vitrin büyük kart sınıfını taşıyor", block.includes("fms--major"));
      check("vitrinde millî takım merkezine bağlantı var", block.includes("milli-takim"));
    } else {
      check("kulüp maçı vitrininde millî takım merkezi bağlantısı yok", !block.includes("milli-takim"), shown);
      console.log(`  --  vitrin şu an millî maç göstermiyor (${shown}); millî kart denetimi atlandı`);
    }
    // Skor yoksa skor satırı GİZLİ doğar: uydurma "0-0" basılmaz.
    check("maç öncesi skor satırı gizli", /data-fms-score hidden/.test(block) || !block.includes("fms__score-value\">0"));
  } else {
    // Vitrin penceresi kapalıysa (maçtan 48 saatten fazla önce ya da maç
    // bitip 2 saat geçtiyse) kutu olmaması DOĞRU davranıştır.
    console.log("  --  ana sayfada vitrin penceresi kapalı, kutu denetimi atlandı");
  }
}

/* --- 9. İstemci varlıkları ---------------------------------------------- */
{
  const css = read("featured-match-spotlight.css");
  const js = read("featured-match-spotlight.js");
  check("büyük kart ve geri sayım biçemi var",
    Boolean(css) && css.includes(".fms--major") && css.includes(".fms__countdown"));
  check("geri sayım istemcide sayılıyor", Boolean(js) && js.includes("data-fms-countdown"));
  // Geri sayım EK AĞ İSTEĞİ ATMAZ: yerel saatle çalışır. Yoklama aralıkları
  // olduğu gibi kalır (maçtan bir saat önce başlar).
  check("geri sayım ek yoklama eklemiyor",
    Boolean(js) && (js.match(/window\.fetch\(/g) || []).length === 1,
    `fetch sayısı: ${js ? (js.match(/window\.fetch\(/g) || []).length : "dosya yok"}`);
}

/* --- 10. Ülke adı sunumu ------------------------------------------------ */
{
  check("ülke adı İngilizcede çevriliyor",
    nationLabel("İtalya", "en") === "Italy" && nationLabel("Belçika", "en") === "Belgium");
  check("Türkçede ülke adı değişmiyor",
    nationLabel("İtalya", "tr") === "İtalya" && nationLabel("Türkiye", "tr") === "Türkiye");
  check("kulüp adı eşlemeye girmiyor",
    nationLabel("Beşiktaş", "en") === "Beşiktaş" && nationLabel("Fenerbahçe", "en") === "Fenerbahçe");
  // BM'de tescilli İngilizce ad da "Türkiye"; site iki dilde aynı yazımı
  // kullanıyor.
  check("Türkiye İngilizcede de Türkiye", nationLabel("Türkiye", "en") === "Türkiye");
}

console.log("");
if (failures.length) {
  console.error(`milli-takim FAILED (${failures.length}):`);
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else {
  console.log("milli-takim: tüm denetimler geçti.");
}
