-- =====================================================================
-- TAHMİNİN VERİ TEMELİ — yüzdenin yanına dayanağını da yaz.
--
-- 0004 tahmini üç KAYNAĞA (sağlayıcı / piyasa / model) bağladı. Eksik
-- kalan şuydu: `futbolradar_model` kaynaklı bir yüzde, iki takımın
-- doğrulanmış geçmişinden de üretilmiş olabilir, yalnızca turnuvanın
-- ölçülmüş taban oranından da. İkisi aynı sütunda "model" olarak
-- görünüyordu ve model, ikinci durumda hiç tahmin üretmeyip maç
-- sayfasını boş bırakıyordu (kupanın alt turları, ilk kez oynayan
-- takımlar).
--
-- Artık model bu maçlarda da çalışıyor; karşılığında tahminin NEYE
-- dayandığı kaydın kendi alanında taşınıyor:
--
--   team-history         → iki takımın da doğrulanmış maç geçmişi var
--   partial-history      → yalnızca bir tarafın geçmişi var
--   competition-baseline → yüzdeler turnuvanın ölçülmüş taban oranları
--
-- Arayüz alt iki kademede kartın içine açıklama yazar ve `confidence`
-- tavanlanır (services/fixtureProbabilityModel.js → DATA_BASIS).
--
-- Sütun NULL olabilir: sağlayıcı ve piyasa kayıtlarının veri temeli
-- kendi kaynak adlarında zaten yazılı, onlara zorla bir kademe
-- atamak yanlış bilgi olurdu. 0004'ten kalan satırlar da NULL kalır —
-- geriye dönük bir kademe UYDURULMAZ; bir sonraki tazelemede gerçek
-- değerle dolar.
-- =====================================================================

alter table fixture_predictions
  add column if not exists data_basis text
    check (data_basis is null or data_basis in ('team-history', 'partial-history', 'competition-baseline'));

create index if not exists fixture_predictions_data_basis_idx on fixture_predictions (data_basis);
