# Narvis (0.1)

Sıfırdan yazılmış küçük bir HTML/CSS/JS motoru. Sayfayı gerçek bir DOM'a ayrıştırır,
CSS kaskadını kendi seçici motoruyla hesaplar, kutuları yerleştirir ve her şeyi tek bir
**Canvas 2D** yüzeyine çizer. Hazır bir tarayıcı çekirdeği, layout kütüphanesi veya CSS
çözümleyicisi kullanılmaz; motor tamamen bu depodaki JavaScript modüllerinden oluşur.

**Sürüm 0.1.** Çekirdek boru hattı tam: HTML ayrıştırma → kaskad/stiller →
blok/inline/float/flex/grid/tablo yerleşimi → Canvas boyama, pseudo-element
(`::before`/`::after` `content`) desteğiyle. Formlar gerçek klavye girdisi,
kısıt doğrulaması, Canvas üzerinde açılan `select` listesi ve `fetch` ile ağ
gönderimini destekler. Bilinçli sınırlar aşağıda dürüstçe listelenir; üretim
tarayıcısı değil, motorun omurgasını gösteren bir çalışmadır.

```
HTML metni
   ↓  tokenizer + ağaç kurucu       src/html/
DOM
   ↓  seçici eşleme + kaskad        src/css/, src/style.js
hesaplanmış stiller
   ↓  blok / inline / float / flex / grid / tablo   src/layout.js
kutu ağacı
   ↓  Canvas 2D                      src/paint.js
pikseller
```

## Çalıştırma

ES modülleri ve `fetch` kullanıldığı için sayfa `file://` üzerinden açılamaz.
Küçük bir Node sunucusu depoda hazır:

```bash
cd Narvis
npm start
```

Ardından <http://localhost:4777/> adresini açın. Farklı bir port için:

```bash
PORT=8080 npm start        # macOS / Linux
$env:PORT=8080; npm start  # PowerShell
```

Node 18+ yeterlidir; hiçbir npm paketi kurulmaz.

## Ne yapabilir?

**HTML**
- Tokenizer, ağaç kurucu, öznitelikler, yorumlar, ham metin (`script`, `style`, `pre`).
- Boş elemanlar (`br`, `img`, `hr`, `meta`…), örtük kapanışlar, HTML varlıkları.
- `querySelector`, `querySelectorAll`, `getElementById`, `classList`, `innerHTML`,
  `textContent`, `createElement`, `appendChild` ve temel olay API'si.

**CSS**
- Tür, sınıf, kimlik, öznitelik ve birleştirici seçiciler; `:hover`, `:not()`, `:is()`,
  `:nth-child()`, `:first-child`, `:last-child`.
- Kaskad: `!important`, satır içi stil, özgüllük ve kaynak sırası.
- Miras (`inherit`, `initial`, `unset` dahil), kısa yazımlar, `em`/`rem`/`%`/`vw`/`vh`, renkler, gradyanlar ve gölgeler.
- Medya sorguları (`min-width`, `max-width`).
- Pseudo-elementler: `::before` / `::after` (ve `:before`/`:after` takma adları)
  yalnızca `content` bildirimiyle metin üretir; tırnaklı değerler, `var()` ikamesi
  ve kaskad/özgüllük uygulanır; `content: none` kutu üretmez.
- Kutu modeli, `border-radius`, `white-space` (`pre`, `pre-line`, `nowrap` dahil), arka planlar, metin süslemeleri, listeler.

**Yerleşim**
- Blok akışı, satır içi kutular, satır kırma, `inline-block`.
- Flexbox: `row`/`column`, `justify-content`, `align-items`, `align-self`, `gap`,
  `flex-grow`, `flex-shrink`, `flex-basis`, `margin: auto`.
- CSS değişkenleri: `--ad` tanımları, `var(--ad, yedek)` ikamesi, devralma,
  `initial`/`inherit`/`unset` ve döndü koruması. JS yolu: `el.style.setProperty('--ad', ...)`.
- Grid: `grid-template-columns/rows` (`repeat`, px, %, `fr`, `auto`), `grid-column` /
  `grid-row` (`span N`, `N / M`), `column-gap`/`row-gap`, `justify-items`,
  `justify-content`, `align-content`, `align-items`/`align-self`, `inline-grid`.
- Tablolar: `table`/`inline-table`/`table-row`/`table-row-group`/`table-cell`/
  `table-caption`; eksik `tbody`/`tr` imalinde üretilir, tablo dışına sızan
  içerik foster parenting ile tablo önüne taşınır; `colspan`/`rowspan` matrisi,
  min/max içerik alanındaki kolon paylaşımı, `border-spacing`, dikey hizalama
  (`vertical-align: middle/bottom`) ve `caption`. Faz 2: `col`/`colgroup`
  genişlikleri (`span`, `px`, `%`) ve `border-collapse: collapse` kenar
  çakışması çözümü (kalin kenar + rengi kazanır).
- Float: `float: left/right` (blok ve satır içi öğeler), `clear: left/right/both`,
  shrink-to-fit genişlik, yüzen bölge (BFC) kuralı. Flex/grid öğelerinde float yok sayılır.
- `position: relative`, `absolute`, `fixed`; `z-index` sıralaması.
- List-item işaretleri (`disc`, `decimal`, …) basit konumla çizilir.
- Form kontrolleri: `input` (text/search/email/url/tel/password/number,
  checkbox/radio/submit/reset/button, file, hidden), `textarea`, `select` ve
  `button` tarayıcı benzeri doğal görünümle çizilir; `value`, `checked`,
  `disabled`, `readOnly` ve `required` API'si, tıklamayla işaretleme, radyo
  grubunda tek seçim, `label` tıklaması ve `form` sıfırlama vardır.
- `select`: seçili etiket ve ok Canvas üzerinde çizilir; tekli seçimde liste
  motorun kendi katmanı olarak açılır. Fareyle vurgu/seçim, ok tuşları,
  `Home`/`End`, `PageUp`/`PageDown`, harf ile typeahead, kaydırma çubuğu ve
  pasif `option` atlama desteklenir. `select[multiple]` açılır katman yerine
  yerinde liste olarak çizilir: görünen satır sayısı `size` niteliğinden gelir,
  satır yüksekliği `lineHeight`/`1.4em`; tık tek satırı seçer, `Ctrl+tık`
  işareti değiştirir, `Shift+tık` aralık seçer. Klavyede oklar/`Home`/`End`/
  `PageUp`/`PageDown` odağı taşır (`Ctrl` ile yalnız odak), `Space`/`Enter`
  işareti değiştirir ve typeahead eşleşen satıra gider; liste odakla birlikte
  kaydırılır.
- `input[type=file]`: "Dosya Seç" düğmesi ve seçilen dosya adları Canvas
  üzerinde çizilir. Tıklama kabuğun gizli yerel dosya seçicisini açar;
  `multiple` ve `accept` nitelikleri ona aktarılır. Seçilen gerçek `File`
  nesneleri `input.files` (FileList benzeri) üzerinden okunur, `value` sahte
  yol döndürür ve `setFiles` API'si `input`/`change` olaylarını yayar. Form
  `multipart/form-data` ile gönderildiğinde dosya adı, türü ve baytları
  korunur; sunucu 12 MB'a kadar gövde kabul eder ve yanıtta dosya boyutunu
  gösterir.
- Klavye: metin kutusu ve `textarea` içine yazma/silme, imleç gezinmesi,
  `Shift` ile seçim, `Ctrl+A`, `Ctrl+C/X/V`, `Tab`/`Shift+Tab` odak sırası,
  `Enter` ile gönderme ve `Escape` ile odaktan çıkma. Tek satırlı kontroller
  yatay kaydırılır, `textarea` satır sonlarını korur.
- Fare: metin kontrolünde imleç şekli; tıklayarak imleç konumu, sürükleyerek
  seçim, çift tıkla kelime seçimi (`textarea`'da satır sınırlı). Sürükleme
  seçimi her fare hareketinde anında uygulanır; sürüklemenin sonundaki
  tıklama seçimi ezmez.
- Geri al/yinele: metin düzenlemelerinde `Ctrl+Z`, `Ctrl+Y` ve
  `Ctrl+Shift+Z`; her kontrol kendi anlık görüntü zincirini tutar
  (en fazla 100 adım), `historyUndo`/`historyRedo` `input` olayları
  sayfaya bildirilir.
- Doğrulama: `required`, `email`/`url`/`number` tip denetimi, `pattern`,
  `minlength`/`maxlength`, sayılarda `min`/`max`/`step` ve
  `setCustomValidity`. Geçersiz form gönderilmez; ilk geçersiz kontrol odaklanır
  ve Canvas üzerinde Türkçe doğrulama balonu çizilir.
- Gönderim: `action`, `method`, `enctype` ve submitter üzerindeki
  `formaction`/`formmethod`/`formenctype`. GET ile sorgu dizesi; POST ile
  `application/x-www-form-urlencoded`, `multipart/form-data` veya
  `text/plain`. İstek `fetch` ile gerçek sunucuya gider, dönen HTML motor
  tarafından yeni belge olarak yüklenir.

**Çalışma zamanı**
- Sayfa içi `<script>` blokları izole bir `window`/`document` ortamında çalışır.
- DOM değişiklikleri bir sonraki `requestAnimationFrame` karesinde yeniden yerleşim tetikler.
- `console`, `setTimeout`, `requestAnimationFrame`, `matchMedia`, `scrollTo`, `getComputedStyle`.
- Canvas üzerindeki fare ve klavye olayları DOM'a iletilir; `:hover` yeniden çizilir.
- Form varsayılanları: checkbox/radio işaretleme, radyo grubunda tek seçim,
  `label` tıklaması, metin odağı/imleci/seçimi, `value`/`checked`/`disabled`
  API'si, dosya seçimi (`files`, `setFiles`), `submit`/`reset`/`input`/`change`
  olayları, `form` sıfırlama, kısıt doğrulaması ve `fetch` tabanlı gönderim.
- `NarvisShell` kabuğu form yanıtını adres çubuğuna ve gezinme geçmişine yazar;
  geri tuşuyla forma dönülebilir.

## Kabuk arayüzü

`index.html` bir tarayıcı kabuğu sunar:

- **Adres çubuğu** — `pages/demo.html`, `about.html` veya `demo` yazıp Enter'a basın.
- **Geri / ileri / yenile** — sayfa geçmişi motorun kendi gezinme kancasıyla yönetilir.
- **Masaüstü / tablet / mobil** — canvas viewport'u yeniden boyutlandırır; medya sorguları canlı çalışır.
- **Kaynak (`Ctrl+E`)** — sayfanın HTML'ini düzenleyip `Ctrl+Enter` ile yeniden çalıştırın.
  Değişiklikler yalnızca bellekte kalır; sayfa yenilendiğinde özgün kaynak gelir.
- **İncele** — canvas üzerinde bir öğeye tıklayın; DOM ağacı, hesaplanmış stiller ve
  vurgu kutusu güncellenir.
- **Geliştirici araçları (`Ctrl+Shift+I` / `F12`)** — DOM, Stil, Konsol ve Bilgi sekmeleri.
- **Konsol** — motorun `window` bağlamında JavaScript çalıştırır; sonucu ve hataları gösterir.

Kısayollar: `Ctrl+E` kaynak, `Ctrl+Shift+I` geliştirici araçları, `Ctrl+R` sayfayı yenile,
`Alt+Sol` / `Alt+Sağ` gezinme, `Esc` açık paneli veya inceleme modunu kapat.

## Proje yapısı

```
index.html            tarayıcı kabuğu
styles/shell.css      yalnızca kabuğun CSS'i (motor bunu çizmez)
src/
  ui.js               kabuk: gezinme, denetçi, konsol, düzenleyici
  engine.js           yükleme, reflow, boyama, olay yönlendirme, window ortamı
  dom.js              DOM düğümleri, olaylar, stil bildirimi proxy'si
  style.js            kaskad ve hesaplanmış stiller
  layout.js           blok / inline / float / flex / grid / tablo yerleşimi ve hit-test
  paint.js            Canvas 2D boyama
  form.js             form verisi, option yardımcıları, GET/POST istek kurucu
  validation.js       kısıt doğrulaması ve Türkçe mesajlar
  font.js             font kısa yazımı ve font string'i
  util.js             küçük yardımcılar
  html/               tokenizer, ağaç kurucu, varlıklar
  css/                seçiciler, değerler, kural ayrıştırıcı, UA stilleri
pages/
  demo.html           etkileşimli tanıtım sayfası
  about.html          mimari notları
tests/
  run.mjs             tüm testler
  smoke.mjs           HTML/CSS duman testi
  layout-smoke.mjs    yerleşim regresyon testi
serve.mjs             bağımlılıksız statik sunucu
```

## Testler

```bash
npm test
```

Testler Node içinde çalışır; Canvas `measureText` yerine deterministik bir ölçüm
fonksiyonu enjekte edilir. Demo ve hakkında sayfaları da ayrıştırılıp yerleştirilir;
sonlu olmayan veya negatif kutu boyutu aranır. `textContent` yazma, CSS geniş
anahtar sözcükleri, `<br>`, birimsiz `line-height`, `white-space`, CSS değişkenleri
(`var()` çözümü, devralma, döngü koruması), grid yerleşimi (`fr`, gap, span,
`inline-grid`) ve float akışı (sarma, yığılma, `clear`, BFC) için regresyon
kontrolleri de vardır; ayrıca tablolar (tbody imali, colspan/rowspan,
border-spacing, inline-table, collapse kenar çakışması, col genişlikleri),
form kontrolleri (girdi ölçüleri, checkbox/radio 13×13, textarea satırları,
hidden gizleme, value/checked/disabled API, label/radyo/odak/reset
etkileşimi), klavye girdisi (yazma, silme, seçim, `Tab`, `Enter`), `select`
listesi (açma, ok/Enter, fareyle seçim, pasif option, çizim), kısıt doğrulaması
(Türkçe mesajlar, özel geçerlilik), ağ üzerinden form gönderimi (POST/GET
gövdesi, yanıt geri çağrısı), dosya girdisi (`FileList`, `setFiles`, sahte
`value`, `change` olayı, form verisi), ikili-güvenli multipart ayrıştırma ve
pseudo-element içerikleri
(::before/::after sıralaması, `content: none`, spesifite, `var()`,
`counter()` yokluğu) için regresyon kontrolleri bulunur.

## Bilinçli sınırlar

Narvis üretim için bir tarayıcı değil, motorun omurgasını gösteren bir çalışma:

- `float` içinde `float: inline` başlangıcı, `sticky` ve çok sütun desteklenmez;
  grid'de `grid-area`, `minmax()`, adlandırılmış izler ve `place-*` yok;
  satır-temelli sparse otomatik yerleşim uygulanır.
- `col`/`colgroup` genişlikleri ve `border-collapse: collapse` desteklenir:
  bitişik kenarlarda kalin kenar (ve rengi) kazanır; sabit `px`/`%` kolon
  genişlikleri paylaşımda baz alınır. Ancak `table-layout: fixed` yok (her
  zaman otomatik algoritma), çakışan kenar çizimi ekranın tam ortasına
  değil sahibi hücreye çizilir ve `<thead>`/`<tfoot>` sıralaması korunmaz
  (sıradan satır grubu gibi dizilir).
- `::before` / `::after` yalnızca `content` metnini destekler; `counter()`,
  `attr()`, `open-quote`/`close-quote` ve `url()` içerikleri üretilmez.
- Harici CSS ve script dosyaları yüklenmez; yalnızca sayfa içi `<style>` / `<script>`.
- Formlarda IME kompozisyonu yok. Çoklu seçim `select[multiple]` ile yerinde
  liste olarak çalışır; açılır katmanda çoklu işaret kutusu yoktur. Dosya
  girdisi işletim sisteminin yerel seçicisini kullanır; sayfa kodu dosya
  seçimini yalnızca `setFiles` ile besleyebilir, sürükle-bırak yükleme yoktur.
  `number` dışındaki tarih/sayı biçimleri native denetimlerle sınırlı değildir.
- Doğrulama; `willValidate` ayrıntıları, `setCustomValidity` dışındaki özel
  doğrulama kancaları ve `novalidate` dışındaki form düzeyi seçenekleri
  kapsamaz. Ağ gönderiminde çerez/redirect davranışı `fetch` varsayılanlarına
  bırakılır; istek iptali veya yükleme göstergesi yoktur.
- Eleman bazlı kaydırma, `overflow` kırpma ve animasyonlar yok.
- Sayfa başına tek Canvas; alt bileşenler ayrı katman değildir.

Bu sınırlara rağmen boru hattı gerçektir: ayrıştırma, kaskad, değişkenler, kutu
modeli, flex, grid, tablolar, hit-test ve piksel üretimi baştan sona bu depodaki
kodla yapılır.
