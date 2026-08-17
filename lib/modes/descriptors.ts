import type { AspectRatioId } from "../config/aspect";
import type { ModeId, Platform, RunState, StageId } from "../orchestrator/types";

/**
 * SAF VERİ — hem istemci hem sunucu import eder.
 *
 * Mod tanımlarının kendisi (lib/modes/index.ts) ajan fonksiyonları içerir ve bunlar
 * node:fs / node:child_process kullanır, yani istemciye import edilemez. Ama RunView
 * aşama listesini ve etiketleri göstermek zorunda — o yüzden descriptor'lar burada
 * ayrı tutuluyor.
 */

export interface StageDescriptor {
  id: StageId;
  label: string;
}

export interface ModeDescriptor {
  id: ModeId;
  label: string;
  description: string;
  /** Dashboard önizlemesinin hangi bileşene çatallanacağını belirler. */
  output: "video" | "carousel" | "real-video";
  /** Terminal aşamalar (ready_to_publish/published) HARİÇ, sıralı. */
  stages: StageDescriptor[];
  /** Maliyet tablosunda satırı olan aşamalar. */
  costStages: StageId[];
  /**
   * Bu modda seçilebilir oranlar + platform başına varsayılan. `config/aspect.ts`
   * yalnızca piksel kısıtlarını bilir, mod bilgisi TAŞIMAZ (config→modes yönü tek
   * yönlü kalsın diye) — o yüzden varsayılan burada, "saf veri" descriptor'ında.
   */
  aspects: AspectRatioId[];
  defaultAspectByPlatform: Record<Platform, AspectRatioId>;
  /**
   * "AI ile üretildi" toggle'ının form varsayılanı. Gerçek çekim modlarında
   * (real-video) `false` — ibare gerçek bir çekimde yanlış beyan olurdu.
   * AI'nin tek başına ürettiği modlarda (ai-video) `true` olacak.
   */
  watermarkDefault: boolean;
  /**
   * Dondurulmuş mod: yeni run BAŞLATILAMAZ ve seçim listesinde görünmez, ama
   * kodu ve descriptor'ı yerinde durur — mevcut run'lar açılmaya, ilerlemeye ve
   * doğru etiketlerle görünmeye devam eder. Silmek yerine dondurmanın sebebi bu.
   */
  frozen?: boolean;
  /** Neden donduruldu — UI'da ve API hatasında gösterilir. */
  frozenReason?: string;
}

export const TERMINAL_STAGE_LABELS: Record<StageId, string> = {
  ready_to_publish: "Yayına Hazır",
  published: "Yayınlandı",
};

const FULL_AI_VIDEO: ModeDescriptor = {
  id: "full-ai-video",
  label: "Tam AI Video",
  description:
    "Senaryo, ses, görsel ve video tamamen AI ile üretilir; dikey kısa video çıkar.",
  output: "video",
  stages: [
    { id: "brief", label: "Brief & Senaryo" },
    { id: "voice", label: "Ses Ajanı" },
    { id: "visual", label: "Görsel/Video Ajanı" },
    { id: "montage", label: "Montaj Ajanı" },
    { id: "qc", label: "Final QC" },
  ],
  costStages: ["brief", "voice", "visual", "montage", "qc"],
  aspects: ["9:16"],
  defaultAspectByPlatform: {
    instagram: "9:16",
    tiktok: "9:16",
    youtube_shorts: "9:16",
    other: "9:16",
  },
  watermarkDefault: false,
  frozen: true,
  frozenReason:
    "Donduruldu — odak carousel modunda. Kod ve mevcut run'lar duruyor; " +
    "brief ajanı hâlâ gerçek LLM'e bağlı değil (lib/agents/script.ts).",
};

const CAROUSEL: ModeDescriptor = {
  id: "carousel",
  label: "Carousel",
  description:
    "Sanat yönetmeni tema kurar, copywriter metinleri yazar, slide görselleri " +
    "tutarlı bir stille üretilir. Çıktı: post edilebilir PNG seti + caption.",
  output: "carousel",
  stages: [
    { id: "konsept", label: "Konsept (Stratejist × Muhalif)" },
    { id: "plan", label: "Sanat Yönetmeni" },
    { id: "copy", label: "Copywriter" },
    { id: "visual", label: "Görsel Üretimi" },
    { id: "compose", label: "Dizgi" },
    { id: "qc", label: "Final QC" },
  ],
  costStages: ["konsept", "plan", "copy", "visual", "compose", "qc"],
  // `other: "4:5"` channels.ts'teki eski `other: {...IG}` (4:5) davranışını
  // birebir korur — platform default'u değişmiyor, yalnızca seçilebilir oldu.
  aspects: ["4:5", "9:16", "1:1"],
  defaultAspectByPlatform: {
    instagram: "4:5",
    tiktok: "9:16",
    youtube_shorts: "9:16",
    other: "4:5",
  },
  watermarkDefault: false,
};

const REAL_VIDEO: ModeDescriptor = {
  id: "real-video",
  label: "Gerçek Video (CapCut tarzı)",
  description:
    "Gerçek çekim/foto materyalden dikey kısa video: kesme, geçiş, kelime-kelime " +
    "altyazı, ElevenLabs seslendirme ve müzik. AI görsel yalnızca destek.",
  output: "real-video",
  stages: [
    { id: "konsept", label: "Konsept (Stratejist × Muhalif)" },
    { id: "plan", label: "Sanat Yönetmeni (sahne yayı)" },
    { id: "copy", label: "Copywriter (VO + ekran metni)" },
    { id: "footage", label: "Materyal Seçimi" },
    { id: "voice", label: "Seslendirme (kelime zamanlı)" },
    { id: "kurgu", label: "Kurgu (çizelge kurulumu)" },
    { id: "compose", label: "Render (Remotion)" },
    { id: "finish", label: "Ses Karışımı & Encode (ffmpeg)" },
    { id: "qc", label: "Final QC (Gemini + Claude)" },
  ],
  costStages: [
    "konsept",
    "plan",
    "copy",
    "footage",
    "voice",
    "kurgu",
    "compose",
    "finish",
    "qc",
  ],
  aspects: ["9:16", "4:5", "1:1"],
  defaultAspectByPlatform: {
    instagram: "9:16",
    tiktok: "9:16",
    youtube_shorts: "9:16",
    other: "9:16",
  },
  // Gerçek çekim: ibare yanlış beyan olurdu.
  watermarkDefault: false,
};

const AI_VIDEO: ModeDescriptor = {
  id: "ai-video",
  label: "AI Video (absürt)",
  description:
    "Tamamen AI üretimi, açıkça-AI kurgu dili: aynı karakter vahşice değişen " +
    "ortamlarda — bir anda ay'da, bir anda denizin altında. Kurgu bunu gizlemez, vurgular.",
  // real-video'nun önizleme bileşenini yeniden kullanır — `output` mod adı değil
  // bileşen seçimi (bkz. yukarıdaki alan yorumu).
  output: "real-video",
  stages: [
    { id: "konsept", label: "Konsept (Stratejist × Muhalif)" },
    { id: "plan", label: "Sanat Yönetmeni (sahne yayı)" },
    { id: "copy", label: "Copywriter (VO + ekran metni)" },
    // voice ÜRETİMDEN ÖNCE: materyal burada bedava değil, süresi paraya
    // çevriliyor. Seslendirme gerçek süreyi öğrenmenin en ucuz yolu.
    { id: "voice", label: "Seslendirme (kelime zamanlı)" },
    { id: "karakter", label: "Karakter Çapası" },
    { id: "sahne", label: "Sahne Üretimi (AI video)" },
    { id: "kurgu", label: "Kurgu (çizelge kurulumu)" },
    { id: "compose", label: "Render (Remotion)" },
    { id: "finish", label: "Ses Karışımı & Encode (ffmpeg)" },
    { id: "qc", label: "Final QC (Gemini + Claude)" },
  ],
  costStages: [
    "konsept",
    "plan",
    "copy",
    "voice",
    "karakter",
    "sahne",
    "kurgu",
    "compose",
    "finish",
    "qc",
  ],
  aspects: ["9:16"],
  defaultAspectByPlatform: {
    instagram: "9:16",
    tiktok: "9:16",
    youtube_shorts: "9:16",
    other: "9:16",
  },
  // AI'nin tek başına ürettiği mod: ibare doğru beyan.
  watermarkDefault: true,
};

export const MODE_DESCRIPTORS: Record<ModeId, ModeDescriptor> = {
  "full-ai-video": FULL_AI_VIDEO,
  carousel: CAROUSEL,
  "real-video": REAL_VIDEO,
  "ai-video": AI_VIDEO,
};

/** Tüm modlar — dondurulmuşlar dahil. Mevcut run'ları çözümlemek için. */
export const MODE_LIST: ModeDescriptor[] = [FULL_AI_VIDEO, CAROUSEL, REAL_VIDEO, AI_VIDEO];

/** Yeni run/proje için seçilebilir modlar. Formlar BUNU kullanmalı. */
export const ACTIVE_MODES: ModeDescriptor[] = MODE_LIST.filter((m) => !m.frozen);

export const DEFAULT_MODE: ModeId = ACTIVE_MODES[0].id;

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && value in MODE_DESCRIPTORS;
}

/** Yeni run başlatılabilir mi? Dondurulmuş modlar için hayır. */
export function isSelectableMode(value: unknown): value is ModeId {
  return isModeId(value) && !MODE_DESCRIPTORS[value].frozen;
}

export function getDescriptor(mode: ModeId): ModeDescriptor {
  const d = MODE_DESCRIPTORS[mode];
  if (!d) throw new Error(`Bilinmeyen mod: ${mode}`);
  return d;
}

/** Aşama sırası = modun aşamaları + terminal aşamalar. */
export function stageOrder(mode: ModeId): StageId[] {
  return [
    ...getDescriptor(mode).stages.map((s) => s.id),
    "ready_to_publish",
    "published",
  ];
}

export function stageLabel(mode: ModeId, stage: StageId): string {
  const own = getDescriptor(mode).stages.find((s) => s.id === stage);
  return own?.label ?? TERMINAL_STAGE_LABELS[stage] ?? stage;
}

/**
 * TEK ÇÖZÜCÜ — run oluşturma, form varsayılanı ve eski-run geriye dönük
 * uyumluluğu buradan geçmek zorunda. `aspect` açıkça verilmişse VE modun
 * seçilebilir kümesindeyse kullanılır; aksi hâlde mod+platform varsayılanına
 * düşer. Eski run'larda `aspect` alanı yok — bu fonksiyon onlar için de
 * bugünkü davranışı (varsayılan) üretir, geriye dönük kırılma olmaz.
 */
export function resolveAspect(
  mode: ModeId,
  platform: Platform,
  aspect: AspectRatioId | undefined,
): AspectRatioId {
  const d = getDescriptor(mode);
  if (aspect && d.aspects.includes(aspect)) return aspect;
  return d.defaultAspectByPlatform[platform] ?? d.aspects[0];
}

/** `resolveAspect`'in run'a uygulanmış kısayolu — çağıranlar mode/platform/aspect'i tek tek çıkarmasın diye. */
export function runAspect(state: Pick<RunState, "mode" | "platform" | "aspect">): AspectRatioId {
  return resolveAspect(state.mode, state.platform, state.aspect);
}
