# Oyuncu ↔ sağlayıcı eşleştirme raporu

Üretildi: 2026-11-26T09:50:13.697Z · `scripts/reconcile-player-provider-matches.mjs`

Yer tutucu (`mock-…`) kimlikli elle kayıtlar, aynı takımdaki sağlayıcı kayıtlarıyla ad varyasyonlarıyla (aksan, baş harf, kısa/tek ad, ters sıra) karşılaştırıldı.

> **Bu rapor veriye yazmaz.** "Eşleşen", sağlayıcı ikizinin bulunduğu anlamına gelir; kimlik henüz elle kayda bağlı değil. Aynı `providerId`'yi iki kayda birden yazmak `validate-football-coverage` doğrulamasını kırar, bu yüzden önce ikiz kayıtların birleştirilmesi gerekir.

## Özet

- Toplam oyuncu kaydı: **830** (yer tutucu: 126, sağlayıcı: 704)
- Sağlayıcı ikizi bulunan (eşleşen): **109** initial-surname: 101, token-subset: 5, initial-token-set: 1, exact: 1, token-set: 1
- Belirsiz (otomatik bağlanmadı): **0**
- Eşleşmeyen: **17**

## Eşleşmeyen oyuncular

| Oyuncu | Takım | Durum | Neden | Takımdaki sağlayıcı kaydı | İnceleme ipucu (bağlanmadı) |
| --- | --- | --- | --- | --- | --- |
| Mauro Icardi | Serbest oyuncu | manually_verified | Takımın sağlayıcı kadrosu depoda yok (serbest oyuncu / yurt dışı kulüp / kapsam dışı lig) | 0 | — |
| Edin Dzeko | Schalke 04 | transfer_needs_monitoring | Takımın sağlayıcı kadrosu depoda yok (serbest oyuncu / yurt dışı kulüp / kapsam dışı lig) | 0 | — |
| Sebastian Szymanski | Rennes | manually_verified | Takımın sağlayıcı kadrosu depoda yok (serbest oyuncu / yurt dışı kulüp / kapsam dışı lig) | 0 | — |
| Gedson Fernandes | Spartak Moskova | manually_verified | Takımın sağlayıcı kadrosu depoda yok (serbest oyuncu / yurt dışı kulüp / kapsam dışı lig) | 0 | — |
| Dominik Livaković | Fenerbahçe | verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 45 | — |
| İrfan Can Eğribayat | Gençlerbirliği | manually_verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 47 | İ. Eğribayat · Fenerbahçe · ad örtüşüyor ama takım farklı |
| Fred | Serbest oyuncu | manually_verified | Takımın sağlayıcı kadrosu depoda yok (serbest oyuncu / yurt dışı kulüp / kapsam dışı lig) | 0 | — |
| Talisca | Fenerbahçe | verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 45 | — |
| Michael Murillo | Beşiktaş | verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 38 | A. Murillo · Beşiktaş · aynı takımda ad parçası ortak, kişi farklı olabilir |
| Arda Öztürk | Trabzonspor | verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 43 | — |
| Ali Badra Diabaté | Samsunspor | verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 40 | Badra Diabbate Ali · Samsunspor · aynı takımda ad parçası ortak, kişi farklı olabilir; Cheick Diabate · Samsunspor · aynı takımda ad parçası ortak, kişi farklı olabilir |
| Samed Onur | Samsunspor | verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 40 | S. Onur · Gençlerbirliği S.K. · ad örtüşüyor ama takım farklı |
| Kazeem Olaigbe | Basel | manually_verified | Takımın sağlayıcı kadrosu depoda yok (serbest oyuncu / yurt dışı kulüp / kapsam dışı lig) | 0 | — |
| Christ Oulai | Fiorentina | manually_verified | Takımın sağlayıcı kadrosu depoda yok (serbest oyuncu / yurt dışı kulüp / kapsam dışı lig) | 0 | — |
| Jesus Ramirez | Çorum FK | manually_verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 34 | C. Ramírez · Çorum FK · aynı takımda ad parçası ortak, kişi farklı olabilir |
| Emre Demir | Corendon Alanyaspor | manually_verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 31 | E. Demir · Fenerbahçe · ad örtüşüyor ama takım farklı |
| Göktan Gürpüz | Çorum FK | manually_verified | Takım var, ama hiçbir sağlayıcı kaydıyla ad örtüşmüyor | 34 | G. Gürpüz · Gençlerbirliği S.K. · ad örtüşüyor ama takım farklı |

## Eşleşenler (sağlayıcı ikizi bulunan)

| Elle kayıt | Sağlayıcı kaydı | Sağlayıcı kimliği | Yöntem |
| --- | --- | --- | --- |
| Kerem Aktürkoğlu (`kerem-akturkoglu`) | K. Aktürkoğlu (`k-akturkoglu-fenerbahce`) | 142959 | initial-surname |
| Uğurcan Çakır (`ugurcan-cakir`) | U. Çakır (`u-cakir-galatasaray`) | 49866 | initial-surname |
| Abdülkerim Bardakcı (`abdulkerim-bardakci`) | A. Bardakcı (`a-bardakci-galatasaray`) | 61837 | initial-surname |
| Semih Kılıçsoy (`semih-kilicsoy`) | S. Kılıçsoy (`s-kilicsoy-besiktas`) | 336567 | initial-surname |
| Günay Güvenç (`gunay-guvenc`) | G. Güvenç (`g-guvenc-galatasaray`) | 61950 | initial-surname |
| Davinson Sánchez (`davinson-sanchez`) | D. Sánchez (`d-sanchez-galatasaray`) | 168 | initial-surname |
| Kaan Ayhan (`kaan-ayhan`) | K. Ayhan (`k-ayhan-galatasaray`) | 25448 | initial-surname |
| Victor Nelsson (`victor-nelsson`) | V. Nelsson (`v-nelsson-galatasaray`) | 15912 | initial-surname |
| Wilfried Singo (`wilfried-singo`) | W. Singo (`w-singo-galatasaray`) | 30504 | initial-surname |
| Ismail Jakobs (`ismail-jakobs`) | I. Jakobs (`i-jakobs-galatasaray`) | 158121 | initial-surname |
| Eren Elmalı (`eren-elmali`) | E. Elmalı (`e-elmali-galatasaray`) | 50057 | initial-surname |
| Elias Jelert (`elias-jelert`) | E. Jelert (`e-jelert-galatasaray`) | 341234 | initial-surname |
| Kazımcan Karataş (`kazimcan-karatas`) | K. Karataş (`k-karatas-galatasaray`) | 145057 | initial-surname |
| İlkay Gündoğan (`ilkay-gundogan`) | İ. Gündoğan (`i-gundogan-galatasaray`) | 633 | initial-surname |
| Lucas Torreira (`lucas-torreira`) | L. Torreira (`l-torreira-galatasaray`) | 1462 | initial-surname |
| Mario Lemina (`mario-lemina`) | M. Lemina (`m-lemina-galatasaray`) | 18947 | initial-surname |
| Lesley Ugochukwu (`lesley-ugochukwu`) | L. Ugochukwu (`l-ugochukwu-galatasaray`) | 270508 | initial-surname |
| Yunus Akgün (`yunus-akgun`) | Y. Akgün (`y-akgun-galatasaray`) | 454 | initial-surname |
| Roland Sallai (`roland-sallai`) | R. Sallai (`r-sallai-galatasaray`) | 26252 | initial-surname |
| Victor Osimhen (`victor-osimhen`) | V. Osimhen (`v-osimhen-galatasaray`) | 2780 | initial-surname |
| Leroy Sané (`leroy-sane`) | L. Sané (`l-sane-galatasaray`) | 644 | initial-surname |
| Barış Alper Yılmaz (`baris-alper-yilmaz`) | B. Yılmaz (`b-yilmaz-galatasaray`) | 63274 | initial-surname |
| Ederson Santana de Moraes (`ederson-santana-de-moraes`) | Ederson (`ederson-fenerbahce`) | 617 | token-subset |
| Nathan Aké (`nathan-ake`) | N. Aké (`n-ake-fenerbahce`) | 18861 | initial-surname |
| Milan Škriniar (`milan-skriniar`) | M. Škriniar (`m-skriniar-fenerbahce`) | 198 | initial-surname |
| Çağlar Söyüncü (`caglar-soyuncu`) | Ç. Söyüncü (`c-soyuncu-fenerbahce`) | 18776 | initial-surname |
| Mert Müldür (`mert-muldur`) | M. Müldür (`m-muldur-fenerbahce`) | 1719 | initial-surname |
| Jayden Oosterwolde (`jayden-oosterwolde`) | J. Oosterwolde (`j-oosterwolde-fenerbahce`) | 272721 | initial-surname |
| Archie Brown (`archie-brown`) | A. Brown (`a-brown-fenerbahce`) | 161661 | initial-surname |
| N'Golo Kanté (`ngolo-kante`) | N. Kanté (`n-kante-fenerbahce`) | 2290 | initial-surname |
| İsmail Yüksek (`ismail-yuksek`) | İ. Yüksek (`i-yuksek-fenerbahce`) | 214463 | initial-surname |
| Mattéo Guendouzi (`matteo-guendouzi`) | M. Guendouzi (`m-guendouzi-fenerbahce`) | 1454 | initial-surname |
| Mert Hakan Yandaş (`mert-hakan-yandas`) | M. Yandaş (`m-yandas-fenerbahce`) | 50097 | initial-surname |
| Mason Greenwood (`mason-greenwood`) | M. Greenwood (`m-greenwood-fenerbahce`) | 897 | initial-surname |
| Vedat Muriqi (`vedat-muriqi`) | V. Muriqi (`v-muriqi-fenerbahce`) | 50048 | initial-surname |
| Amara Diouf (`amara-diouf`) | A. Diouf (`a-diouf-fenerbahce`) | 417861 | initial-surname |
| Dorgeles Nene (`dorgeles-nene`) | N. Dorgeles (`n-dorgeles-fenerbahce`) | 302869 | initial-token-set |
| Alexander Nübel (`alexander-nubel`) | A. Nübel (`a-nubel-besiktas`) | 399 | initial-surname |
| Doğan Alemdar (`dogan-alemdar`) | D. Alemdar (`d-alemdar-besiktas`) | 50104 | initial-surname |
| Emre Bilgin (`emre-bilgin`) | E. Bilgin (`e-bilgin-besiktas`) | 275090 | initial-surname |
| Rıdvan Yılmaz (`ridvan-yilmaz`) | R. Yılmaz (`r-yilmaz-besiktas`) | 1987 | initial-surname |
| Kassoum Ouattara (`kassoum-ouattara`) | K. Ouattara (`k-ouattara-besiktas`) | 333137 | initial-surname |
| Emirhan Topçu (`emirhan-topcu`) | E. Topçu (`e-topcu-besiktas`) | 50046 | initial-surname |
| Emmanuel Agbadou (`emmanuel-agbadou`) | E. Agbadou (`e-agbadou-besiktas`) | 135068 | initial-surname |
| Felix Uduokhai (`felix-uduokhai`) | F. Uduokhai (`f-uduokhai-besiktas`) | 25406 | initial-surname |
| Taylan Bulut (`taylan-bulut`) | Taylan  Bulut (`taylan-bulut-besiktas`) | 394663 | exact |
| Orkun Kökçü (`orkun-kokcu`) | O. Kökçü (`o-kokcu-besiktas`) | 37155 | initial-surname |
| Salih Özcan (`salih-ozcan`) | S. Özcan (`s-ozcan-besiktas`) | 24807 | initial-surname |
| Wilfred Ndidi (`wilfred-ndidi`) | W. Ndidi (`w-ndidi-besiktas`) | 18786 | initial-surname |
| Vaclav Černý (`vaclav-cerny`) | V. Černý (`v-cerny-besiktas`) | 549 | initial-surname |
| Milot Rashica (`milot-rashica`) | M. Rashica (`m-rashica-besiktas`) | 25324 | initial-surname |
| Kartal Yılmaz (`kartal-yilmaz`) | K. Yılmaz (`k-yilmaz-besiktas`) | 1998 | initial-surname |
| Leandro Trossard (`leandro-trossard`) | L. Trossard (`l-trossard-besiktas`) | 1946 | initial-surname |
| Hyeon-gyu Oh (`hyeon-gyu-oh`) | Oh Hyeon-Gyu (`oh-hyeon-gyu-besiktas`) | 34710 | token-set |
| İlhan Fakılı (`ilhan-fakili`) | I. Fakili (`i-fakili-besiktas`) | 446824 | initial-surname |
| Andre Onana (`andre-onana`) | A. Onana (`a-onana-trabzonspor`) | 526 | initial-surname |
| Onuralp Çevikkan (`onuralp-cevikkan`) | O. Çevikkan (`o-cevikkan-trabzonspor`) | 394215 | initial-surname |
| Ahmet Doğan Yıldırım (`ahmet-dogan-yildirim`) | A. Yıldırım (`a-yildirim-trabzonspor`) | 479721 | initial-surname |
| Erol Can Çolak (`erol-can-colak`) | Erol Colak (`erol-colak-trabzonspor`) | 593479 | token-subset |
| Stefan Savić (`stefan-savic`) | S. Savić (`s-savic-trabzonspor`) | 39 | initial-surname |
| Cenk Özkaçar (`cenk-ozkacar`) | C. Özkacar (`c-ozkacar-trabzonspor`) | 72048 | initial-surname |
| Samet Akaydın (`samet-akaydin`) | S. Akaydin (`s-akaydin-trabzonspor`) | 62490 | initial-surname |
| Arseniy Batagov (`arseniy-batagov`) | A. Batagov (`a-batagov-trabzonspor`) | 63627 | initial-surname |
| Mustafa Eskihellaç (`mustafa-eskihellac`) | M. Eskihellaç (`m-eskihellac-trabzonspor`) | 62323 | initial-surname |
| Chibuike Nwaiwu (`chibuike-nwaiwu`) | C. Nwaiwu (`c-nwaiwu-trabzonspor`) | 371027 | initial-surname |
| Okay Yokuşlu (`okay-yokuslu`) | O. Yokuşlu (`o-yokuslu-trabzonspor`) | 47443 | initial-surname |
| Ozan Tufan (`ozan-tufan`) | O. Tufan (`o-tufan-trabzonspor`) | 49942 | initial-surname |
| Benjamin Bouchouari (`benjamin-bouchouari`) | B. Bouchouari (`b-bouchouari-trabzonspor`) | 274355 | initial-surname |
| Ruslan Malinovskyi (`ruslan-malinovskyi`) | R. Malinovskyi (`r-malinovskyi-trabzonspor`) | 1938 | initial-surname |
| Tim Jabol-Folcarelli (`tim-jabol-folcarelli`) | T. Jabol-Folcarelli (`t-jabol-folcarelli-trabzonspor`) | 22408 | initial-surname |
| Ernest Muçi (`ernest-muci`) | E. Muçi (`e-muci-trabzonspor`) | 3638 | initial-surname |
| Paul Onuachu (`paul-onuachu`) | P. Onuachu (`p-onuachu-trabzonspor`) | 15812 | initial-surname |
| Umut Nayir (`umut-nayir`) | U. Nayir (`u-nayir-trabzonspor`) | 50246 | initial-surname |
| Okan Kocuk (`okan-kocuk`) | O. Kocuk (`o-kocuk-samsunspor`) | 50217 | initial-surname |
| Bilal Bayazıt (`bilal-bayazit`) | B. Bayazıt (`b-bayazit-samsunspor`) | 37111 | initial-surname |
| Efe Yiğit Üstün (`efe-yigit-ustun`) | Efe Üstün (`efe-ustun-samsunspor`) | 525877 | token-subset |
| Joe Mendes (`joe-mendes`) | J. Mendes (`j-mendes-samsunspor`) | 310029 | initial-surname |
| Logi Tómasson (`logi-tomasson`) | L. Tómasson (`l-tomasson-samsunspor`) | 28806 | initial-surname |
| Enes Albak (`enes-albak`) | E. Albak (`e-albak-samsunspor`) | 638543 | initial-surname |
| Yunus Emre Çift (`yunus-emre-cift`) | Y. Çift (`y-cift-samsunspor`) | 273762 | initial-surname |
| Bedirhan Çetin (`bedirhan-cetin`) | B. Çetin (`b-cetin-samsunspor`) | 368103 | initial-surname |
| Celil Yüksel (`celil-yuksel`) | C. Yüksel (`c-yuksel-samsunspor`) | 453 | initial-surname |
| Emre Kılınç (`emre-kilinc`) | E. Kılınç (`e-kilinc-samsunspor`) | 50091 | initial-surname |
| Yalçın Kayan (`yalcin-kayan`) | Y. Kayan (`y-kayan-samsunspor`) | 50181 | initial-surname |
| Carlo Holse (`carlo-holse`) | C. Holse (`c-holse-samsunspor`) | 15837 | initial-surname |
| Antoine Makoumbou (`antoine-makoumbou`) | A. Makoumbou (`a-makoumbou-samsunspor`) | 290046 | initial-surname |
| Elliot Watt (`elliot-watt`) | E. Watt (`e-watt-samsunspor`) | 18749 | initial-surname |
| Elayis Tavşan (`elayis-tavsan`) | E. Tavşan (`e-tavsan-samsunspor`) | 93001 | initial-surname |
| Marius Mouandilmadji (`marius-mouandilmadji`) | Marius (`marius-samsunspor`) | 531370 | token-subset |
| Cherif Ndiaye (`cherif-ndiaye`) | C. Ndiaye (`c-ndiaye-samsunspor`) | 14379 | initial-surname |
| Fatih Kaya (`fatih-kaya`) | F. Kaya (`f-kaya-samsunspor`) | 25223 | initial-surname |
| Cheick Tidiane Diabate (`cheick-tidiane-diabate`) | Cheick Diabate (`cheick-diabate-samsunspor`) | 677564 | token-subset |
| Edin Vişça (`edin-visca`) | E. Višća (`e-visca-basaksehir`) | 49860 | initial-surname |
| Emin Bayram (`emin-bayram`) | E. Bayram (`e-bayram-basaksehir`) | 162513 | initial-surname |
| Tayyip Talha Sanuç (`tayyip-talha-sanuc`) | T. Sanuç (`t-sanuc-rizespor`) | 61993 | initial-surname |
| Romelu Lukaku (`romelu-lukaku`) | R. Lukaku (`r-lukaku-fenerbahce`) | 907 | initial-surname |
| Dusan Vlahovic (`dusan-vlahovic`) | D. Vlahović (`d-vlahovic-besiktas`) | 30415 | initial-surname |
| Umut Erdem (`umut-erdem`) | U. Erdem (`u-erdem-rizespor`) | 388994 | initial-surname |
| Salih Uçan (`salih-ucan`) | S. Uçan (`s-ucan-genclerbirligi-s-k`) | 31058 | initial-surname |
| Igor Drapinski (`igor-drapinski`) | I. Drapiński (`i-drapinski-samsunspor`) | 346522 | initial-surname |
| Serdar Dursun (`serdar-dursun`) | S. Dursun (`s-dursun-gaziantep-fk`) | 25053 | initial-surname |
| Muhammed Emin Bektaş (`muhammed-emin-bektas`) | M. Bektas (`m-bektas-kasimpasa`) | 628500 | initial-surname |
| Baran Ali Gezek (`baran-ali-gezek`) | B. Gezek (`b-gezek-alanyaspor`) | 371932 | initial-surname |
| Şahin Dik (`sahin-dik`) | Ş. Dik (`s-dik-alanyaspor`) | 366672 | initial-surname |
| Markus Karlsbakk (`markus-karlsbakk`) | M. Karlsbakk (`m-karlsbakk-corum-fk`) | 57152 | initial-surname |
| Kévin Mouanga (`kevin-mouanga`) | K. Mouanga (`k-mouanga-kasimpasa`) | 21149 | initial-surname |
| Ernest Poku (`ernest-poku`) | E. Poku (`e-poku-besiktas`) | 312840 | initial-surname |
| Fabio Miretti (`fabio-miretti`) | F. Miretti (`f-miretti-besiktas`) | 181808 | initial-surname |
| Kojo Peprah Oppong (`kojo-peprah-oppong`) | K. Peprah Oppong (`k-peprah-oppong-fenerbahce`) | 404172 | initial-surname |

