/**
 * DİL ÖNERİ BANDI — SENKRON KARAR SNIPPET'İ.
 *
 * Bant üstte duruyor ve başlık çubuğu normal akışta: bandı akışın DIŞINDA
 * (`position: fixed`) çizip başlığın üzerine bindirmek, mobilde hamburger
 * düğmesini TIKLANAMAZ hâle getiriyordu — depo kendi etkileşim kapısıyla
 * bunu yakaladı (`.nav-toggle` dokunuşu 15 sn zaman aşımına uğruyordu).
 * Akışa sokmak ise sayfa kaymasıydı (CLS).
 *
 * Çözüm, deponun TEMA için zaten kullandığı desen: kararı İLK BOYAMADAN
 * ÖNCE, `<head>` içinde senkron olarak ver (bkz. inject-theme-boot.mjs).
 * Karar `<html data-lang-suggest="en">` olarak işaretleniyor; CSS o işarete
 * bakıp gövdeye bandın yüksekliği kadar yer AYIRIYOR. Böylece başlık bandın
 * altından başlıyor: ne bindirme var ne de kayma.
 *
 * Snippet burada TEK DİZE olarak duruyor çünkü iki yer onu okumak zorunda:
 * enjektör (sayfaya gömer) ve test (aynı mantığı çalıştırır). İki kopya
 * tutulsaydı biri güncellenmediğinde test gerçeği değil kendi kopyasını
 * doğrulardı.
 *
 * Snippet YALNIZCA ucuz kontroller yapıyor — saklanan tercih, tarayıcı dili,
 * sayfa dili. DOM'a bakmıyor: `<head>` çalışırken gövde henüz ayrıştırılmadı.
 * Karşılığı olmayan sayfalarda snippet zaten hiç gömülmüyor (enjektör yalnızca
 * dil düğmesi taşıyan sayfalara yazıyor), bu yüzden "yer ayırdım ama bant
 * çıkmadı" durumu oluşamaz.
 */
export const LANG_SUGGEST_MARKER = "data-futbolradar-lang-boot";

export const LANG_SUGGEST_BOOT = `(function(){try{
var d=document.documentElement;
var cur=(d.getAttribute("lang")||"tr").slice(0,2).toLowerCase();
var target=cur==="en"?"tr":"en";
var pref="";
try{pref=window.localStorage.getItem("futbolradar-lang")||"";}catch(e){}
if(!pref){var m=document.cookie.match(/(?:^|;\\s*)futbolradar_lang=([^;]*)/);pref=m?decodeURIComponent(m[1]):"";}
if(pref)return;
var list=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||""];
var tr=false;
for(var i=0;i<list.length;i++){if(/^tr\\b/i.test(String(list[i]||""))){tr=true;break;}}
if(cur==="tr"&&tr)return;
if(cur==="en"&&!tr)return;
d.setAttribute("data-lang-suggest",target);
}catch(e){}})();`;
