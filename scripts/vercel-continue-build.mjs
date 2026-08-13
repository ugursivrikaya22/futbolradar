// Vercel ignoreCommand semantiği: çıkış 1 "bu derlemeye devam et" demek,
// çıkış 0 "bu dağıtımı derlemeden atla" demek.
//
// YAN PROJELER DERLEMEZ. Bu depoya Vercel'de üç proje bağlı ve her push
// üçünde birden 9.000+ sayfalık tam derlemeyi tetikliyordu. Sonuç: ücretsiz
// planın günlük dağıtım kotası doldu ve PR'lar koddan bağımsız kırmızı
// "rate limited" durumları aldı. Yayında olan tek proje `futbolradar`;
// diğer ikisi eski denemelerden kalma.
//
// Liste BİLEREK kara liste, beyaz liste değil: asıl projenin kimliği bir
// gün değişirse (yeniden bağlama, yeniden adlandırma) beyaz liste bütün
// dağıtımları SESSİZCE durdururdu — en tehlikeli arıza biçimi. Kara liste
// yalnızca bilinen iki eski projeyi susturur; tanınmayan her proje normal
// derlenir.
//
// NOT: Bu kapı derlemeyi keser ama dağıtım KAYDINI engelleyemez —
// ignoreCommand, dağıtım oluşturulduktan sonra çalışır ve günlük kota
// oluşturulan dağıtımı sayar. Kotayı gerçekten rahatlatmak için yan
// projelerin depodan panelden ayrılması gerekir:
// Vercel → proje → Settings → Git → Disconnect.
const RETIRED_PROJECT_IDS = new Set([
  // futbolradar-5l9r
  "prj_YsUzZ709WK4AuHOxTSNjyKIk37nR",
  // futbolradar-ana-sayfas-n-ba-tan
  "prj_gCBePx6FI4pstOGVedAfakovRQjN"
]);

const projectId = String(process.env.VERCEL_PROJECT_ID || "");

if (RETIRED_PROJECT_IDS.has(projectId)) {
  console.log("FutbolRadar: emekli yan proje (" + projectId + ") — derleme atlandı. Yayın projesi: futbolradar.");
  process.exit(0);
}

console.log("FutbolRadar: Vercel deployment allowed for this commit.");
process.exit(1);
