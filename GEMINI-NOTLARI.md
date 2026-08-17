# Gemini bu hatta ne yapıyor

> **Bu dosyanın adı neden `GEMINI.md` değil:** `GEMINI.md`, gemini CLI'nin
> OTOMATİK keşfettiği bağlam dosyası. Kökte o adla bir dosya olsaydı, proje
> dizininden yapılan her CLI çağrısına sessizce enjekte olurdu — hem token
> yakardı hem ajanın kafasını karıştırırdı. Bu yüzden `-NOTLARI` eki var ve
> ajanlar zaten nötr bir çalışma dizininde spawn ediliyor
> ([lib/agents/gemini-cli.ts](lib/agents/gemini-cli.ts)).

## Üç katmanlı analiz — hangi soru kime gidiyor

Kural basit: **ölçülebilene model parası ödenmiyor.**

| Katman | Araç | Cevapladığı soru | Maliyet |
|---|---|---|---|
| 1 | **ffmpeg** | Sahne nerede kesiliyor? Kadraj odakta mı? Nerede sessizlik var? | Bedava, deterministik |
| 2 | **Gemini** | Bu videoda ne oluyor, ne zaman? | Abonelik (OAuth CLI) |
| 3 | **Claude** | Bu iyi mi? Markaya uygun mu? Yasaklara uyulmuş mu? | claude CLI |

Sıralamanın gerekçesi: "kadraj odakta mı" sorusunu bir vision modeline sormak
israf — `blurdetect` sayı veriyor. Gemini'ye *gördüğünü* soruyorsun, Claude'a
*yargısını*. Claude'a ham video verilmiyor; Gemini'nin ölçümü + ffmpeg'in sahne
sınırları veriliyor, çünkü marka bağlamı (`brief.yasaklar`, `styleContract`)
zaten Claude tarafında.

Uygulama: [lib/modes/real-video/qc.ts](lib/modes/real-video/qc.ts)

## Gemini'nin iki işi

### 1. Rakip / referans kreatif analizi

[analyze-refs.mts](analyze-refs.mts) — "referans video sökücü". Nişte işe yarayan
videoları Gemini'ye verip **ölçülebilir** veri çıkarıyor, sonra düz kodla
birleştirip `refs/GRAMMAR.md` üretiyor.

```bash
node analyze-refs.mts                       # refs.json'daki her şey
node analyze-refs.mts "https://youtu.be/X"  # tek video
node analyze-refs.mts ./ornek.mp4           # yerel dosya
node analyze-refs.mts --only-report         # API çağrısı yok, raporu yeniden yaz
```

Tasarım kuralı dosyanın kendi içinde yazılı: **"Sayılar birleşir, sıfatlar
birleşmez."** Prompt "ÖLÇ, YORUMLAMA" diyor ve birleştirme adımında ikinci bir
LLM çağrısı yok — model araya girerse öğrenilen şey modelin yorumu olur, veri
olmaz.

### 2. Üretilen videonun QC'si

`real-video` modunun `qc` aşaması. Ölçüm şeması ikisinde de ortak:
[lib/analysis/geminiVideo.ts](lib/analysis/geminiVideo.ts). Rakip analizi bunun
üstüne kendi alanlarını (`structure`, `ending`, `stratejiEtiketi`) ekliyor —
`runPlannerCore`'un eklenti dikişiyle aynı desen. Ölçümü tek yerde tutmanın
sebebi: iki taraf planları farklı sayarsa karşılaştırma anlamsızlaşır.

## Bilinmesi gereken üç tuzak

### 20 MB sert sınır

gemini-cli bundle'ında `MAX_FILE_SIZE_MB = 20` sabit. Kaynak klip neredeyse her
zaman bunun üstünde, o yüzden **analiz her zaman proxy üzerinden** yapılıyor:

```ts
await makeProxy(src, dest, { maxHeight: 720 });   // lib/media/ffmpeg.ts
```

`makeProxy` hedefin altına inmeyi GARANTİ ediyor — tek geçişte tutmazsa crf'i
kademeli artırıp yeniden deniyor. Boyutu çağırana kontrol ettirmek, sınırı aşan
bir dosyayı gönderip anlamsız bir API hatası almak demekti.

### API anahtarı env'de kalırsa abonelik devre dışı

**En sinsi hata bu.** `GEMINI_API_KEY` veya `GOOGLE_AI_API_KEY` child process'in
env'inde varsa, CLI auth'u `oauth-personal`dan koparıp **API'yi faturalandırıyor**
— ve bunu sessizce yapıyor. `runGemini` bu yüzden child env'den o değişkenleri
açıkça siliyor:

```ts
delete env.GEMINI_API_KEY;
delete env.GOOGLE_AI_API_KEY;
delete env.GOOGLE_API_KEY;
env.GEMINI_DEFAULT_AUTH_TYPE = "oauth-personal";
```

Bu yüzden `.env.local.example`'a `GEMINI_API_KEY` **bilinçli olarak
eklenmemiştir**.

### Windows'ta `gemini.exe` yok

Yalnızca `gemini`, `gemini.cmd`, `gemini.ps1` var. `claude-cli.ts`'deki
".exe'yi doğrudan hedefle" hilesi burada geçmiyor (Node `.cmd`'yi `shell:true`
olmadan spawn etmiyor, `shell:true` ise filter_complex benzeri argümanları
bozuyor). Çözüm: `process.execPath` (node) ile `bundle/gemini.js`'i doğrudan
çalıştırmak.

Ayrıca **`--json-schema` muadili yok** — `-o json` yalnızca zarfı JSON yapıyor,
`response` alanı düz metin. Bu yüzden şema prompt'a gömülüyor, çıktı kodda
doğrulanıyor ve bir kez onarma turu yapılıyor
([validateMeasurement](lib/analysis/geminiVideo.ts)).

## Durum — hesap uygunluğu (2026-08-15 itibarıyla düzeldi)

Daha önce kurulu CLI (0.52.0) ve 0.55.1 **ikisi de** şu hatayı veriyordu:

```
IneligibleTierError: This client is no longer supported for Gemini Code Assist
for individuals. Migrate to the Antigravity suite.
reasonCode: UNSUPPORTED_CLIENT   tierId: free-tier
```

**2026-08-15'te doğrulama testi (aşağıdaki "Doğrulama" #1) tekrar koşuldu ve
artık bu hata alınmıyor.** `runGemini`'nin kullandığı ortamla (API key'ler
child env'den silinmiş, `GEMINI_DEFAULT_AUTH_TYPE=oauth-personal`) çağrı temiz
`{"ok":true}` döndü, `error` alanı yok. Yanıtı veren model `gemini-3-flash-preview`
oldu (`gemini-3.1-pro-preview-customtools` bir kere hata verip fallback etti,
akışı bozmadı). `qc` aşaması artık operatöre düşmeden otomatik ilerleyebilir.

Not: `~/.gemini/google_accounts.json` içinde `active: null` görünüyor olsa da
çağrı başarıyla geçiyor — CLI'nin auth'u muhtemelen bu dosyanın dışında bir
mekanizmadan (ör. `GEMINI_DEFAULT_AUTH_TYPE` ile tetiklenen farklı bir kimlik
kaynağı) sağlıyor. Bu dosya tek başına güvenilir bir durum göstergesi değil —
gerçek durumu anlamak için "Doğrulama" #1'i koş.

**Hat zaten bundan etkilenmiyordu:** `runGemini`'nin her başarısızlık yolu
`OperatorRequiredError`'a yakınsıyor, yani auth bir daha bozulursa `qc` aşaması
operatör devrine düşer ve run `submit-qc`'ye POST ile devam eder. Kırılan bir
şey olmaz, yalnızca o adım otomatik olmaktan çıkar.

### Uçtan uca teyit (aysecrets, 2026-08-15)

Yukarıdaki #1 metin testinden ayrı olarak `qc` aşaması **gerçek bir run üzerinde
tam olarak koştu**: 21.4sn'lik `final.mp4`, proxy üzerinden, **~2dk50sn**. Bu süre
normaldir — aşama sessizce uzun sürüyor ve ilk karşılaşan "takıldı mı" diye
düşünüyor; düşünmesin.

Ölçüm çelişki yakaladı ve doğru davrandı: Gemini "5 plan, ilk kesme 2.75sn"
raporladı, ffmpeg `scdet` ise videoda **hiç iç kesme bulamadı**. Sebep test
materyalinin yapaylığıydı (5 sahne yalnızca 2 klipten üretilmişti, yani görüntüde
gerçekten kesme yoktu) — yani üçüncü katman uydurma DEĞİL, doğru bir gözlemdi.
Verdict `rejected` geldi ve insan kontrolü istendi.

Bu, dosyanın başındaki "sayılar birleşir, sıfatlar birleşmez" kuralının neden
böyle kurulduğunun canlı örneği: Gemini'nin anlatısı tek başına alınsaydı video
"5 planlı, ritmi doğru" diye onaylanırdı.

## Doğrulama

```bash
# 1. Headless çalışıyor mu, OAuth geçiyor mu
node "$APPDATA/npm/node_modules/@google/gemini-cli/bundle/gemini.js" \
  -o json --approval-mode plan --skip-trust \
  -p 'Return ONLY this JSON, no fences: {"ok":true}'

# 2. Video okuyabiliyor mu (20MB altı proxy ile)
ffmpeg -i klip.mp4 -vf scale=-2:720 -c:v libx264 -crf 30 -an /tmp/proxy.mp4
node .../gemini.js -o json --approval-mode plan --skip-trust \
  --include-directories /tmp \
  -p 'read_file ile /tmp/proxy.mp4 oku, SADECE: {"durationSec":<n>,"shotCount":<i>}'

# 3. Halüsinasyon kontrolü — Gemini'nin plan sınırlarını ffmpeg ile karşılaştır
ffmpeg -i klip.mp4 -vf "scdet=threshold=40" -f null -
```

3. adım önemli: Gemini'nin `shots[]` sınırları `scdet` çıktısıyla ±0.3sn içinde
uyuşmalı. Uyuşmuyorsa model zaman damgası **uyduruyor** demektir ve 2. katman
geçersizdir — o durumda QC operatör devrine geri itilmeli.
