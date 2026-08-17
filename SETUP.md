# Kurulum

Bu dosya, projeyi ilk kez klonlayan biri için adım adım kurulum anlatır. Mimari
ve tasarım kararları için [README.md](README.md)'ye bak.

## 1. Gereksinimler

| Araç | Zorunlu mu? | Not |
|---|---|---|
| Node.js 20+ | Evet | `next 16` gerektiriyor |
| `claude` CLI | Evet (mock dışı LLM aşamaları için) | `claude --version` çalışmalı, oturum açık olmalı — bkz. aşağıda |
| ffmpeg / ffprobe | Sadece `real-video` modu için | PATH'te olmalı |
| ElevenLabs hesabı | Sadece `real-video` sesi için | API key |
| fal.ai / Higgsfield hesabı | Sadece görsel/video üretimini gerçek çalıştırmak için | API key |

Hiçbiri yoksa da proje **MOCK_MODE=true** ile uçtan uca çalışır, sıfır maliyetle.

## 2. Kur

```bash
npm install
cp .env.local.example .env.local
```

`.env.local` içinde değiştirmen gereken tek şey (şimdilik) yok — varsayılan
`MOCK_MODE=true` ile hiçbir gerçek API çağrısı yapılmaz.

```bash
npm run dev
```

`http://localhost:3000` açılır. Proje listesi boş gelir çünkü `projects/`
klasörü sürüm kontrolüne dahil değil (bkz. `projects/_template/`).

## 3. İlk projeni ve run'ını oluştur

Proje klasörünü **elle kopyalama** — `projects/_template/` sadece şemanın
referansı, gerçek projeler dashboard'daki "Yeni Proje" formuyla (`POST
/api/projects`) oluşturulur; bu uç nokta `config.json` + `brand-memory/`'yi
programatik olarak kurar.

1. `http://localhost:3000`'da "Yeni Proje" formunu doldur (marka adı, platform,
   varsayılan mod → `carousel` en olgun mod, onunla başla).
2. Proje sayfasında "Yeni Run" ile bir konu (`topic`) gir, `auto`'yu aç.
3. `MOCK_MODE=true` iken run birkaç saniyede `awaiting_publish`'e düşer ve
   `projects/<slug>/runs/<runId>/assets/slides/` altında gerçek PNG'ler,
   `caption.txt` oluşur — hepsi `[MOCK]` etiketli içerik ama dosyalar gerçek.

Not: ilk run'da Remotion, dizgi/render için ~110 MB'lık bir Chrome Headless
Shell indirir (bir kerelik, otomatik). İlk `auto` run bu yüzden ~1 dakika
sürebilir, sonrakiler saniyeler alır.

## 4. Nasıl çalışır — kısa özet

- Her **run** tek bir içerik demektir. Bir run, moduna göre sıralı aşamalardan
  geçer (carousel: konsept → plan → copy → visual → compose → qc).
- `auto: true` ile run tüm aşamaları tek seferde zincirler; `auto: false` ile
  her aşamadan sonra dashboard'da "Onayla"yı beklersin.
- Bir aşama insan girdisi gerektiriyorsa (ör. gerçek görsel üretimi key'siz
  çalıştırılıyorsa) run `awaiting_operator` durumuna düşer — dashboard'da ne
  yapman gerektiği yazar, sen işi yapıp ilgili `submit-*` uç noktasına
  gönderince run kaldığı yerden devam eder. Bu bir hata değil, tasarımın
  parçası — hat asla kırılmaz, bekler.
- QC aşaması `rejected` derse yayın engellenir; dashboard'da "Yayınla (insan
  onayı)" butonuyla bilinçli olarak üzerine geçebilirsin — bu karar geçmişe
  `published_over_qc_rejection` olarak yazılır.
- Dashboard run sayfasını 2 saniyede bir polling ile günceller, elle yenilemen
  gerekmez.
- Maliyet: her aşamanın tahmini/gerçek maliyeti run sayfasında görünür.
  `MOCK_MODE=true` iken her şey $0.00.

## 5. `claude` CLI bağlantısı (API key gerekmez)

Sanat yönetmeni, copywriter ve carousel QC ajanları `claude` CLI'sini spawn
eder ve **senin kendi Claude Code oturumunu** kullanır — ayrı bir API key
girmene gerek yok. Gereken tek şey:

```bash
claude --version   # çalışıyor olmalı
```

ve terminalde `claude` ile giriş yapılmış olması. CLI bulunamazsa veya oturum
düşmüşse ilgili aşama hatayla patlamaz, `awaiting_operator` durumuna düşer ve
hat kırılmadan bekler.

## 6. Görsel/video üretimi — Higgsfield

Higgsfield de aynı mantıkla çalışır: ayrı bir API key şart değil, `claude`
CLI'ye bağlı **Higgsfield MCP connector**'ı üzerinden kullanıcı oturumuyla
üretim yapılır. `HIGGSFIELD_API_KEY` / `FAL_KEY` boşsa ve `MOCK_VISUAL=false`
ise, visual aşaması `awaiting_operator`'a düşer: bir Claude Code oturumu MCP
araçlarıyla üretip `submit-visual` ile sonucu bildirir.

Tam otomatik (HTTP, insansız) çalıştırmak istersen `.env.local`'e
`HIGGSFIELD_API_KEY` veya `FAL_KEY` gir.

## 7. Gerçeğe geçiş sırası (önerilen)

Her şeyi aynı anda gerçeğe almak yerine tek tek dene:

1. `MOCK_MODE=true` ile carousel modunu uçtan uca çalıştır, hattı anla.
2. `MOCK_QC=false` yaparak sadece QC ajanını gerçek `claude` CLI'ye bağla.
3. Görsel üretimini operatör yoluyla dene (key girmeden, `submit-visual`).
4. Hazırsan `FAL_KEY` / `HIGGSFIELD_API_KEY` girip tam otomatik moda geç.

`real-video` modu için ayrıca ffmpeg/ffprobe ve (opsiyonel) ElevenLabs key'i
gerekir — bkz. `.env.local.example`'daki ilgili bölüm.

## 8. Sık karşılaşılan takılmalar

- **"CLI bulunamadı"**: `CLAUDE_CLI_PATH` ile yolu elle ver.
- **Aşama sürekli `awaiting_operator`'da kalıyor**: bu bir hata değil, tasarım
  gereği — ilgili aşama insan onayı/girişi bekliyor demektir. Dashboard'da
  talimat görünür.
- **`npm run build` NFT trace uyarısı verir**: zararsız, `next.config.ts` ile
  ilgili bilinen bir uyarı, build'i durdurmuyor.

Daha fazla bilinen sınır ve açık madde için README.md'nin sonundaki
"Bilinen açık maddeler" bölümüne bak.
