#!/usr/bin/env node
/**
 * DİL ÖNERİ BANDI TESTİ — `lang-suggest.js`.
 *
 * En kritik iddia NEGATİF bir iddia: bant HİÇBİR KOŞULDA yönlendirme
 * yapmamalı. Otomatik dil yönlendirmesi Googlebot'un bir dili hiç görememesine
 * yol açar ve bu, kendini derhal belli etmeyen bir tarama arızasıdır —
 * sayfalar indeksten haftalar sonra düşer. Bu yüzden her senaryoda
 * `location` nesnesine yapılan HER yazma denemesi hata fırlatıyor: betik
 * yönlendirmeye kalkışırsa test patlar.
 *
 * Gerçek bir tarayıcı yerine asgari bir DOM taklidi kullanılıyor: betik
 * yalnızca `querySelector`, `createElement`, `appendChild` ve `localStorage`
 * kullanıyor, yani taklit dürüst kalabilir. Böylece test hiçbir bağımlılık
 * gerektirmeden `npm test` içinde koşabiliyor.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "lang-suggest.js"), "utf8");

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}: ${error.message}`);
  }
}

function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    listeners: {},
    className: "",
    textContent: "",
    setAttribute(key, value) {
      this.attributes[key] = String(value);
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
    },
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
      return child;
    },
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
    click() {
      (this.listeners.click || []).forEach((handler) => handler({}));
    }
  };
}

/**
 * `htmlLang`: sayfanın dili. `switchTarget`/`switchHref`: başlıktaki dil
 * düğmesi — `null` ise sayfada düğme yok (karşılığı olmayan sayfa).
 */
function run({ htmlLang, languages, switchTarget, switchHref, stored = null, cookie = "" }) {
  const body = makeElement("body");
  const storage = new Map();
  if (stored !== null) storage.set("futbolradar-lang", stored);

  const switchAnchor = switchTarget
    ? (() => {
        const anchor = makeElement("a");
        anchor.setAttribute("data-lang-switch", switchTarget);
        anchor.setAttribute("href", switchHref);
        return anchor;
      })()
    : null;

  const documentStub = {
    readyState: "complete",
    cookie,
    documentElement: { getAttribute: (key) => (key === "lang" ? htmlLang : null) },
    body,
    createElement: makeElement,
    addEventListener() {},
    querySelector(selector) {
      if (selector === "a.lang-switch[data-lang-switch]") return switchAnchor;
      if (selector === "[data-lang-suggest]") {
        return body.children.find((child) => child.getAttribute("data-lang-suggest")) || null;
      }
      return null;
    }
  };

  // `location` KASITLI OLARAK TUZAKLI: her yazma denemesi testi düşürür.
  const location = {};
  for (const key of ["href", "replace", "assign", "pathname"]) {
    Object.defineProperty(location, key, {
      get() {
        return key === "replace" || key === "assign"
          ? () => {
              throw new Error(`lang-suggest YÖNLENDİRME yaptı: location.${key}()`);
            }
          : "https://www.futbolradar.com/";
      },
      set() {
        throw new Error(`lang-suggest YÖNLENDİRME yaptı: location.${key} yazıldı`);
      }
    });
  }

  const windowStub = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value))
    },
    location
  };

  const context = {
    window: windowStub,
    document: documentStub,
    navigator: { languages, language: languages[0] || "" },
    location,
    Date
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "lang-suggest.js" });

  const banner = body.children.find((child) => child.getAttribute("data-lang-suggest")) || null;
  return { banner, body, storage, documentStub };
}

console.log("lang-suggest");

check("Türkçe sayfa + İngilizce tarayıcı → İngilizce önerisi çıkar", () => {
  const { banner } = run({
    htmlLang: "tr",
    languages: ["en-GB", "en"],
    switchTarget: "en",
    switchHref: "./en/galatasaray.html"
  });
  assert.ok(banner, "bant çizilmeliydi");
  assert.equal(banner.getAttribute("data-lang-suggest"), "en");
  const cta = banner.children.find((child) => child.tagName === "A");
  assert.ok(cta, "çağrı bağlantısı yok");
  assert.equal(cta.textContent, "View FutbolRadar in English");
  // Hedef AYNI İÇERİĞİN karşılığı; ana sayfa değil.
  assert.equal(cta.href, "./en/galatasaray.html");
});

check("Türkçe sayfa + Türkçe tarayıcı → öneri çıkmaz", () => {
  const { banner } = run({
    htmlLang: "tr",
    languages: ["tr-TR", "en"],
    switchTarget: "en",
    switchHref: "./en/index.html"
  });
  assert.equal(banner, null);
});

check("İngilizce sayfa + Türkçe tarayıcı → Türkçe önerisi çıkar", () => {
  const { banner } = run({
    htmlLang: "en",
    languages: ["tr-TR"],
    switchTarget: "tr",
    switchHref: "../galatasaray-maclari.html"
  });
  assert.ok(banner, "bant çizilmeliydi");
  assert.equal(banner.getAttribute("data-lang-suggest"), "tr");
});

check("İngilizce sayfa + İngilizce tarayıcı → öneri çıkmaz", () => {
  const { banner } = run({
    htmlLang: "en",
    languages: ["en-US"],
    switchTarget: "tr",
    switchHref: "../index.html"
  });
  assert.equal(banner, null);
});

check("kayıtlı tercih varsa bir daha sorulmaz (localStorage)", () => {
  const { banner } = run({
    htmlLang: "tr",
    languages: ["en-GB"],
    switchTarget: "en",
    switchHref: "./en/index.html",
    stored: "tr"
  });
  assert.equal(banner, null);
});

check("kayıtlı tercih çerezden de okunur (localStorage boşken)", () => {
  const { banner } = run({
    htmlLang: "tr",
    languages: ["en-GB"],
    switchTarget: "en",
    switchHref: "./en/index.html",
    cookie: "theme=dark; futbolradar_lang=tr"
  });
  assert.equal(banner, null);
});

check("çok dilli tarayıcıda Türkçe varsa öneri çıkmaz", () => {
  const { banner } = run({
    htmlLang: "tr",
    languages: ["de-DE", "tr-TR"],
    switchTarget: "en",
    switchHref: "./en/index.html"
  });
  assert.equal(banner, null);
});

check("karşılığı olmayan sayfada (dil düğmesi yok) bant hiç çizilmez", () => {
  const { banner } = run({
    htmlLang: "tr",
    languages: ["en-GB"],
    switchTarget: null,
    switchHref: null
  });
  assert.equal(banner, null);
});

check("öneriye tıklamak tercihi kaydeder", () => {
  const { banner, storage } = run({
    htmlLang: "tr",
    languages: ["en-GB"],
    switchTarget: "en",
    switchHref: "./en/index.html"
  });
  banner.children.find((child) => child.tagName === "A").click();
  assert.equal(storage.get("futbolradar-lang"), "en");
});

check("kapatmak tercihi kaydeder ve bandı DOM'dan kaldırır", () => {
  const { banner, body, storage } = run({
    htmlLang: "tr",
    languages: ["en-GB"],
    switchTarget: "en",
    switchHref: "./en/index.html"
  });
  banner.children.find((child) => child.tagName === "BUTTON").click();
  assert.equal(storage.get("futbolradar-lang"), "tr");
  assert.equal(body.children.length, 0, "bant kaldırılmalıydı");
});

/**
 * YÖNLENDİRME YOK — her senaryoda. `location` tuzaklı olduğu için yukarıdaki
 * senaryoların hiçbirinde hata fırlamamış olması bunu zaten kanıtlıyor; bu
 * kontrol iddiayı AÇIKÇA yazıya döküyor ki ileride biri "hızlıca bir
 * yönlendirme ekleyeyim" dediğinde testin adı ona ne kırdığını söylesin.
 */
check("hiçbir senaryoda yönlendirme yapılmaz", () => {
  for (const languages of [["en-GB"], ["tr-TR"], ["de-DE"], ["ar"], ["hi-IN"]]) {
    for (const htmlLang of ["tr", "en"]) {
      run({
        htmlLang,
        languages,
        switchTarget: htmlLang === "tr" ? "en" : "tr",
        switchHref: htmlLang === "tr" ? "./en/index.html" : "../index.html"
      });
    }
  }
});

/** Bant akış DIŞINDA çizilmeli (CLS üretmemeli) — stil sözleşmesi. */
check("bant CLS üretmeyecek biçimde konumlanıyor (position: fixed)", () => {
  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  const block = css.slice(css.indexOf(".lang-suggest {"));
  assert.ok(/^[\s\S]{0,400}position:\s*fixed/.test(block), ".lang-suggest position: fixed olmalı");
});

if (failures) {
  console.error(`\nlang-suggest FAILED (${failures})`);
  process.exitCode = 1;
} else {
  console.log("\nlang-suggest passed");
}
