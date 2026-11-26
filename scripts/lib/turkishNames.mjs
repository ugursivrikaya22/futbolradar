/**
 * SAĞLAYICIDAN ASCII GELEN TÜRKÇE AD DÜZELTMELERİ.
 *
 * Transfer/maç geçmişi sağlayıcısı bazı yarışma ve saha adlarını Türkçe
 * karakterlerden arındırılmış verir ("Türkiye Kupasi", "2.Lig Kirmizi",
 * "Bodrum Ilce Stadi"). Okura görünen metinde bu yazımlar hatalıdır.
 *
 * Tablo BİLEREK dar: yalnızca yanlış olduğundan emin olduğumuz, tam ifadeler.
 * Genel bir "ASCII → Türkçe" dönüşümü kişi/kulüp adlarını bozar (örn. "Ozcan"
 * gerçekten "Özcan" mıdır, yoksa sağlayıcının yazımı mı — bilemeyiz).
 */
export const PROVIDER_NAME_FIXES = Object.freeze([
  ["Türkiye Kupasi", "Türkiye Kupası"],
  ["2.Lig Kirmizi", "2.Lig Kırmızı"],
  ["Ilce Stadi", "İlçe Stadı"]
]);

export function fixProviderTurkishName(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const [from, to] of PROVIDER_NAME_FIXES) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}
