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

## 3. İlk projeni oluştur

```bash
cp -r projects/_template projects/deneme
```

`projects/deneme/config.json`'ı `config.example.json`'dan türet ve marka
adı/platform gibi alanları doldur. Sonra dashboard'dan yeni run başlat.

## 4. `claude` CLI bağlantısı (API key gerekmez)

Sanat yönetmeni, copywriter ve carousel QC ajanları `claude` CLI'sini spawn
eder ve **senin kendi Claude Code oturumunu** kullanır — ayrı bir API key
girmene gerek yok. Gereken tek şey:

```bash
claude --version   # çalışıyor olmalı
```

ve terminalde `claude` ile giriş yapılmış olması. CLI bulunamazsa veya oturum
düşmüşse ilgili aşama hatayla patlamaz, `awaiting_operator` durumuna düşer ve
hat kırılmadan bekler.

## 5. Görsel/video üretimi — Higgsfield

Higgsfield de aynı mantıkla çalışır: ayrı bir API key şart değil, `claude`
CLI'ye bağlı **Higgsfield MCP connector**'ı üzerinden kullanıcı oturumuyla
üretim yapılır. `HIGGSFIELD_API_KEY` / `FAL_KEY` boşsa ve `MOCK_VISUAL=false`
ise, visual aşaması `awaiting_operator`'a düşer: bir Claude Code oturumu MCP
araçlarıyla üretip `submit-visual` ile sonucu bildirir.

Tam otomatik (HTTP, insansız) çalıştırmak istersen `.env.local`'e
`HIGGSFIELD_API_KEY` veya `FAL_KEY` gir.

## 6. Gerçeğe geçiş sırası (önerilen)

Her şeyi aynı anda gerçeğe almak yerine tek tek dene:

1. `MOCK_MODE=true` ile carousel modunu uçtan uca çalıştır, hattı anla.
2. `MOCK_QC=false` yaparak sadece QC ajanını gerçek `claude` CLI'ye bağla.
3. Görsel üretimini operatör yoluyla dene (key girmeden, `submit-visual`).
4. Hazırsan `FAL_KEY` / `HIGGSFIELD_API_KEY` girip tam otomatik moda geç.

`real-video` modu için ayrıca ffmpeg/ffprobe ve (opsiyonel) ElevenLabs key'i
gerekir — bkz. `.env.local.example`'daki ilgili bölüm.

## 7. Sık karşılaşılan takılmalar

- **"CLI bulunamadı"**: `CLAUDE_CLI_PATH` ile yolu elle ver.
- **Aşama sürekli `awaiting_operator`'da kalıyor**: bu bir hata değil, tasarım
  gereği — ilgili aşama insan onayı/girişi bekliyor demektir. Dashboard'da
  talimat görünür.
- **`npm run build` NFT trace uyarısı verir**: zararsız, `next.config.ts` ile
  ilgili bilinen bir uyarı, build'i durdurmuyor.

Daha fazla bilinen sınır ve açık madde için README.md'nin sonundaki
"Bilinen açık maddeler" bölümüne bak.
