/**
 * VİDEO ÖLÇÜM ÇEKİRDEĞİ — Gemini'ye sorulacak ortak şema ve promptlar.
 *
 * İki tüketicisi var:
 *   - `lib/modes/real-video/qc.ts` — ürettiğimiz video niyete uydu mu
 *   - `analyze-refs.mts` — rakip/referans kreatifi sök (kurgu grameri çıkar)
 *
 * Paylaşılan şey ÖLÇÜM (plan sınırları, tempo, hook, ekran metni, ses). Her
 * tüketici bunun üstüne kendi alanlarını ekliyor — `runPlannerCore`'un eklenti
 * dikişiyle aynı desen. Rakip analizi ayrıca `structure`/`ending`/
 * `stratejiEtiketi` istiyor; QC ise bizim çizelgemizle karşılaştırma istiyor.
 * Ölçümü tek yerde tutmanın sebebi: iki taraf farklı sayarsa karşılaştırma
 * anlamsızlaşır.
 *
 * Bu dosya BİLEREK bağımlılıksız (yalnızca tip ve saf fonksiyon), çünkü
 * `analyze-refs.mts` boru hattından tamamen bağımsız çalışıyor ve onu
 * `node analyze-refs.mts` ile doğrudan koşabilmek gerekiyor.
 */

export const SHOT_SUBJECTS = ["yüz", "ürün", "ortam", "detay", "metin", "ekran"] as const;
export const CAMERA_MOTIONS = [
  "static",
  "push-in",
  "pull-out",
  "pan",
  "handheld",
  "whip",
] as const;
export const TRANSITIONS = ["cut", "dissolve", "whip", "match", "none"] as const;

export interface MeasuredShot {
  startSec: number;
  endSec: number;
  subject: (typeof SHOT_SUBJECTS)[number];
  cameraMotion: (typeof CAMERA_MOTIONS)[number];
  transitionIn: (typeof TRANSITIONS)[number];
}

export interface MeasuredText {
  startSec: number;
  endSec: number;
  text: string;
  position: "üst" | "orta" | "alt";
}

export interface VideoMeasurement {
  durationSec: number;
  oneLineSubject: string;
  shots: MeasuredShot[];
  pacing: {
    avgShotSec: number;
    shortestShotSec: number;
    longestShotSec: number;
    shotsInFirst5Sec: number;
  };
  hook: {
    firstCutAtSec: number;
    first1_5SecDescription: string;
    openingText: string;
  };
  onScreenText: MeasuredText[];
  audio: {
    hasVoiceover: boolean;
    hasMusic: boolean;
    approxWordsPerMinute: number;
  };
}

/**
 * Gemini HTTP API'sinin `responseSchema` biçimi (tip adları BÜYÜK HARF).
 * CLI yolunda kullanılmıyor — CLI'de şema zorlaması yok, orada
 * `MEASUREMENT_SHAPE_TEXT` prompt'a gömülüp çıktı kodda doğrulanıyor.
 */
export const MEASUREMENT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    durationSec: { type: "NUMBER", description: "Toplam süre, saniye." },
    oneLineSubject: {
      type: "STRING",
      description: "Video neyi anlatıyor — TEK cümle, sıfatsız.",
    },
    shots: {
      type: "ARRAY",
      description:
        "Her PLAN bir kayıt. Yeni plan = kesme veya geçiş. Kamera hareketi plan bölmez.",
      items: {
        type: "OBJECT",
        properties: {
          startSec: { type: "NUMBER" },
          endSec: { type: "NUMBER" },
          subject: { type: "STRING", enum: [...SHOT_SUBJECTS] },
          cameraMotion: { type: "STRING", enum: [...CAMERA_MOTIONS] },
          transitionIn: { type: "STRING", enum: [...TRANSITIONS] },
        },
        required: ["startSec", "endSec", "subject", "cameraMotion", "transitionIn"],
      },
    },
    pacing: {
      type: "OBJECT",
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
      properties: {
        firstCutAtSec: { type: "NUMBER" },
        first1_5SecDescription: { type: "STRING" },
        openingText: { type: "STRING" },
      },
      required: ["firstCutAtSec", "first1_5SecDescription", "openingText"],
    },
    onScreenText: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          startSec: { type: "NUMBER" },
          endSec: { type: "NUMBER" },
          text: { type: "STRING" },
          position: { type: "STRING", enum: ["üst", "orta", "alt"] },
        },
        required: ["startSec", "endSec", "text", "position"],
      },
    },
    audio: {
      type: "OBJECT",
      properties: {
        hasVoiceover: { type: "BOOLEAN" },
        hasMusic: { type: "BOOLEAN" },
        approxWordsPerMinute: { type: "NUMBER" },
      },
      required: ["hasVoiceover", "hasMusic", "approxWordsPerMinute"],
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
  ],
};

/** CLI yolunda prompt'a gömülen şema tarifi (orada `--json-schema` yok). */
export const MEASUREMENT_SHAPE_TEXT = `{
  "durationSec": <sayı>,
  "oneLineSubject": "<tek cümle>",
  "shots": [{ "startSec": <sayı>, "endSec": <sayı>,
              "subject": "${SHOT_SUBJECTS.join("|")}",
              "cameraMotion": "${CAMERA_MOTIONS.join("|")}",
              "transitionIn": "${TRANSITIONS.join("|")}" }],
  "pacing": { "avgShotSec": <sayı>, "shortestShotSec": <sayı>,
              "longestShotSec": <sayı>, "shotsInFirst5Sec": <tamsayı> },
  "hook": { "firstCutAtSec": <sayı>, "first1_5SecDescription": "<kısa>",
            "openingText": "<ekrandaki ilk metin, yoksa boş>" },
  "onScreenText": [{ "startSec": <sayı>, "endSec": <sayı>,
                     "text": "<birebir>", "position": "üst|orta|alt" }],
  "audio": { "hasVoiceover": <bool>, "hasMusic": <bool>, "approxWordsPerMinute": <sayı> }
}`;

export const MEASUREMENT_SYSTEM_PROMPT =
  "Sen bir kurgu analistisin. Videoyu izler ve SADECE ölçülebilir gerçekleri raporlarsın. " +
  "Estetik yargı, beğeni ifadesi, atmosfer sıfatı ve tavsiye YASAK. " +
  "Emin olmadığın bir zaman damgasını uydurma, en yakın gözlemlediğin değeri ver.";

export const MEASUREMENT_USER_PROMPT =
  "Bu videoyu kurgu açısından sök. Plan (shot) sınırlarını kesme/geçiş noktalarından " +
  "belirle — kamera hareketi tek başına yeni plan başlatmaz. Zaman damgalarını saniye " +
  "cinsinden, videonun gerçek süresini aşmayacak şekilde ver. Ekrandaki metinleri " +
  "birebir yaz, çevirme.";

/**
 * Gemini'nin inline medya sınırı. gemini-cli bundle'ında `MAX_FILE_SIZE_MB = 20`
 * olarak SABİT; HTTP API'de de inline_data için benzer bir tavan var (analyze-refs
 * 18MB kullanıyor). Aşan dosya `makeProxy` ile küçültülmeli.
 */
export const GEMINI_INLINE_LIMIT_BYTES = 20 * 1024 * 1024;

export function mimeOfVideo(file: string): string {
  const ext = file.toLowerCase().slice(file.lastIndexOf("."));
  switch (ext) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

/**
 * Çıktı doğrulayıcı. CLI'de şema zorlaması olmadığı için ZORUNLU: eksik alanla
 * dönen bir ölçüm sessizce yanlış QC verdict'ine yol açardı.
 *
 * Hata döndürür (string) ya da geçerliyse null.
 */
export function validateMeasurement(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return "kök bir nesne değil";
  const o = parsed as Record<string, unknown>;

  if (typeof o.durationSec !== "number") return "durationSec sayı değil";
  if (typeof o.oneLineSubject !== "string") return "oneLineSubject metin değil";

  if (!Array.isArray(o.shots)) return "shots dizi değil";
  for (const [i, s] of (o.shots as unknown[]).entries()) {
    const sh = s as Record<string, unknown>;
    if (typeof sh?.startSec !== "number" || typeof sh?.endSec !== "number") {
      return `shots[${i}] zaman damgası eksik`;
    }
    if (!SHOT_SUBJECTS.includes(sh.subject as never)) {
      return `shots[${i}].subject geçersiz: ${String(sh.subject)}`;
    }
    if (!CAMERA_MOTIONS.includes(sh.cameraMotion as never)) {
      return `shots[${i}].cameraMotion geçersiz: ${String(sh.cameraMotion)}`;
    }
    if (!TRANSITIONS.includes(sh.transitionIn as never)) {
      return `shots[${i}].transitionIn geçersiz: ${String(sh.transitionIn)}`;
    }
  }

  const p = o.pacing as Record<string, unknown> | undefined;
  if (!p || typeof p.avgShotSec !== "number") return "pacing.avgShotSec eksik";

  const h = o.hook as Record<string, unknown> | undefined;
  if (!h || typeof h.firstCutAtSec !== "number") return "hook.firstCutAtSec eksik";

  if (!Array.isArray(o.onScreenText)) return "onScreenText dizi değil";

  const a = o.audio as Record<string, unknown> | undefined;
  if (!a || typeof a.hasVoiceover !== "boolean") return "audio.hasVoiceover eksik";

  return null;
}
