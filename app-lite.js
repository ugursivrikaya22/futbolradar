(function () {
  "use strict";

  var PLAYER_SLUGS = /* futbolradar:player-slugs:start */ {"a-abdullahi-eyupspor":"ahmed-abdullahi","a-antunes-goztepe":"alexis-antunes","a-arous-kasimpasa":"adem-arous","a-bardakci-galatasaray":"abdulkerim-bardakci","a-batagov-trabzonspor":"arseniy-batagov","a-batrakov-galatasaray":"aleksey-batrakov","a-benedyczak-kasimpasa":"adrian-benedyczak","a-borza-corum-fk":"andrei-borza","a-bosluk-trabzonspor":"arif-bosluk","a-brown-fenerbahce":"archie-brown","a-bulbul-galatasaray":"ali-turap-bulbul","a-cisse-amed":"alphadjo-cisse","a-demirbag-konyaspor":"adil-demirbag","a-dijksteel-kocaelispor":"anfernee-jamal-dijksteel","a-diouf-fenerbahce":"amara-diouf","a-dursun-genclerbirligi-s-k":"abdurrahim-dursun","a-fayzullaev-basaksehir":"abbosbek-fayzullaev","a-gerxhaliu-erzurumspor-fk":"amar-gerxhaliu","a-gianniotis-kasimpasa":"andreas-gianniotis","a-ildiz-corum-fk":"ahmed-ildiz","a-karapo-kasimpasa":"ayberk-karapo","a-kizildag-gaziantep-fk":"arda-kizildag","a-kol-kasimpasa":"ali-yavuz-kol","a-kurtulan-goztepe":"arda-kurtulan","a-kutucu-galatasaray":"ahmed-kutucu","a-kyziridis-corum-fk":"alexandros-kyziridis","a-lafont-amed":"alban-lafont","a-makoumbou-samsunspor":"antoine-makoumbou","a-masuaku-konyaspor":"arthur-masuaku","a-maxim-gaziantep-fk":"alexandru-maxim","a-mocsi-rizespor":"attila-mocsi","a-mujde-kasimpasa":"atakan-mujde","a-murillo-besiktas":"amir-murillo","a-nubel-besiktas":"alexander-nubel","a-o-kalin-gaziantep-fk":"ali-osman-kalin","a-onana-trabzonspor":"andre-onana","a-ozcimen-goztepe":"arda-ozcimen","a-sengul-corum-fk":"arda-sengul","a-simsir-trabzonspor":"aral-simsir","a-sowe-rizespor":"ali-sowe","a-sylla-gaziantep-fk":"abakar-sylla","a-t-dagbasi-kasimpasa":"ahmet-taha-dagbasi","a-traore-genclerbirligi-s-k":"adama-malouda-traore","a-ulgen-erzurumspor-fk":"ali-ulgen","a-unyay-galatasaray":"arda-unyay","a-usluoglu-alanyaspor":"arda-usluoglu","a-yanar-kasimpasa":"ali-emre-yanar","a-yanik-konyaspor":"ata-yanik","a-yasar-rizespor":"anil-yasar","a-yesilyurt-fenerbahce":"adem-yesilyurt","a-yildirim-trabzonspor":"ahmet-dogan-yildirim","a-yilmaz-galatasaray":"abdul-malik-yilmaz","a-yuzgec-galatasaray":"ada-yuzgec","abdoulaye-yoro-basaksehir":"abdoulaye-yoro","adedire-emmanuel-awokoya-mebude-rizespor":"adedire-emmanuel-awokoya-mebude","afonso-sousa":"afonso-sousa","alaettin-ekici-fenerbahce":"alaettin-ekici","alex-matos-goztepe":"alex-matos","alexandre-penetra-corum-fk":"alexandre-penetra","ali-badra-diabate":"ali-badra-diabate","allan-godoi-goztepe":"allan-godoi","andre-henrique-goztepe":"andre-henrique","arda-aslan-erk-genclerbirligi-s-k":"arda-aslan-erk","arda-ozturk":"arda-ozturk","arda-ozyar-kocaelispor":"arda-ozyar","b-baiye-erzurumspor-fk":"brandon-baiye","b-bayazit-samsunspor":"bilal-bayazit","b-bouchouari-trabzonspor":"benjamin-bouchouari","b-boutobba-eyupspor":"bilal-boutobba","b-bozan-amed":"burak-bozan","b-cetin-samsunspor":"bedirhan-cetin","b-elmaz-fenerbahce":"bartug-elmaz","b-gezek-alanyaspor":"baran-ali-gezek","b-gungordu-konyaspor":"bahadir-han-gungordu","b-kizildemir-amed":"berk-kizildemir","b-kramer-konyaspor":"blaz-kramer","b-kutlu-kocaelispor":"berkan-kutlu","b-ozcan-basaksehir":"berkay-ozcan","b-ozyurt-alanyaspor":"bedirhan-ozyurt","b-yildirim-basaksehir":"bertug-yildirim","b-yildiz-kocaelispor":"bedirhan-yildiz","b-yilmaz-galatasaray":"baris-alper-yilmaz","badra-diabbate-ali-samsunspor":"badra-diabbate-ali","batuhan-yavuz-alanyaspor":"batuhan-yavuz","bedri-kara-omer-eyupspor":"bedri-kara-omer","berat-lus-galatasaray":"berat-lus","berat-percin-amed":"berat-percin","berke-baran-eyupspor":"berke-baran","bilal-sari-genclerbirligi-s-k":"bilal-sari","bruno-viana-alanyaspor":"bruno-viana","burak-gultekin-kasimpasa":"burak-gultekin","c-awaziem-konyaspor":"chidozie-awaziem","c-bayrak-erzurumspor-fk":"cengizhan-bayrak","c-bozdogan-rizespor":"can-bozdogan","c-guner-galatasaray":"can-armando-guner","c-holse-samsunspor":"carlo-holse","c-massanga-eyupspor":"chandrel-massanga","c-ndiaye-samsunspor":"cherif-ndiaye","c-nwaiwu-trabzonspor":"chibuike-nwaiwu","c-operi-basaksehir":"christopher-operi","c-ozkacar-trabzonspor":"cenk-ozkacar","c-raux-yao-eyupspor":"charles-andre-raux-yao","c-sertel-corum-fk":"cemali-sertel","c-soyuncu-fenerbahce":"caglar-soyuncu","c-under-fenerbahce":"cengiz-under","c-ustundag-amed":"cem-ustundag","c-yuksel-samsunspor":"celil-yuksel","cemali-yagmur-eren-konyaspor":"cemali-yagmur-eren","cheick-diabate-samsunspor":"cheick-tidiane-diabate","christ-oulai":"christ-oulai","christ-sadia-eyupspor":"christ-sadia","claudio-winck-kasimpasa":"claudio-winck","coskun-tosun-mustafa-rizespor":"coskun-tosun-mustafa","d-agyei-kocaelispor":"daniel-agyei","d-alemdar-besiktas":"dogan-alemdar","d-bates-amed":"david-robert-bates","d-camara-gaziantep-fk":"drissa-camara","d-ceylan-kocaelispor":"deniz-ceylan","d-dilmen-basaksehir":"deniz-dilmen","d-ertas-konyaspor":"deniz-ertas","d-goutas-genclerbirligi-s-k":"dimitris-goutas","d-gul-galatasaray":"deniz-gul","d-sanchez-galatasaray":"davinson-sanchez","d-selke-basaksehir":"davie-selke","d-sorescu-gaziantep-fk":"deian-sorescu","d-turuc-konyaspor":"deniz-turuc","d-varesanovic-genclerbirligi-s-k":"dal-varesanovic","d-vlahovic-besiktas":"dusan-vlahovic","da-mata-konyaspor":"da-mata","david-costa-eyupspor":"david-costa","deniz-aydogdu-eyupspor":"deniz-aydogdu","devrim-sahin-besiktas":"devrim-sahin","diabel-ndoye-eyupspor":"diabel-ndoye","dilhan-demir-amed":"dilhan-demir","diogo-goncalves-konyaspor":"diogo-goncalves","dominik-livakovic":"dominik-livakovic","dorgeles-nene":"dorgeles-nene","e-agbadou-besiktas":"emmanuel-agbadou","e-albak-samsunspor":"enes-albak","e-aydin-konyaspor":"enes-aydin","e-bardhi-konyaspor":"enis-bardhi","e-bars-konyaspor":"emir-bars","e-bekiroglu-goztepe":"efkan-bekiroglu","e-bilgin-besiktas":"emre-bilgin","e-bilim-kocaelispor":"ege-bilim","e-bitshiabu-galatasaray":"el-chadaille-bitshiabu","e-boz-kasimpasa":"emirhan-boz","e-bulut-rizespor":"emrecan-bulut","e-colley-konyaspor":"ebrima-colley","e-destan-konyaspor":"enis-destan","e-dogan-konyaspor":"ertugrul-dogan","e-e-buyuk-galatasaray":"enes-emre-buyuk","e-elmali-galatasaray":"eren-elmali","e-erenturk-genclerbirligi-s-k":"erhan-erenturk","e-gurluk-corum-fk":"emircan-gurluk","e-jelert-galatasaray":"elias-jelert","e-keskin-alanyaspor":"enes-keskin","e-kilinc-samsunspor":"emre-kilinc","e-krasniqi-amed":"ermal-krasniqi","e-muci-trabzonspor":"ernest-muci","e-ortakaya-kocaelispor":"emir-ortakaya","e-owusu-erzurumspor-fk":"elisha-owusu","e-poku-besiktas":"ernest-poku","e-sarikaya-gaziantep-fk":"efe-sarikaya","e-shomurodov-basaksehir":"eldor-shomurodov","e-taskiran-erzurumspor-fk":"ertugrul-taskiran","e-tavsan-samsunspor":"elayis-tavsan","e-topcu-besiktas":"emirhan-topcu","e-tozlu-erzurumspor-fk":"eren-tozlu","e-watt-samsunspor":"elliot-watt","ederson-santana-de-moraes":"ederson-santana-de-moraes","edin-dzeko":"edin-dzeko","edin-visca":"edin-visca","efe-berat-toruz-samsunspor":"efe-berat-toruz","efe-ustun-samsunspor":"efe-yigit-ustun","ege-ozturk-basaksehir":"ege-ozturk","ege-yildirim-goztepe":"ege-yildirim","egehan-sensoy-konyaspor":"egehan-sensoy","elson-mendes-kasimpasa":"elson-mendes","elysee-dalo-stann-kasimpasa":"elysee-dalo-stann","emin-bayram":"emin-bayram","emirhan-unal-genclerbirligi-s-k":"emirhan-unal","emirzat-baycu-genclerbirligi-s-k":"emirzat-baycu","emre-demir-alanyaspor":"emre-demir","enes-ilik-amed":"enes-ilik","enes-yigit-erzurumspor-fk":"enes-yigit","eren-aydogdu-eyupspor":"eren-aydogdu","eren-ozdemir-erzurumspor-fk":"eren-ozdemir","eric-konate-konyaspor":"eric-konate","ermin-mahmic-corum-fk":"ermin-mahmic","erol-colak-trabzonspor":"erol-can-colak","esat-narin-kocaelispor":"esat-narin","eyup-degirmenci-samsunspor":"eyup-degirmenci","f-afena-gyan-amed":"felix-afena-gyan","f-aksoy-alanyaspor":"fatih-aksoy","f-aliti-alanyaspor":"fidan-aliti","f-aye-kocaelispor":"florian-aye","f-ebosele-basaksehir":"festy-ebosele","f-hadergjonaj-alanyaspor":"florent-hadergjonaj","f-kaya-samsunspor":"fatih-kaya","f-miretti-besiktas":"fabio-miretti","f-soyalp-amed":"furkan-soyalp","f-tongya-genclerbirligi-s-k":"franco-tongya","f-uduokhai-besiktas":"felix-uduokhai","f-uzum-genclerbirligi-s-k":"firatcan-uzum","fahri-kerem-ay-besiktas":"fahri-kerem-ay","fernando-andrade-erzurumspor-fk":"fernando-andrade","franculino-dju-trabzonspor":"franculino-dju","fredy-corum-fk":"alfredo-fredy","g-akkan-genclerbirligi-s-k":"gokhan-akkan","g-giorbelidze-erzurumspor-fk":"guram-giorbelidze","g-guarino-samsunspor":"gabriele-guarino","g-guvenc-galatasaray":"gunay-guvenc","g-kerk-erzurumspor-fk":"gyrano-kerk","g-makouta-alanyaspor":"gaius-makouta","g-orban-amed":"gift-orban","g-sazdagi-corum-fk":"gokhan-sazdagi","g-yalcin-alanyaspor":"guven-yalcin","gabriel-sara":"gabriel-sara","gedson-fernandes":"gedson-fernandes","goktan-gurpuz":"goktan-gurpuz","guilherme-luiz-goztepe":"guilherme-luiz","guillaume-larcher-amed":"guillaume-larcher","h-akman-eyupspor":"hamza-akman","h-dervisoglu-gaziantep-fk":"halil-dervisoglu","h-hajradinovic-kasimpasa":"haris-hajradinovic","h-moldovan-eyupspor":"horatiu-moldovan","h-smolcic-corum-fk":"hrvoje-smolcic","h-tan-samsunspor":"haluk-mustafa-tan","hamza-gureler-basaksehir":"hamza-gureler","haydar-karatas-kocaelispor":"haydar-karatas","hulusi-efe-ceylan-fenerbahce":"hulusi-efe-ceylan","hwang-ui-jo-alanyaspor":"hwang-ui-jo","hyeon-gyu-oh":"hyeon-gyu-oh","i-brnic-basaksehir":"ivan-brnic","i-celik-alanyaspor":"izzet-celik","i-diabate-erzurumspor-fk":"ibrahim-diabate","i-drapinski-samsunspor":"igor-drapinski","i-fakili-besiktas":"ilhan-fakili","i-gundogan-galatasaray":"ilkay-gundogan","i-hagi-alanyaspor":"ianis-hagi","i-jakobs-galatasaray":"ismail-jakobs","i-kahveci-fenerbahce":"irfan-can-kahveci","i-kaya-alanyaspor":"ibrahim-kaya","i-olawoyin-rizespor":"ibrahim-olawoyin","i-yuksek-fenerbahce":"ismail-yuksek","ibrahim-kagan-alkis-gaziantep-fk":"ibrahim-kagan-alkis","ibrahim-sabra-goztepe":"ibrahim-sabra","ibrahima-bah-konyaspor":"ibrahima-bah","ilkan-sever-erzurumspor-fk":"ilkan-sever","irfan-can-egribayat":"irfan-can-egribayat","iustin-doicaru-rizespor":"iustin-doicaru","ivan-cedric-alanyaspor":"ivan-cedric","j-bacuna-gaziantep-fk":"juninho-bacuna","j-dompe-konyaspor":"jean-luc-dompe","j-el-yamiq-eyupspor":"jawad-el-yamiq","j-jessen-kasimpasa":"jakob-jessen","j-mendes-samsunspor":"joe-mendes","j-muleka-konyaspor":"jackson-muleka","j-olaitan-besiktas":"junior-olaitan","j-oosterwolde-fenerbahce":"jayden-oosterwolde","j-opoku-basaksehir":"jerome-opoku","j-rak-sakyi-kasimpasa":"jesurun-rak-sakyi","j-yilmaz-galatasaray":"jankat-yilmaz","jesus-ramirez":"jesus-ramirez","jo-jin-ho-konyaspor":"jo-jin-ho","k-ayhan-galatasaray":"kaan-ayhan","k-calhanoglu-gaziantep-fk":"kerim-calhanoglu","k-demirbay-kasimpasa":"kerem-demirbay","k-demirtas-amed":"kahraman-demirtas","k-fakili-corum-fk":"kenan-fakili","k-gassama-gaziantep-fk":"karamba-gassama","k-karatas-galatasaray":"kazimcan-karatas","k-koz-owski-gaziantep-fk":"kacper-kozlowski","k-michalak-eyupspor":"konrad-michalak","k-mouanga-kasimpasa":"kevin-mouanga","k-ouattara-besiktas":"kassoum-ouattara","k-peprah-oppong-fenerbahce":"kojo-peprah-oppong","k-tobiasz-gaziantep-fk":"kacper-tobiasz","k-yilmaz-besiktas":"kartal-yilmaz","kadir-gumus-gaziantep-fk":"kadir-gumus","kamil-efe-uregen-fenerbahce":"kamil-efe-uregen","kazeem-olaigbe":"kazeem-olaigbe","kerem-akturkoglu":"kerem-akturkoglu","kerem-erener-erzurumspor-fk":"kerem-erener","kerim-yerlikaya-eyupspor":"kerim-yerlikaya","kevin-rodrigues-genclerbirligi-s-k":"kevin-rodrigues","kutlay-satli-berhan-eyupspor":"kutlay-satli-berhan","kuzey-sapaz-fenerbahce":"kuzey-sapaz","l-dellova-amed":"lumbardh-dellova","l-gugeshashvili-goztepe":"luka-gugeshashvili","l-mercan-fenerbahce":"levent-mercan","l-pintor-eyupspor":"lenny-pintor","l-sane-galatasaray":"leroy-sane","l-tomasson-samsunspor":"logi-tomasson","l-torreira-galatasaray":"lucas-torreira","l-trossard-besiktas":"leandro-trossard","l-ugochukwu-galatasaray":"lesley-ugochukwu","luis-perez-gaziantep-fk":"luis-perez","m-abena-gaziantep-fk":"myenty-abena","m-acer-amed":"mirac-acer","m-altunbas-eyupspor":"metehan-altunbas","m-baku-kocaelispor":"makana-baku","m-baltaci-genclerbirligi-s-k":"metehan-baltaci","m-bayo-samsunspor":"mohamed-bayo","m-bayram-alanyaspor":"mert-furkan-bayram","m-bektas-kasimpasa":"muhammed-emin-bektas","m-bokele-goztepe":"malcom-bokele","m-bostan-konyaspor":"melih-bostan","m-cinan-kocaelispor":"muharrem-cinan","m-demir-eyupspor":"mete-demir","m-deniz-kasimpasa":"mecit-deniz","m-diagne-amed":"mbaye-diagne","m-diakite-rizespor":"moussa-diakite","m-diomande-corum-fk":"mohammed-diomande","m-elia-alanyaspor":"meschak-elia","m-eskihellac-trabzonspor":"mustafa-eskihellac","m-fettahoglu-erzurumspor-fk":"mustafa-fettahoglu","m-greenwood-fenerbahce":"mason-greenwood","m-guendouzi-fenerbahce":"matteo-guendouzi","m-gunok-fenerbahce":"mert-gunok","m-haidara-kocaelispor":"massadio-haidara","m-ibrahimoglu-konyaspor":"melih-ibrahimoglu","m-ilie-kasimpasa":"matei-ilie","m-jevtovic-konyaspor":"marko-jevtovic","m-kabasakal-trabzonspor":"melih-kabasakal","m-karakas-eyupspor":"musa-karakas","m-karbownik-basaksehir":"michal-karbownik","m-karlsbakk-corum-fk":"markus-karlsbakk","m-khalil-amed":"mohamed-khalil","m-lemina-galatasaray":"mario-lemina","m-maglica-kocaelispor":"matej-maglica","m-mimaroglu-trabzonspor":"metehan-mimaroglu","m-muldur-fenerbahce":"mert-muldur","m-orbanic-erzurumspor-fk":"matija-orbanic","m-pala-rizespor":"mithat-pala","m-rafferty-kasimpasa":"marcus-rafferty","m-rashica-besiktas":"milot-rashica","m-sagnan-rizespor":"modibo-sagnan","m-sengezer-basaksehir":"muhammed-sengezer","m-skriniar-fenerbahce":"milan-skriniar","m-yesil-amed":"mehmet-yesil","m-yumlu-erzurumspor-fk":"mustafa-yumlu","mahamadou-susoho-sissoho-kocaelispor":"mahamadou-susoho-sissoho","mahmut-can-kara-alanyaspor":"mahmut-can-kara","marco-asensio":"marco-asensio","marcos-felipe-corum-fk":"marcos-felipe","marius-mouandilmadji":"marius-mouandilmadji","mauro-icardi":"mauro-icardi","mehmet-karsli-samsunspor":"mehmet-karsli","mert-hakan-yandas":"mert-hakan-yandas","michael-murillo":"michael-murillo","miguel-cardoso-erzurumspor-fk":"miguel-cardoso","miguel-crespo-basaksehir":"miguel-crespo","mohamed-fofana-konyaspor":"mohamed-fofana","mohamed-salah":"mohamed-salah","mostafa-mohamed-konyaspor":"mostafa-mohamed","muhammed-kucuk-kocaelispor":"muhammed-kucuk","n-ake-fenerbahce":"nathan-ake","n-kante-fenerbahce":"n-golo-kante","n-mujakic-erzurumspor-fk":"nihad-mujakic","n-saviolo-trabzonspor":"noah-saviolo","nelson-semedo":"nelson-semedo","nuno-da-costa-basaksehir":"nuno-da-costa","nuno-lima-alanyaspor":"nuno-lima","o-aydin-fenerbahce":"oguz-aydin","o-ba-basaksehir":"ousseynou-ba","o-bayrak-goztepe":"ogun-bayrak","o-ben-ali-alanyaspor":"omar-ben-ali","o-bulut-basaksehir":"onur-bulut","o-cevikkan-trabzonspor":"onuralp-cevikkan","o-ergun-basaksehir":"onur-ergun","o-kocuk-samsunspor":"okan-kocuk","o-kokcu-besiktas":"orkun-kokcu","o-matur-amed":"oguzhan-matur","o-ovacikli-erzurumspor-fk":"orhan-ovacikli","o-ozcicek-gaziantep-fk":"ogun-ozcicek","o-oztonga-kocaelispor":"onur-oztonga","o-piri-kocaelispor":"onurcan-piri","o-sahiner-basaksehir":"omer-ali-sahiner","o-tufan-trabzonspor":"ozan-tufan","o-ulgun-genclerbirligi-s-k":"ogulcan-ulgun","o-yokuslu-trabzonspor":"okay-yokuslu","oh-hyeon-gyu-besiktas":"oh-hyeon-gyu","omar-fayed-fenerbahce":"omar-fayed","omer-ahmet-ceyhan-eyupspor":"omer-ahmet-ceyhan","omer-ay-eyupspor":"omer-ay","omer-cobanoglu-konyaspor":"omer-cobanoglu","omer-faruk-ugurlu-eyupspor":"omer-faruk-ugurlu","omer-kara-erzurumspor-fk":"omer-kara","ousmane-diabate-genclerbirligi-s-k":"ousmane-diabate","p-gueye-kasimpasa":"pape-gueye","p-martor-genclerbirligi-s-k":"prince-martor","p-onuachu-trabzonspor":"paul-onuachu","paolo-fernandes-alanyaspor":"paolo-fernandes","paulo-victor-alanyaspor":"paulo-victor","pedro-pereira-genclerbirligi-s-k":"pedro-pereira","q-laci-rizespor":"qazim-laci","r-akonnor-goztepe":"richard-akonnor","r-baniya-konyaspor":"rayyan-baniya","r-lukaku-fenerbahce":"romelu-lukaku","r-lutin-amed":"rayan-lutin","r-malinovskyi-trabzonspor":"ruslan-malinovskyi","r-raveloson-amed":"rayan-raveloson","r-sallai-galatasaray":"roland-sallai","r-yilmaz-besiktas":"ridvan-yilmaz","rafael-leao":"rafael-leao","recep-yalin-dilek-galatasaray":"recep-yalin-dilek","renato-nhaga-galatasaray":"renato-nhaga","ricardo-velho-genclerbirligi-s-k":"ricardo-velho","rodrigo-becao-fenerbahce":"rodrigo-becao","ruan-alanyaspor":"pablo-ruan","s-akaydin-trabzonspor":"samet-akaydin","s-akgun-erzurumspor-fk":"sefa-akgun","s-armstrong-goztepe":"sinclair-armstrong","s-bakayoko-rizespor":"siaka-bakayoko","s-ballet-amed":"samuel-ballet","s-dik-alanyaspor":"sahin-dik","s-dursun-gaziantep-fk":"serdar-dursun","s-giordano-eyupspor":"simone-giordano","s-gurler-corum-fk":"serdar-gurler","s-hansen-gaziantep-fk":"sontje-hansen","s-kilicsoy-besiktas":"semih-kilicsoy","s-koita-genclerbirligi-s-k":"sekou-koita","s-lopes-cabral-trabzonspor":"sidny-lopes-cabral","s-ozcan-besiktas":"salih-ozcan","s-oztasdelen-kocaelispor":"serhat-oztasdelen","s-saatci-corum-fk":"serdar-saatci","s-savic-trabzonspor":"stefan-savic","sabahattin-destici-gaziantep-fk":"sabahattin-destici","saikuba-jarju-samsunspor":"saikuba-jarju","salih-arici-kasimpasa":"salih-arici","salih-ucan":"salih-ucan","samed-onur":"samed-onur","samet-kalkan-mehmet-gaziantep-fk":"samet-kalkan-mehmet","sami-bircan-ahmet-besiktas":"sami-bircan-ahmet","sebastian-szymanski":"sebastian-szymanski","seyfi-kiskanc-genclerbirligi-s-k":"seyfi-kiskanc","seyfi-toprak-genclerbirligi-s-k":"seyfi-toprak","t-altikardes-goztepe":"taha-altikardes","t-antalyali-rizespor":"taylan-antalyali","t-bingol-kocaelispor":"tayfur-bingol","t-cetin-fenerbahce":"tarik-cetin","t-coulibaly-samsunspor":"tanguy-coulibaly","t-diarra-kasimpasa":"thiemoko-diarra","t-gulliksen-kocaelispor":"tobias-gulliksen","t-ilter-eyupspor":"taskin-ilter","t-jabol-folcarelli-trabzonspor":"tim-jabol-folcarelli","t-sahin-rizespor":"taha-sahin","t-stewart-gaziantep-fk":"trivante-stewart","t-ulvan-eyupspor":"talha-ulvan","tahsin-bulbul-samsunspor":"tahsin-bulbul","talha-akkaya-eyupspor":"talha-akkaya","talha-polat-kocaelispor":"talha-polat","talisca":"anderson-talisca","taylan-bulut-besiktas":"taylan-bulut","tayyip-talha-sanuc":"tayyip-talha-sanuc","thalisson-kelven-genclerbirligi-s-k":"thalisson-kelven","tiago-djalo":"tiago-djalo","tiago-gouveia-genclerbirligi-s-k":"tiago-gouveia","u-akdag-alanyaspor":"umit-akdag","u-cakir-galatasaray":"ugurcan-cakir","u-gunes-basaksehir":"umut-gunes","u-meras-amed":"umut-meras","u-nayir-trabzonspor":"umut-nayir","u-yazgili-konyaspor":"ugurcan-yazgili","u-yildiz-kocaelispor":"ugur-kaan-yildiz","umut-erdem":"umut-erdem","v-babacan-basaksehir":"volkan-babacan","v-cerny-besiktas":"vaclav-cerny","v-gidado-gaziantep-fk":"victor-gidado","v-mihaila-rizespor":"valentin-mihaila","v-muriqi-fenerbahce":"vedat-muriqi","v-nelsson-galatasaray":"victor-nelsson","v-orakpo-genclerbirligi-s-k":"victor-orakpo","v-osimhen-galatasaray":"victor-osimhen","w-ndidi-besiktas":"wilfred-ndidi","w-singo-galatasaray":"wilfried-singo","wagner-pina":"wagner-pina","y-akgun-galatasaray":"yunus-akgun","y-andzouana-konyaspor":"yhoan-andzouana","y-aydar-genclerbirligi-s-k":"yigit-hamza-aydar","y-barasi-kasimpasa":"yusuf-barasi","y-cift-samsunspor":"yunus-emre-cift","y-kayan-samsunspor":"yalcin-kayan","y-kirtay-erzurumspor-fk":"yakup-kirtay","y-moukoko-corum-fk":"youssoufa-moukoko","y-ozdemir-alanyaspor":"yusuf-ozdemir","y-ramadani-corum-fk":"ylber-ramadani","y-sari-basaksehir":"yusuf-sari","y-sen-fenerbahce":"yagiz-sen","yigit-demir-eyupspor":"yigit-demir","yigit-fidan-fenerbahce":"yigit-fidan","yigithan-cubukcu-trabzonspor":"yigithan-cubukcu","yusuf-nazar-gaziantep-fk":"yusuf-nazar","z-ariss-rizespor":"zakaria-ariss","z-gorgen-rizespor":"zafer-gorgen","z-jules-eyupspor":"zak-jules"} /* futbolradar:player-slugs:end */;

  function playerCanonicalUrl(playerId) {
    var slug = PLAYER_SLUGS[playerId];
    return slug
      ? "https://www.futbolradar.com/futbolcu/" + encodeURIComponent(slug)
      : "https://www.futbolradar.com/oyuncular/" + encodeURIComponent(playerId) + ".html";
  }

  function initShareBlocks() {
    document.addEventListener("click", function (event) {
      var button = event.target.closest("[data-share-copy]");
      if (!button) return;

      var block = button.closest("[data-share-block]");
      var text = block ? block.getAttribute("data-share-text") : "";
      if (!text) return;

      function confirmCopy() {
        var previous = button.textContent;
        button.textContent = "Kopyalandı";
        button.setAttribute("data-copied", "true");
        window.setTimeout(function () {
          button.textContent = previous;
          button.removeAttribute("data-copied");
        }, 1600);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(confirmCopy).catch(function () { showShareFallback(button, text); });
        return;
      }

      // Pano API'si yoksa (eski tarayıcı, güvensiz bağlam) metin seçilir;
      // kullanıcı kendisi kopyalayabilir. Sessizce hiçbir şey yapmamak,
      // düğmenin bozuk görünmesi demek olurdu.
      var field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "readonly");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        if (document.execCommand("copy")) confirmCopy();
        else showShareFallback(button, text);
      } catch (error) {
        showShareFallback(button, text);
      }
      document.body.removeChild(field);
    });
  }

  function initPlayerSharing() {
    document.addEventListener("click", function (event) {
      var urlButton = event.target.closest("[data-share-url]");
      if (urlButton) {
        var sharePath = urlButton.getAttribute("data-share-url") || window.location.pathname + window.location.search;
        var shareUrl = new URL(sharePath, window.location.href).toString();
        var shareTitle = urlButton.getAttribute("data-share-label") || document.title || "FutbolRadar";

        if (navigator.share) {
          navigator.share({ title: shareTitle, url: shareUrl }).catch(function (error) {
            if (error.name !== "AbortError") showShareFallback(urlButton, shareUrl);
          });
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(function () {
            var previous = urlButton.textContent;
            urlButton.textContent = "Link kopyalandi";
            window.setTimeout(function () {
              urlButton.textContent = previous;
            }, 1600);
          }).catch(function () { showShareFallback(urlButton, shareUrl); });
        } else showShareFallback(urlButton, shareUrl);
        return;
      }

      var button = event.target.closest("[data-share-player]");
      if (!button) {
        return;
      }

      var playerId = button.getAttribute("data-share-player");
      // PAYLAŞILAN ADRES KANONİK ADRESTİR.
      //
      // Paylaşım bağlantısı başkalarına gidiyor ve kalıcı oluyor; bir
      // yönlendirmeye ya da uzantılı ikinci bir biçime işaret etmesi, o
      // bağlantıyı taşıyan herkesi fazladan bir atlamadan geçirir.
      var playerSlug = PLAYER_SLUGS[playerId];
      var url = document.documentElement.lang.indexOf("en") === 0
        ? new URL("/en/player/" + encodeURIComponent(playerSlug || playerId) + ".html", window.location.href).toString()
        : playerCanonicalUrl(playerId);
      var title = "FutbolRadar oyuncu radar kartı";

      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function (error) {
          if (error.name !== "AbortError") showShareFallback(button, url);
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          button.textContent = "Link kopyalandı";
          window.setTimeout(function () {
            button.textContent = "Radar kartını paylaş";
          }, 1600);
        }).catch(function () { showShareFallback(button, url); });
      } else showShareFallback(button, url);
    });
  }

  function showShareFallback(button, text) {
    var previous = document.querySelector("[data-share-fallback]");
    if (previous) previous.remove();
    var en = document.documentElement.lang.indexOf("en") === 0;
    var dialog = document.createElement("dialog");
    dialog.setAttribute("data-share-fallback", "");
    dialog.setAttribute("aria-label", en ? "Copy link or text" : "Bağlantıyı veya metni kopyala");
    dialog.innerHTML = '<p>' + (en ? "Select and copy the text below." : "Aşağıdaki metni seçip kopyalayabilirsiniz.") + '</p><textarea readonly aria-label="' + (en ? "Share text" : "Paylaşım metni") + '"></textarea><form method="dialog"><button type="submit">' + (en ? "Close" : "Kapat") + '</button></form>';
    dialog.querySelector("textarea").value = text;
    document.body.appendChild(dialog);
    dialog.addEventListener("close", function () { dialog.remove(); button.focus(); });
    dialog.showModal();
    dialog.querySelector("textarea").select();
  }

  var THEME_KEY = "futbolradar-theme";

  function systemPrefersDark() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function activeTheme() {
    var explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "dark" || explicit === "light") {
      return explicit;
    }
    return systemPrefersDark() ? "dark" : "light";
  }

  function syncThemeToggles() {
    var dark = activeTheme() === "dark";
    var en = document.documentElement.lang.indexOf("en") === 0;
    var buttons = document.querySelectorAll("[data-theme-toggle]");

    for (var i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      button.setAttribute("aria-pressed", dark ? "true" : "false");
      button.setAttribute("aria-label", en ? (dark ? "Switch to light theme" : "Switch to dark theme") : (dark ? "Açık temaya geç" : "Koyu temaya geç"));
      var label = button.querySelector(".theme-toggle-label");
      if (label) {
        label.textContent = en ? (dark ? "Light Theme" : "Dark Theme") : (dark ? "Açık Tema" : "Koyu Tema");
      }
    }

    // Tarayıcı arayüzü (adres çubuğu) da temayla uyumlu kalmalı.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", dark ? "#0a1512" : "#0b8f5a");
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* Depolama kapalıysa seçim yalnızca bu sayfa için geçerli olur. */
    }
    syncThemeToggles();
  }

  function initThemeToggle() {
    syncThemeToggles();

    document.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("[data-theme-toggle]") : null;
      if (!button) {
        return;
      }
      event.preventDefault();
      applyTheme(activeTheme() === "dark" ? "light" : "dark");
    });

    // Kullanıcı henüz seçim yapmadıysa sistem temasını canlı izle.
    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        if (!document.documentElement.hasAttribute("data-theme")) {
          syncThemeToggles();
        }
      };
      if (query.addEventListener) {
        query.addEventListener("change", onChange);
      } else if (query.addListener) {
        query.addListener(onChange);
      }
    }
  }


  function bootstrap() {
    initThemeToggle();
    initPlayerSharing();
    initShareBlocks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
