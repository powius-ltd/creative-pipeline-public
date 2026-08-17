/**
 * REFERANS VİDEO SÖKÜCÜ — kurgu gramerini sayıya çevirir.
 *
 * Nişte işe yarayan videoları Gemini'ye izletip her birinden ÖLÇÜLEBİLİR veri
 * çıkarır, sonra bu verileri düz kodla birleştirip refs/GRAMMAR.md üretir.
 *
 * Hattan (lib/modes, lib/agents, stateMachine) TAMAMEN bağımsızdır ve bilinçli
 * olarak öyle tutulmuştur: burada üretilen şey henüz bir üretim adımı değil,
 * insanın okuyup kurgu gramerini kavraması için bir ölçüm çalışmasıdır.
 *
 * Çalıştırma (Node 24 .mts dosyalarını doğrudan koşar, tsx/ts-node gerekmez):
 *   node analyze-refs.mts                       → refs.json'daki her şeyi işler
 *   node analyze-refs.mts "https://youtu.be/X"  → tek video
 *   node analyze-refs.mts ./ornek.mp4           → yerel dosya
 *   node analyze-refs.mts --force               → mevcut analizleri yeniden üretir
 *   node analyze-refs.mts --only-report         → API'ye gitmez, sadece GRAMMAR.md'yi yeniden yazar
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Ortam
// ---------------------------------------------------------------------------

/**
 * .env.local'ı elle okuyoruz. Next uygulaması bunu kendisi yüklüyor ama bu script
 * Next dışında, düz Node olarak koşuyor. `node --env-file` de çözerdi ama o zaman
 * çalıştırma komutu uzuyor ve unutulduğunda hata mesajı anlaşılmaz oluyor.
 */
function loadEnvLocal(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadEnvLocal();

const API_KEY = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? "";

/**
 * flash-lite bu iş için bilinçli tercih: video ~300 token/saniye tüketiyor, yani
 * asıl maliyet GİRDİ tarafında. Ölçüm işi (kesme noktası, süre, metin okuma)
 * muhakeme değil algı gerektirdiği için büyük modele çıkmanın karşılığı yok.
 */
const MODEL = process.env.GEMINI_VIDEO_MODEL ?? "gemini-3.1-flash-lite";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** $/1M girdi token — yalnızca konsola maliyet basmak için; hattın cost çerçevesine girmiyor. */
const INPUT_PRICE_PER_M = Number(process.env.GEMINI_INPUT_PRICE_PER_M ?? 0.25);
const OUTPUT_PRICE_PER_M = Number(process.env.GEMINI_OUTPUT_PRICE_PER_M ?? 1.5);

const OUT_DIR = path.resolve(process.cwd(), "refs");
const INPUT_FILE = path.resolve(process.cwd(), "refs.json");

/** inline_data sınırı. Bunun üstü File API resumable upload ister — bilinçli olarak yok. */
const INLINE_LIMIT_BYTES = 18 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Şema — TASARIM KURALI: her alan ya bir SAYI ya bir ZAMAN DAMGASI taşır.
//
// Sayılamayan/zamanlanamayan hiçbir alan buraya girmez. Sebep: model serbest
// bırakılırsa "etkileyici açılış", "dinamik kurgu", "profesyonel renk" üretir.
// Bunlar 10 videoda birleştirildiğinde tek bir uygulanabilir kural vermiyor —
// okuyunca bir şey öğrenilmiş hissi veriyor, elde bir şey kalmıyor.
// Sayılar birleşir, sıfatlar birleşmez.
// ---------------------------------------------------------------------------

const SCHEMA = {
  type: "OBJECT",
  propertyOrdering: [
    "durationSec",
    "oneLineSubject",
    "shots",
    "pacing",
    "hook",
    "onScreenText",
    "audio",
    "structure",
    "ending",
    "stratejiEtiketi",
  ],
  properties: {
    durationSec: { type: "NUMBER", description: "Videonun toplam süresi, saniye." },
    oneLineSubject: {
      type: "STRING",
      description: "Video neyi anlatıyor — TEK cümle. Yorum ve sıfat yok, sadece konu.",
    },

    shots: {
      type: "ARRAY",
      description:
        "Her PLAN (shot) bir kayıt. Yeni plan = kesme veya geçiş. Kamera hareketi plan bölmez.",
      items: {
        type: "OBJECT",
        propertyOrdering: ["startSec", "endSec", "subject", "cameraMotion", "transitionIn"],
        properties: {
          startSec: { type: "NUMBER" },
          endSec: { type: "NUMBER" },
          subject: {
            type: "STRING",
            enum: ["yüz", "ürün", "ortam", "detay", "metin", "ekran"],
            description: "Karede baskın olan şey.",
          },
          cameraMotion: {
            type: "STRING",
            enum: ["static", "push-in", "pull-out", "pan", "handheld", "whip"],
          },
          transitionIn: {
            type: "STRING",
            enum: ["cut", "dissolve", "whip", "match", "none"],
            description: "Bu plana NASIL girildi. İlk plan için 'none'.",
          },
        },
        required: ["startSec", "endSec", "subject", "cameraMotion", "transitionIn"],
      },
    },

    pacing: {
      type: "OBJECT",
      propertyOrdering: ["avgShotSec", "shortestShotSec", "longestShotSec", "shotsInFirst5Sec"],
      properties: {
        avgShotSec: { type: "NUMBER" },
        shortestShotSec: { type: "NUMBER" },
        longestShotSec: { type: "NUMBER" },
        shotsInFirst5Sec: { type: "INTEGER" },
      },
      required: ["avgShotSec", "shortestShotSec", "longestShotSec", "shotsInFirst5Sec"],
    },

    hook: {
      type: "OBJECT",
      propertyOrdering: ["firstCutAtSec", "hookType", "first1_5SecDescription", "openingText"],
      properties: {
        firstCutAtSec: {
          type: "NUMBER",
          description: "İlk kesmenin saniyesi. Hiç kesme yoksa videonun süresi.",
        },
        hookType: {
          type: "STRING",
          enum: ["soru", "iddia", "görsel-şok", "yüz-konuşma", "ürün", "ortam"],
        },
        first1_5SecDescription: {
          type: "STRING",
          description: "İlk 1.5 saniyede ekranda NE OLDUĞU. Betimleme, değerlendirme değil.",
        },
        openingText: {
          type: "STRING",
          description: "Açılışta ekranda yazı varsa birebir metni; yoksa boş string.",
        },
      },
      required: ["firstCutAtSec", "hookType", "first1_5SecDescription", "openingText"],
    },

    onScreenText: {
      type: "ARRAY",
      description: "Ekranda beliren her metin bloğu. Altyazı akıyorsa cümle cümle böl.",
      items: {
        type: "OBJECT",
        propertyOrdering: ["startSec", "endSec", "text", "wordCount", "position"],
        properties: {
          startSec: { type: "NUMBER" },
          endSec: { type: "NUMBER" },
          text: { type: "STRING" },
          wordCount: { type: "INTEGER" },
          position: { type: "STRING", enum: ["üst", "orta", "alt"] },
        },
        required: ["startSec", "endSec", "text", "wordCount", "position"],
      },
    },

    audio: {
      type: "OBJECT",
      propertyOrdering: ["hasVoiceover", "hasMusic", "musicStartSec", "approxWordsPerMinute"],
      properties: {
        hasVoiceover: { type: "BOOLEAN" },
        hasMusic: { type: "BOOLEAN" },
        musicStartSec: { type: "NUMBER", description: "Müzik yoksa -1." },
        approxWordsPerMinute: {
          type: "NUMBER",
          description: "Konuşma hızı. Konuşma yoksa 0.",
        },
      },
      required: ["hasVoiceover", "hasMusic", "musicStartSec", "approxWordsPerMinute"],
    },

    structure: {
      type: "ARRAY",
      description: "Videonun anlatı bölümleri, zaman sırasıyla. Bölüm yoksa boş dizi.",
      items: {
        type: "OBJECT",
        propertyOrdering: ["label", "startSec", "endSec"],
        properties: {
          label: { type: "STRING", enum: ["hook", "problem", "çözüm", "kanıt", "cta"] },
          startSec: { type: "NUMBER" },
          endSec: { type: "NUMBER" },
        },
        required: ["label", "startSec", "endSec"],
      },
    },

    ending: {
      type: "OBJECT",
      propertyOrdering: ["ctaPresent", "ctaText", "lastFrameDescription"],
      properties: {
        ctaPresent: { type: "BOOLEAN" },
        ctaText: { type: "STRING", description: "CTA yoksa boş string." },
        lastFrameDescription: { type: "STRING", description: "Son karede ne var. Tek cümle." },
      },
      required: ["ctaPresent", "ctaText", "lastFrameDescription"],
    },

    /**
     * Powius pazarlama taksonomisi — powius-pazarlama/taksonomi.json (tek kaynak).
     * Bu ENUM SEÇİMİDİR, sıfat üretimi değil: "sayılar birleşir, sıfatlar
     * birleşmez" kuralı burada da geçerli — model sabit kategorilerden birini
     * seçiyor, yeni kategori icat etmiyor. 10-20 rakip videosu birleştiğinde
     * "14'ü acı/korku, kimlik hiç yok" gibi dağılım çıkarılabilir hale gelir.
     */
    stratejiEtiketi: {
      type: "OBJECT",
      propertyOrdering: ["aci", "tetikleyici", "funnelKatmaniTahmini", "hookAmaci", "anatomikKananAna"],
      properties: {
        aci: {
          type: "STRING",
          enum: ["sonuc-kazanim", "aci-korku", "kimlik", "sosyal-kanit"],
          description: "Angle Matrix açısı — hangi kapıdan giriyor (strateji-referansi.md §3.2).",
        },
        tetikleyici: {
          type: "STRING",
          enum: ["merak", "zaman-tasarrufu", "para-tasarrufu", "sosyal-kanit", "otorite"],
          description: "Hook Mimarisi 6A.4 — izleyicinin zihninde hangi düğmeye basılıyor.",
        },
        funnelKatmaniTahmini: {
          type: "INTEGER",
          enum: [1, 2, 3, 4, 5],
          description: "Bu videonun hitap ettiği izleyici hangi farkındalık seviyesinde (Schwartz).",
        },
        hookAmaci: {
          type: "STRING",
          enum: ["beklendik", "soru-ac"],
          description: "hook.hookType ile karışmasın — bu, izleyicide onaylama mı merak mı tetiklediği.",
        },
        anatomikKananAna: {
          type: "STRING",
          enum: ["gorsel", "yazi", "isitsel"],
          description: "Hook'un ANA kanalı — audio/onScreenText/shots'tan çıkar, tekrar tanımlama.",
        },
      },
      required: ["aci", "tetikleyici", "funnelKatmaniTahmini", "hookAmaci", "anatomikKananAna"],
    },
  },
  required: [
    "durationSec",
    "oneLineSubject",
    "shots",
    "pacing",
    "hook",
    "onScreenText",
    "audio",
    "structure",
    "ending",
    "stratejiEtiketi",
  ],
};

/**
 * Sistem promptu tek bir şeyi dayatıyor: ÖLÇ, YORUMLAMA. Şema alanları zaten
 * ölçüm istiyor ama model boşluk bulduğu her yerde değerlendirme cümlesi
 * üretmeye meyilli; bu talimat onu kesiyor.
 */
const SYSTEM_PROMPT =
  "Sen bir kurgu analistisin. Videoyu izler ve SADECE ölçülebilir gerçekleri raporlarsın. " +
  "Estetik yargı, beğeni ifadesi, atmosfer sıfatı ve tavsiye YASAK. " +
  "Emin olmadığın bir zaman damgasını uydurma, en yakın gözlemlediğin değeri ver. " +
  "TEK İSTİSNA: stratejiEtiketi alanı sabit bir taksonomiden ENUM SEÇİMİDİR — orada " +
  "yorum yazmıyorsun, verilen kategorilerden en yakınını seçiyorsun (yeni kategori icat etme). " +
  "Yalnızca istenen JSON şemasına uyan çıktı üret.";

const USER_PROMPT =
  "Bu videoyu kurgu açısından sök. Plan (shot) sınırlarını kesme/geçiş noktalarından belirle — " +
  "kamera hareketi tek başına yeni plan başlatmaz. Zaman damgalarını saniye cinsinden, " +
  "videonun gerçek süresini aşmayacak şekilde ver. Ekrandaki metinleri birebir yaz, çevirme. " +
  "stratejiEtiketi için: hook ve structure alanlarındaki gözlemlerinle tutarlı ol — ayrı ayrı " +
  "çelişme (ör. hookType='soru' ama hookAmaci='beklendik' demek gibi).";

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

interface RefInput {
  slug?: string;
  src: string;
  platform?: string;
  note?: string;
}

interface Shot {
  startSec: number;
  endSec: number;
  subject: string;
  cameraMotion: string;
  transitionIn: string;
}

interface Analysis {
  durationSec: number;
  oneLineSubject: string;
  shots: Shot[];
  pacing: {
    avgShotSec: number;
    shortestShotSec: number;
    longestShotSec: number;
    shotsInFirst5Sec: number;
  };
  hook: {
    firstCutAtSec: number;
    hookType: string;
    first1_5SecDescription: string;
    openingText: string;
  };
  onScreenText: {
    startSec: number;
    endSec: number;
    text: string;
    wordCount: number;
    position: string;
  }[];
  audio: {
    hasVoiceover: boolean;
    hasMusic: boolean;
    musicStartSec: number;
    approxWordsPerMinute: number;
  };
  structure: { label: string; startSec: number; endSec: number }[];
  ending: { ctaPresent: boolean; ctaText: string; lastFrameDescription: string };
  stratejiEtiketi: {
    aci: string;
    tetikleyici: string;
    funnelKatmaniTahmini: number;
    hookAmaci: string;
    anatomikKananAna: string;
  };
}

/** Diskte tutulan kayıt: analiz + hangi girdiden geldiği. */
interface StoredRecord extends RefInput {
  slug: string;
  model: string;
  analysis: Analysis;
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function isUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** YouTube id'si varsa onu kullan — aynı video iki farklı link formatıyla verilse bile aynı slug. */
function deriveSlug(src: string): string {
  if (isUrl(src)) {
    const m = src.match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{6,})/);
    if (m) return `yt-${m[1]}`;
    return "url-" + Buffer.from(src).toString("base64url").slice(0, 12);
  }
  return path
    .basename(src, path.extname(src))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mimeOf(file: string): string {
  const map: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mov": "video/mov",
    ".webm": "video/webm",
    ".avi": "video/avi",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpg",
    ".flv": "video/x-flv",
    ".wmv": "video/wmv",
    ".3gp": "video/3gpp",
  };
  return map[path.extname(file).toLowerCase()] ?? "video/mp4";
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function countBy(values: string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// Gemini çağrısı
// ---------------------------------------------------------------------------

interface CallResult {
  analysis: Analysis;
  inputTokens: number;
  outputTokens: number;
}

function buildMediaPart(src: string): Record<string, unknown> {
  if (isUrl(src)) {
    // YouTube (ve desteklenen diğer URL'ler) indirilmeden doğrudan gönderilir.
    return { file_data: { file_uri: src } };
  }

  const abs = path.resolve(process.cwd(), src);
  if (!fs.existsSync(abs)) throw new Error(`Dosya bulunamadı: ${abs}`);

  const size = fs.statSync(abs).size;
  if (size > INLINE_LIMIT_BYTES) {
    throw new Error(
      `Dosya çok büyük (${(size / 1024 / 1024).toFixed(1)} MB > ${INLINE_LIMIT_BYTES / 1024 / 1024} MB). ` +
        `Bu script inline gönderim yapıyor, File API upload'ı yok. ` +
        `Videoyu kısalt/sıkıştır ya da YouTube linkini kullan.`,
    );
  }

  return {
    inline_data: {
      mime_type: mimeOf(abs),
      data: fs.readFileSync(abs).toString("base64"),
    },
  };
}

async function callGemini(src: string): Promise<CallResult> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [buildMediaPart(src), { text: USER_PROMPT }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
      maxOutputTokens: 32768,
    },
  };

  // 429/5xx geçici olabiliyor; iki kez artan bekleme ile yeniden dene.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const wait = attempt * 8000;
      console.log(`   ↻ yeniden deneniyor (${attempt}/2), ${wait / 1000}sn bekleniyor…`);
      await new Promise((r) => setTimeout(r, wait));
    }

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      // 4xx (429 hariç) yeniden denemeyle düzelmez — hemen bırak.
      if (res.status < 500 && res.status !== 429) break;
      continue;
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      lastErr = new Error(`İstek engellendi: ${data.promptFeedback.blockReason}`);
      break;
    }

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) {
      lastErr = new Error(`Boş yanıt (finishReason: ${candidate?.finishReason ?? "?"})`);
      continue;
    }
    if (candidate?.finishReason === "MAX_TOKENS") {
      lastErr = new Error("Yanıt maxOutputTokens'a takıldı — video çok uzun olabilir.");
      break;
    }

    let analysis: Analysis;
    try {
      analysis = JSON.parse(text) as Analysis;
    } catch {
      lastErr = new Error(`Yanıt JSON değil: ${text.slice(0, 300)}`);
      continue;
    }

    return {
      analysis,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  throw lastErr ?? new Error("Bilinmeyen hata");
}

// ---------------------------------------------------------------------------
// GRAMMAR.md — LLM YOK, düz kod.
//
// Sentez için ikinci bir model çağrısı bilinçli olarak eklenmedi: kavranması
// gereken şey sayıların kendisi. Model araya girip yorumlarsa öğrenilen şey
// modelin yorumu olur, veri olmaz.
// ---------------------------------------------------------------------------

function buildGrammar(records: StoredRecord[]): string {
  const L: string[] = [];
  const A = records.map((r) => r.analysis);

  L.push("# Kurgu grameri — ölçüm tablosu");
  L.push("");
  L.push(`${records.length} referans video · model: \`${records[0]?.model ?? MODEL}\``);
  L.push("");
  L.push(
    "> Bu dosya otomatik üretildi ve **yorum içermez** — yalnızca sayılar. Kuralı sen çıkaracaksın.",
  );
  L.push("");

  // --- Karşılaştırma tablosu ---
  L.push("## Video başına");
  L.push("");
  L.push(
    "| slug | kanal | süre | plan | ort.plan | ilk kesme | ilk 5sn | hook | metin | ses | CTA |",
  );
  L.push("|---|---|--:|--:|--:|--:|--:|---|--:|---|:-:|");
  for (const r of records) {
    const a = r.analysis;
    const ses = a.audio.hasVoiceover ? (a.audio.hasMusic ? "vo+mzk" : "vo") : a.audio.hasMusic ? "mzk" : "—";
    L.push(
      `| ${r.slug} | ${r.platform ?? "—"} | ${fmt(a.durationSec)}s | ${a.shots.length} | ` +
        `${fmt(a.pacing.avgShotSec)}s | ${fmt(a.hook.firstCutAtSec)}s | ${a.pacing.shotsInFirst5Sec} | ` +
        `${a.hook.hookType} | ${a.onScreenText.length} | ${ses} | ${a.ending.ctaPresent ? "✓" : "—"} |`,
    );
  }
  L.push("");

  // --- Toplu sayılar ---
  // Son alan: kaç ondalık basılacağı. Sayım alanlarında ondalık gürültü —
  // "2.0 plan" okumayı zorlaştırıyor, ortalamada 0 ondalık da yanıltıyor,
  // o yüzden min/maks tam sayı, medyan/ortalama tek ondalık basılıyor.
  const rows: [string, number[], string, boolean][] = [
    ["Toplam süre", A.map((a) => a.durationSec), "sn", false],
    ["Plan sayısı", A.map((a) => a.shots.length), "adet", true],
    ["Ortalama plan süresi", A.map((a) => a.pacing.avgShotSec), "sn", false],
    ["En kısa plan", A.map((a) => a.pacing.shortestShotSec), "sn", false],
    ["En uzun plan", A.map((a) => a.pacing.longestShotSec), "sn", false],
    ["İlk kesme", A.map((a) => a.hook.firstCutAtSec), "sn", false],
    ["İlk 5 sn'deki plan", A.map((a) => a.pacing.shotsInFirst5Sec), "adet", true],
    ["Ekran metni bloğu", A.map((a) => a.onScreenText.length), "adet", true],
    [
      "Metin kelime sayısı",
      A.flatMap((a) => a.onScreenText.map((t) => t.wordCount)),
      "kelime/blok",
      true,
    ],
    [
      "Konuşma hızı",
      A.map((a) => a.audio.approxWordsPerMinute).filter((v) => v > 0),
      "kelime/dk",
      true,
    ],
  ];

  L.push("## Toplu istatistik");
  L.push("");
  L.push("| ölçüm | min | medyan | ortalama | maks | birim |");
  L.push("|---|--:|--:|--:|--:|---|");
  for (const [label, values, unit, isCount] of rows) {
    if (!values.length) continue;
    const edge = isCount ? 0 : 1;
    L.push(
      `| ${label} | ${fmt(Math.min(...values), edge)} | ${fmt(median(values))} | ` +
        `${fmt(mean(values))} | ${fmt(Math.max(...values), edge)} | ${unit} |`,
    );
  }
  L.push("");

  // --- Dağılımlar ---
  const dists: [string, [string, number][]][] = [
    ["Hook tipi", countBy(A.map((a) => a.hook.hookType))],
    ["Plan konusu", countBy(A.flatMap((a) => a.shots.map((s) => s.subject)))],
    ["Kamera hareketi", countBy(A.flatMap((a) => a.shots.map((s) => s.cameraMotion)))],
    ["Geçiş tipi", countBy(A.flatMap((a) => a.shots.map((s) => s.transitionIn)))],
    ["Metin konumu", countBy(A.flatMap((a) => a.onScreenText.map((t) => t.position)))],
  ];

  L.push("## Dağılımlar");
  L.push("");
  for (const [label, counts] of dists) {
    if (!counts.length) continue;
    const total = counts.reduce((s, [, n]) => s + n, 0);
    L.push(
      `**${label}** — ` +
        counts.map(([k, n]) => `${k} ${n} (%${Math.round((n / total) * 100)})`).join(" · "),
    );
    L.push("");
  }

  // --- Strateji taksonomisi (powius-pazarlama/taksonomi.json) ---
  const stratDists: [string, [string, number][]][] = [
    ["Açı (aci)", countBy(A.map((a) => a.stratejiEtiketi.aci))],
    ["Tetikleyici", countBy(A.map((a) => a.stratejiEtiketi.tetikleyici))],
    ["Funnel katmanı (tahmin)", countBy(A.map((a) => String(a.stratejiEtiketi.funnelKatmaniTahmini)))],
    ["Hook amacı", countBy(A.map((a) => a.stratejiEtiketi.hookAmaci))],
    ["Ana anatomik kanal", countBy(A.map((a) => a.stratejiEtiketi.anatomikKananAna))],
  ];

  L.push("## Strateji taksonomisi");
  L.push("");
  L.push(
    "> Enum seçimidir, sıfat değil (bkz. SYSTEM_PROMPT). Boş kalan kategori = " +
      "rakiplerin denemediği (ya da işe yaramadığı için terk ettiği) açı — " +
      "hangisi olduğuna insan karar verir (arge dokümanı §7.4).",
  );
  L.push("");
  for (const [label, counts] of stratDists) {
    if (!counts.length) continue;
    const total = counts.reduce((s, [, n]) => s + n, 0);
    L.push(
      `**${label}** — ` +
        counts.map(([k, n]) => `${k} ${n} (%${Math.round((n / total) * 100)})`).join(" · "),
    );
    L.push("");
  }

  // --- Anlatı sırası ---
  const sequences = A.map((a) => a.structure.map((s) => s.label).join(" → ")).filter(Boolean);
  if (sequences.length) {
    L.push("## Anlatı sırası");
    L.push("");
    for (const [seq, n] of countBy(sequences)) L.push(`- \`${seq}\` — ${n} video`);
    L.push("");
  }

  // --- Hook detayı: asıl okunacak yer ---
  L.push("## İlk 1.5 saniye (her video)");
  L.push("");
  for (const r of records) {
    const h = r.analysis.hook;
    L.push(`- **${r.slug}** (${h.hookType}, ilk kesme ${fmt(h.firstCutAtSec)}s)`);
    L.push(`  - ${h.first1_5SecDescription}`);
    if (h.openingText) L.push(`  - ekranda: "${h.openingText}"`);
  }
  L.push("");

  // --- CTA ---
  const ctas = records.filter((r) => r.analysis.ending.ctaPresent);
  if (ctas.length) {
    L.push("## Kapanış / CTA");
    L.push("");
    for (const r of ctas) {
      L.push(`- **${r.slug}**: "${r.analysis.ending.ctaText}" — ${r.analysis.ending.lastFrameDescription}`);
    }
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("**Bu tablodan en az 3 SERT kural çıkarabiliyor musun?**");
  L.push("");
  L.push('Örnek biçim: "plan süresi 2 sn\'yi geçmiyor", "ilk kesme 1.5 sn\'den önce",');
  L.push('"ekran metni hep altta ve 6 kelimeyi aşmıyor".');
  L.push("");
  L.push("Çıkaramıyorsan sorun script'te değil şemadadır — alanları yeniden düşün.");

  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------

function readInputs(argv: string[]): RefInput[] {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length) return positional.map((src) => ({ src }));

  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(
      `${INPUT_FILE} yok ve komut satırında video verilmedi.\n` +
        `refs.json oluştur ya da doğrudan bir link/dosya ver:\n` +
        `  node analyze-refs.mts "https://www.youtube.com/shorts/XXXX"`,
    );
  }

  const parsed = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("refs.json bir dizi olmalı.");
  return parsed as RefInput[];
}

function loadExisting(): StoredRecord[] {
  if (!fs.existsSync(OUT_DIR)) return [];
  return fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")) as StoredRecord)
    .filter((r) => r?.analysis?.shots);
}

function writeReport(records: StoredRecord[]): void {
  if (!records.length) {
    console.log("\nRapor yazılmadı: elde analiz yok.");
    return;
  }
  records.sort((a, b) => a.slug.localeCompare(b.slug));
  const out = path.join(OUT_DIR, "GRAMMAR.md");
  fs.writeFileSync(out, buildGrammar(records), "utf8");
  console.log(`\n📄 ${path.relative(process.cwd(), out)} yazıldı (${records.length} video).`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const onlyReport = argv.includes("--only-report");

  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (onlyReport) {
    writeReport(loadExisting());
    return;
  }

  if (!API_KEY) {
    console.error(
      "GOOGLE_AI_API_KEY boş.\n" +
        "  1. aistudio.google.com/apikey adresinden key al\n" +
        "  2. .env.local içindeki GOOGLE_AI_API_KEY= satırını doldur",
    );
    process.exitCode = 1;
    return;
  }

  const inputs = readInputs(argv);
  if (!inputs.length) {
    console.log(
      `refs.json boş. Şu biçimde doldur:\n\n` +
        `[\n` +
        `  { "slug": "rakip-hook-1", "src": "https://www.youtube.com/shorts/XXXX", "platform": "shorts" },\n` +
        `  { "slug": "tiktok-urun",  "src": "./refs/tiktok-urun.mp4", "platform": "tiktok" }\n` +
        `]\n\n` +
        `"src" bir YouTube linki ya da yerel dosya yolu olabilir. "slug" ve "platform" isteğe bağlı.\n` +
        `Tek video denemek için listeye hiç dokunmadan:\n` +
        `  node analyze-refs.mts "https://www.youtube.com/shorts/XXXX"`,
    );
    return;
  }
  console.log(`Model: ${MODEL} · ${inputs.length} video · çıktı: refs/\n`);

  let totalIn = 0;
  let totalOut = 0;
  let done = 0;
  let skipped = 0;
  const failed: string[] = [];

  // SIRAYLA işleniyor, paralel değil: rate limit'e takılmamak ve maliyeti
  // gözle takip edebilmek için. 10 video birkaç dakika sürer.
  for (const [i, input] of inputs.entries()) {
    const slug = input.slug ?? deriveSlug(input.src);
    const outFile = path.join(OUT_DIR, `${slug}.json`);
    const errFile = path.join(OUT_DIR, `${slug}.error.txt`);
    const label = `[${i + 1}/${inputs.length}] ${slug}`;

    if (fs.existsSync(outFile) && !force) {
      console.log(`${label} — atlandı (analiz var, --force ile ez)`);
      skipped++;
      continue;
    }

    console.log(`${label} — ${input.src}`);
    const started = Date.now();

    try {
      const { analysis, inputTokens, outputTokens } = await callGemini(input.src);

      const record: StoredRecord = { ...input, slug, model: MODEL, analysis };
      fs.writeFileSync(outFile, JSON.stringify(record, null, 2), "utf8");
      if (fs.existsSync(errFile)) fs.unlinkSync(errFile);

      totalIn += inputTokens;
      totalOut += outputTokens;
      done++;

      const cost =
        (inputTokens / 1e6) * INPUT_PRICE_PER_M + (outputTokens / 1e6) * OUTPUT_PRICE_PER_M;
      console.log(
        `   ✓ ${analysis.shots.length} plan · ${fmt(analysis.durationSec)}s · ` +
          `${((Date.now() - started) / 1000).toFixed(0)}sn · ` +
          `${inputTokens.toLocaleString("tr-TR")} girdi token · ~$${cost.toFixed(4)}`,
      );
    } catch (err) {
      // Bir video patlarsa diğerleri devam eder — 10 videonun 9'u işe yarar.
      const msg = err instanceof Error ? err.message : String(err);
      fs.writeFileSync(errFile, `${input.src}\n\n${msg}\n`, "utf8");
      failed.push(slug);
      console.log(`   ✗ ${msg.split("\n")[0]}`);
    }
  }

  console.log(
    `\nBitti — ${done} yeni · ${skipped} atlandı · ${failed.length} hata` +
      (failed.length ? ` (${failed.join(", ")})` : ""),
  );
  if (totalIn || totalOut) {
    const cost = (totalIn / 1e6) * INPUT_PRICE_PER_M + (totalOut / 1e6) * OUTPUT_PRICE_PER_M;
    console.log(
      `Token: ${totalIn.toLocaleString("tr-TR")} girdi / ${totalOut.toLocaleString("tr-TR")} çıktı · ` +
        `toplam ~$${cost.toFixed(3)}`,
    );
  }

  writeReport(loadExisting());
}

main().catch((err) => {
  console.error("\n" + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
