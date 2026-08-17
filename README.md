# creative-pipeline

Kısa-form sosyal içerik üretimini **aşamalı bir üretim hattına** çeviren Next.js uygulaması.
Her "run" bir içerik; her aşamada bir ajan çalışır, sonra ya otomatik ilerler ya insan onayı bekler.

Hat **moda göre şekil değiştirir**: carousel'in ses aşaması yoktur, video modunun dizgi
aşaması yoktur. Çekirdek durum makinesi modlardan habersizdir.

## Mimari

```
┌──────────────────────────────────────────────────────────────┐
│  TARAYICI                                                    │
│  /                          proje listesi                    │
│  /projects/[slug]           run listesi                      │
│  /projects/[slug]/runs/[id] RunView (2sn polling)            │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  ÇEKİRDEK — mod'dan habersiz                                 │
│  stateMachine · runStore · brand-memory · cost çerçevesi     │
└───────────────────────────┬──────────────────────────────────┘
                            │ getMode(run.mode)
          ┌─────────────────┼─────────────────────┐
          ▼                 ▼                     ▼
┌──────────────────┐ ┌──────────────────┐ ┌────────────────────┐
│  full-ai-video   │ │    carousel      │ │    real-video      │
│   ❄ DONDURULDU   │ │      aktif       │ │       aktif        │
├──────────────────┤ ├──────────────────┤ ├────────────────────┤
│ brief            │ │ konsept(claude)  │ │ konsept (claude)   │
│ voice            │ │ plan   (claude)  │ │ plan    (claude)   │
│ visual           │ │ copy   (claude)  │ │ copy    (claude)   │
│ montage          │ │ visual (fal)     │ │ footage (OPERATÖR) │
│ qc               │ │ compose(remotion)│ │ voice   (11labs)   │
│                  │ │ qc     (claude)  │ │ kurgu   (determ.)  │
│                  │ │                  │ │ compose (remotion) │
│                  │ │                  │ │ finish  (ffmpeg)   │
│                  │ │                  │ │ qc      (gemini+   │
│                  │ │                  │ │          claude)   │
├──────────────────┤ ├──────────────────┤ ├────────────────────┤
│ çıktı: dikey mp4 │ │ çıktı: PNG seti  │ │ çıktı: 9:16 mp4    │
│ payload: scenes  │ │        + caption │ │ GERÇEK materyalden │
└──────────────────┘ └──────────────────┘ └────────────────────┘
```

Depo düz dosya sistemidir, veritabanı yoktur:

```
projects/<slug>/
  config.json                 marka, platform, varsayılan mod
  brand-memory/memory.json    ton, geçmiş, rezerv varyantlar, performans
  runs/<runId>/
    state.json                run'ın TÜM durumu
    assets/                   çıktılar (şekli moda göre değişir)
```

## Kurulum

```bash
npm install
```

`.env.local.example` dosyasını `.env.local` olarak kopyalayıp doldur. Her şey mock'ken
hiçbir API çağrısı yapılmaz:

```bash
npm run dev
```

### LLM ajanları API key istemez

Sanat yönetmeni, copywriter ve carousel QC ajanları `claude` CLI'sını spawn eder ve
**senin kendi oturumunu** kullanır. Gereken tek şey `claude --version`'ın çalışması ve
oturumun açık olması. CLI bulunamaz veya oturum düşerse aşama `awaiting_operator`
durumuna düşer — hat kırılmaz.

## Durum makinesi

```
   advanceRun(state)
         │
         ├── ajan başarılı ────────▶ completeStage → sonraki aşama
         │                            │
         │                            ├─ auto=true  → zincirleme devam
         │                            └─ auto=false → "Onayla" bekler
         │
         ├── OperatorRequiredError ─▶ awaiting_operator
         │      MCP-only araç, ya da CLI yok/oturum kapalı.
         │      Talimat dashboard'da görünür; operatör işi yapıp
         │      submit-visual / submit-qc'ye POST'lar, hat devam eder.
         │
         └── başka hata ───────────▶ error ("Yeniden dene")
```

Bu üç yollu ayrım hattın en önemli özelliğidir: sunucunun yapamadığı işi insana
devreder ve orada **donar, kırılmaz**.

## Mock stratejisi

`MOCK_MODE` global varsayılan; her aşama `MOCK_<STAGE>` ile bağımsız override edilir
(`MOCK_SCRIPT`, `MOCK_VOICE`, `MOCK_VISUAL`, `MOCK_MONTAGE`, `MOCK_QC`, `MOCK_MUSIC`).
Anahtarlar tek tek geldikçe aşamalar tek tek gerçeğe alınabilir.

`MOCK_MODE=true` ile carousel uçtan uca **sıfır maliyetle** koşar ve gerçek PNG üretir —
hat değişikliklerini doğrulamanın en ucuz yolu budur.

## Kanal farkı

Proje oluşturulurken seçilen kanal run'a **sabitlenir** (`RunState.platform`) ve
üretimi gerçekten değiştirir — bkz. [lib/modes/carousel/channels.ts](lib/modes/carousel/channels.ts):

| | Instagram | TikTok | YouTube Shorts |
|---|---|---|---|
| Boyut | 1088×1360 (4:5) | 1152×2048 (9:16) | 1152×2048 (9:16) |
| Slide | 3–10 | 3–8 | 3–6 |
| Hashtag | 5–15 | 3–6 | 3–6 |
| Ton | derin kaydırma, kaydetmeye davet | ilk kare 1 saniyede kavramalı | arama odaklı, açıklayıcı |

Kanal planner ve copywriter promptlarına giriyor, görsel üretiminin boyut/oranını
belirliyor ve Remotion dizgisini ölçekliyor (tipografi yüksekliğe oranlanır, aksi
halde 9:16 karede 4:5 için ayarlanmış punto boğuk kalır).

Kanal run oluşturulurken kopyalanıyor çünkü (1) ajanların proje config'ini okuması
`runStore → cost → modes → ajanlar → runStore` döngüsünü geri getirir, (2) projenin
kanalı sonradan değişse bile eski run kendi kanalıyla kalmalı.

## Carousel: görsel üretim mantığı

Slide'lar arası stil tutarlılığı ve maliyet, iki geçişle çözülür:

```
GEÇİŞ 1 — İMGE (ucuz, tek model ailesi → tutarlı)
  slide-1     flux t2i                      = STİL ÇAPASI
  slide-2..N  flux-pro/kontext, ref: çapa

GEÇİŞ 2 — TİPOGRAFİ (yalnızca textMode="baked")
  üretilen görsel → gpt-image-2/edit ile ÜSTÜNE yazı yazılır

GEÇİŞ 3 — OVERLAY (yalnızca textMode="overlay")
  Remotion renderStill ile metin bindirilir
```

Pahalı model (gpt-image-2) **yalnızca yazı yazdığı yerde** devrededir; yeni görsel
üretmediği için slide'lar arasında stil sıçraması olmaz.

Slide boyutu kanala göre değişir (yukarıdaki tabloya bak) ama hepsi **16'nın katı**
olmak zorunda — fal `image_size` bunu şart koşuyor. Bu yüzden klasik 1080'li ölçüler
kullanılamıyor (1080 ÷ 16 = 67.5, geçersiz). Seçilen değerler oranı tam tutturuyor
(1088×1360 = tam 4:5, 1152×2048 = tam 9:16), böylece kırpma adımına hiç gerek kalmıyor.

## Maliyet

Her aşamanın tahmini ve gerçek maliyeti `state.json`'da tutulur, dashboard'da gösterilir.
LLM aşamalarının **gerçek** değeri `claude` CLI'nin JSON zarfındaki `total_cost_usd`'den
okunur — tahmin değildir.

Ölçülmüş carousel run maliyetleri:

```
sıcak cache : plan $0.06   copy $0.04   qc $0.13   →  ~$0.24 / run
soğuk cache : plan $0.22   copy $0.28   qc $0.33   →  ~$0.83 / run
tam mock    : $0.00
```

Soğuk/sıcak farkı prompt cache'ten geliyor. CLI her **güncellendiğinde** sistem
promptu değişip cache soyu sıfırlanıyor, yani soğuk fiyat düzenli olarak geri
geliyor — sürekli sıcak kalacağını varsayma.

Cache çağrılar arasında yaşadığı için **tüm ajanlar aynı sistem promptunu paylaşır** ve
rol kullanıcı promptuna yazılır — bkz. [lib/agents/claude-cli.ts](lib/agents/claude-cli.ts).
Bu sabiti ajana özel hale getirmek her ajanı ayrı cache soyuna sokar ve maliyeti
katlar.

## QC kapısı

QC `rejected` verdiğinde yayın **engellenir** — reddedilmiş bir işin "yayına hazır"
görünmesi yanlış. Ama kalıcı çıkmaz da değil: dashboard'daki buton iki aşamalı onaya
dönüşür ve insan bilinçli olarak üzerine geçebilir. Bu karar geçmişe
`published_over_qc_rejection` olarak yazılır.

## Modu dondurmak

Bir mod silinmeden devre dışı bırakılabilir: `descriptors.ts`'te `frozen: true`.
Dondurulmuş modda yeni run başlatılamaz ve mod seçim listesinde görünmez, ama
descriptor ve ajan kodu yerinde kalır — mevcut run'lar açılmaya, ilerlemeye ve doğru
etiketlerle görünmeye devam eder. `full-ai-video` şu an dondurulmuş durumda.

## Yeni mod eklemek

Çekirdeğe dokunmadan iki dosya:

1. `lib/modes/descriptors.ts` — aşama listesi, etiketler, çıktı tipi (saf veri, istemci de okur)
2. `lib/modes/<mod>/index.ts` — aşama→ajan eşlemesi + maliyet fonksiyonu

`assertModeConsistent` modül yüklenirken descriptor ile ajan anahtarlarını karşılaştırır;
uyuşmazlık sessiz "ajan yok" hatasına dönüşmez, hemen patlar.

## real-video modu (CapCut tarzı gerçek kurgu)

Gerçek çekim/foto materyalden dikey 9:16 video. Görsel ÜRETİLMİYOR, SEÇİLİYOR.

```
konsept → plan → copy → footage → voice → kurgu → compose → finish → qc
  ↑         ↑      ↑       ↑         ↑       ↑        ↑         ↑      ↑
claude   claude  claude  OPERATÖR  11labs  determ.  Remotion  ffmpeg  gemini
                                                                      +claude
```

Çizelge ÇOK KANALLI ve mutlak zamanlı — carousel'in tek kanallı `Timeline`'ından
ayrı bir tip (`remotion/real-video/timeline.ts`, `version: 2`):

```
[yazı]      ────▓▓▓▓▓▓▓───▓▓▓▓▓▓───────
[b-roll]    ──────▓▓▓▓▓───────────────
[ana kurgu] ▓▓▓▓▓▓▓╳▓▓▓▓▓▓▓╳▓▓▓▓▓▓▓▓▓▓     ╳ = geçiş bindirmesi
[ses efekt] ──▓─────────▓─────────────
[müzik]     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
[voice]     ──▓▓▓▓▓▓──▓▓▓▓▓▓──▓▓▓▓▓───
```

Üç karar bu tasarımı belirledi:

**Geçişler `TransitionSeries` ile YAPILMIYOR.** O bileşen geçiş karelerini
tüketiyor (bu yüzden `CreativeRunComposition`'ın süre matematiği bindirmeyi
çıkarmak zorunda). Çok kanallı modelde bu, overlay'in zamanını video kanalından
kaydırırdı. Bunun yerine her klip düz bir `<Sequence from>` içinde ve geçişi
kendi giriş animasyonu olarak yapıyor; bindirme klip aralıklarının çakışmasıyla
ifade ediliyor. **Kazanç: bir altyazı bir geçişin üzerinden geçebiliyor** —
CapCut'ta sürekli yapılan şey.

**ffmpeg uçlarda, Remotion ortada.** Kesme/geçiş/tipografi Remotion'da (tek
compose geçişi, yazı geçişi aşabilsin diye); probe/proxy/ölçüm ve ses karışımı +
loudness ffmpeg'de. Ducking `sidechaincompress` ile — gerçek bir yan zincir
kompresörü; Remotion'ın kare bazlı volume'ü sert ve nefessiz olurdu. Video
finisajda YENİDEN KODLANMIYOR (`-c:v copy`).

**Zamanlar sembolik çapadan çözülüyor, LLM'den gelmiyor.** Direktör
`{tip:"zoom-punch", capa:{kelime:"üç ayda"}}` üretiyor; `lib/timeline/anchors.ts`
bunu ElevenLabs'in kelime damgalarını kullanarak saniyeye çeviriyor. Sebep: LLM
zaman aritmetiğinde güvenilmez ve sabit sayı her copy düzeltmesinde kırılır.
Çözümleme ASLA throw etmez — bulunamayan çapa en yakın makul zamana düşer ve
uyarı üretir.

Kanal formatı carousel'den ayrı (`lib/modes/real-video/format.ts`): orada
Instagram 4:5, burada Reels yani 9:16.

## Bilinen açık maddeler

- **`script.ts` gerçek LLM'e bağlı değil** — bu yüzden `full-ai-video` dondurulmuş
  durumda. Carousel'in planner/copywriter'ı bu boşluğu `claude` CLI ile dolduruyor;
  aynı yaklaşım video moduna taşınırsa mod çözülebilir.
- **Gerçek görsel zinciri hiç koşmadı** — `FAL_KEY` olmadığı için çapa → kontext
  referans → gpt-image-2/edit zinciri bugüne kadar bir kez bile çalıştırılmadı.
  Tutarlılık iddiası (slide'lar tek seri gibi durur) henüz doğrulanmış değil.
  Operatör yolu (`submit-visual`) ise uçtan uca test edildi ve çalışıyor.
- **`PRICES.gptImageEditEach` bir TAHMİN** — fal fiyatı opak ("1 unit") döndürüyor ve
  çağrı başına maliyet bildirmiyor. Görsel aşamasının "gerçek" maliyeti bu yüzden
  aslında hesaplanmış bir tahmin; satır açıklamasında `TAHMİNİ` olarak işaretli ve
  çağrı sayıları yazılı. İlk gerçek run'dan sonra fal faturasını bu sayılara bölüp
  `prices.ts` güncellenmeli.
- **`remotion/Scene.tsx` gerçek görseli çizmiyor** — id'den türetilmiş renkli arka plan
  gösteriyor. Yalnızca DONMUŞ `full-ai-video` modunu ilgilendiriyor; `real-video`
  kendi `remotion/real-video/Clip.tsx`'ini kullanıyor ve orada `<OffthreadVideo>` +
  `<Img>` doğru kurulu.
- **`lib/providers/music.ts` bağlı değil** — hiçbir moddan çağrılmıyor. `real-video`'nun
  kurgu ajanı `assets.musicTrack` doluysa müzik izini çizelgeye ekliyor, ama o alanı
  dolduran bir aşama henüz yok.
- **Kuyruk yok** — `auto` modda tüm hat tek HTTP isteğinde koşar. `real-video` modunda
  bu kabul edilemez (render dakikalar sürüyor), o yüzden o modda `auto` AÇIKÇA
  reddediliyor (`POST /api/runs` 400 döner). Kuyruk gelene kadar aşamalar tek tek.
- **`real-video` kurgusu deterministik** — Aşama A'da LLM yok: sahneler seslendirme
  süresine göre uç uca diziliyor, sahne başına bir klip. Klip analizi + EDL direktörü
  (hangi klibin hangi 2 saniyesi) Aşama B'nin işi.
- **Gemini QC şu an operatör devrinde** — hesap `IneligibleTierError` veriyor
  (sürüm meselesi değil, 0.55.1 de aynı). Kod tarafı hazır; auth düzelince ek
  değişiklik gerekmiyor. Bkz. [GEMINI-NOTLARI.md](GEMINI-NOTLARI.md).
- **Auth ve eşzamanlılık kilidi yok** — `state.json`'a paralel yazma yarışı mümkün.
  Uzun süren `compose` aşaması bu pencereyi genişletiyor.
