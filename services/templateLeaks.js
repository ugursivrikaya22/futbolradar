/**
 * ŞABLONDAN SIZAN ARTIKLAR — ters tırnak, boş değişken, "undefined".
 *
 * Üretilmiş sayfada okurun gördüğü metne şablonun iç yapısı sızabilir:
 *   • Sağlayıcı adlarında apostrof yerine ters tırnak: "York`s LNER Community Stadium".
 *   • Markdown kod aralığı ya da yarım kalmış ters tırnak: "Veri kapsamı `".
 *   • Doldurulmamış yer tutucu: "${coverage}", "{{coverage}}", "%{coverage}".
 *   • Boş değişkenin dize hâli: "undefined", "null", "NaN", "[object Object]".
 *
 * Bu modül bunları GÖRÜNÜR METİN (metin düğümü + meta/başlık/alt öznitelikleri)
 * içinde bulur ve onarır. Kod (<script>, <style>, <pre>, <code>, <textarea>,
 * yorum) korunur: orada ters tırnak meşrudur. JSON-LD yalnızca ters tırnak
 * apostrofu için onarılır (JSON sözdizimine dokunmaz).
 *
 * ONARIM MUHAFAZAKÂR:
 *   • harf`harf → harf'harf (apostrof);
 *   • `kod` → kod (aralık işareti atılır, içerik kalır);
 *   • kalan yalnız ters tırnak atılır;
 *   • yer tutucu atılır;
 *   • "undefined/null/NaN" jetonu ATILMAZ ama etiket + jeton dışında hiçbir şey
 *     taşımayan öğe ("Veri kapsamı undefined") boş etiket olarak kaldırılır.
 * Bir öğe temizlendikten sonra yalnızca "Veri kapsamı"/"Kapsam" gibi etiket
 * kalıyorsa (değer yok), öğe kaldırılır: yarım etiket göstermek,
 * hiçbir şey göstermemekten kötüdür.
 *
 * Saf; dosya/ağ yok. İdempotent: temiz metinde ikinci geçiş değişiklik yapmaz.
 */
const PLACEHOLDERS = [/\$\{[^}]{0,80}\}/g, /\{\{[^}]{0,80}\}\}/g, /%\{[^}]{0,80}\}/g];
const BAD_TOKENS = /(^|[^\p{L}\p{N}_-])(undefined|null|NaN|\[object Object\])(?![\p{L}\p{N}_-])/giu;
const LABEL_ONLY = /^(?:veri\s+kapsam[ıi]|kapsam|kaynak|güven|güven\s+düzeyi|doğruluk)\s*[:·\-–]?\s*$/iu;

/** Bir metin parçasını onarır. @returns {{text:string, changed:boolean, leaks:string[]}} */
function cleanVisibleText(input) {
  let text = String(input ?? "");
  const original = text;
  const leaks = [];

  if (/`/.test(text)) leaks.push("backtick");
  text = text.replace(/(\p{L})`(?=\p{L})/gu, "$1'");
  text = text.replace(/`([^`\n]{1,80})`/g, "$1");
  text = text.replace(/`/g, "");

  for (const pattern of PLACEHOLDERS) {
    if (pattern.test(text)) leaks.push("placeholder");
    pattern.lastIndex = 0;
    text = text.replace(pattern, "");
  }

  // Kalan "undefined/null/NaN": bildirilir, yalnızca etiket+jeton düğümünde atılır.
  const tokenFree = text.replace(BAD_TOKENS, "$1").replace(/\s+/g, " ").trim();
  if (tokenFree !== text.replace(/\s+/g, " ").trim()) {
    leaks.push("empty-variable");
    if (LABEL_ONLY.test(tokenFree)) text = tokenFree;
  }

  // Boşluk düzeltmesi YALNIZCA gerçek bir onarım olduysa: girinti/satır sonu
  // düğümlerine ve temiz metne dokunulmaz. Kenar boşlukları özgün metindeki
  // gibi kalır (onarımın artık bıraktığı boşluk atılır).
  if (text !== original) {
    const lead = (/^\s*/.exec(original) || [""])[0];
    const trail = (/\s*$/.exec(original) || [""])[0];
    text = lead + text.trim().replace(/[ \t]{2,}/g, " ") + trail;
  }
  return { text, changed: text !== original, leaks };
}

/** Temizlendikten sonra yalnızca boş bir etiket kalan metin mi? */
function isDanglingLabel(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return Boolean(value) && LABEL_ONLY.test(value);
}

const PROTECTED = /(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>|<textarea\b[^>]*>[\s\S]*?<\/textarea>|<noscript\b[^>]*>[\s\S]*?<\/noscript>|<!--[\s\S]*?-->)/gi;
const LD_JSON = /^<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/i;
const ATTRS = /\b(content|title|alt|aria-label)=("([^"]*)"|'([^']*)')/gi;
const LABEL_ELEMENT = /<(em|span|small|p|li|b|strong|div)\b([^>]*)>([^<>]*)<\/\1>/gi;

/**
 * Sayfa HTML'inde görünür metni onarır.
 * @returns {{html:string, changed:boolean, fixes:number, leaks:string[]}}
 */
function cleanTemplateLeaks(html) {
  const source = String(html ?? "");
  const leaks = new Set();
  let fixes = 0;
  const parts = source.split(PROTECTED);

  const next = parts.map((part, index) => {
    if (index % 2 === 1) {
      // Korumalı bölge: yalnız JSON-LD'de ters tırnak apostrofu onarılır.
      if (LD_JSON.test(part) && /(\p{L})`(?=\p{L})/u.test(part)) {
        fixes += 1;
        leaks.add("backtick");
        return part.replace(/(\p{L})`(?=\p{L})/gu, "$1'");
      }
      return part;
    }
    // 1) Sızıntıdan sonra yalnızca boş bir etiket kalan basit öğeyi kaldır
    //    ("Veri kapsamı `" → "Veri kapsamı" → öğe gider). Özgün sayfada bilinçli
    //    bir etiket olabileceğinden yalnızca bu öğede SIZINTI bulunduysa kaldırılır.
    let out = part.replace(LABEL_ELEMENT, (match, tag, attrs, inner) => {
      const result = cleanVisibleText(inner);
      if (!result.leaks.length || !isDanglingLabel(result.text)) return match;
      result.leaks.forEach((leak) => leaks.add(leak));
      fixes += 1;
      return "";
    });
    // 2) Kalan metin düğümleri.
    out = out.replace(/>([^<>]+)</g, (match, text) => {
      const result = cleanVisibleText(text);
      result.leaks.forEach((leak) => leaks.add(leak));
      if (!result.changed) return match;
      fixes += 1;
      return `>${result.text}<`;
    });
    // 3) Görünür öznitelikler (meta açıklaması, başlık, alt, aria-label).
    out = out.replace(ATTRS, (match, name, quoted, dq, sq) => {
      const value = dq ?? sq ?? "";
      const result = cleanVisibleText(value);
      result.leaks.forEach((leak) => leaks.add(leak));
      if (!result.changed) return match;
      fixes += 1;
      return `${name}=${quoted[0]}${result.text}${quoted[0]}`;
    });
    return out;
  }).join("");

  return { html: next, changed: next !== source, fixes, leaks: [...leaks] };
}

/**
 * Sağlayıcıdan gelen ad/etiket (stadyum, takım) için tek satırlık onarım:
 * "York`s LNER Community Stadium" → "York's LNER Community Stadium".
 * Boş/yoksa null döner; değer uydurmaz.
 */
function cleanProviderName(value) {
  if (typeof value !== "string") return value ?? null;
  const cleaned = cleanVisibleText(value).text.trim();
  return cleaned || null;
}

module.exports = { cleanVisibleText, cleanTemplateLeaks, cleanProviderName, isDanglingLabel };
