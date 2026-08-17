import type { AspectRatioId } from "../config/aspect";
import type { Language } from "../config/language";

/**
 * Aşama kimliği artık sabit bir union değil: her mod kendi aşama listesini
 * lib/modes/descriptors.ts içinde tanımlar. Sıra bilgisi modun descriptor'ından,
 * terminal aşamalar aşağıdaki TERMINAL_STAGES'ten gelir.
 */
export type StageId = string;

export type ModeId = "full-ai-video" | "carousel" | "real-video" | "ai-video";

/** Her modun aşama listesinin sonuna state machine tarafından eklenir. */
export const TERMINAL_STAGES: StageId[] = ["ready_to_publish", "published"];

export type RunStatus =
  | "awaiting_approval"
  | "running"
  | "awaiting_operator"
  | "awaiting_publish"
  | "published"
  | "error";

/**
 * Set when a stage's real (non-mock) work can only be done by an MCP-only tool
 * (Higgsfield) or a CLI the operator owns the login for — i.e. by a Claude Code
 * session acting as the operator, not by the Next.js server on its own.
 * The operator does the work, then POSTs the result to the stage's submit-* route.
 */
export interface OperatorTask {
  stage: StageId;
  instructions: string;
}

// ---- Video modu yükü -------------------------------------------------------

export type CameraAnimation =
  | "zoom-in"
  | "zoom-out"
  | "pan-left"
  | "pan-right"
  | "breathing"
  | "static";

export interface Scene {
  id: string;
  index: number;
  durationSec: number;
  voiceLine: string;
  visualPrompt: string;
  cameraAnimation: CameraAnimation;
}

// ---- Carousel modu yükü ----------------------------------------------------

/**
 * Planner çekirdeğinin ürettiği marka teması. `styleContract` her görsel
 * prompt'una HARFİYEN eklenir — N görseli tek bir carousel yapan şey budur.
 */
export interface VisualTheme {
  palette: string;
  lighting: string;
  shotStyle: string;
  typography: string;
  styleContract: string;
}

export type SlideRole = "hook" | "body" | "cta";

/**
 * "baked": yazıyı gpt-image-2/edit görselin üstüne çizer (tasarlanmış görünüm).
 * "overlay": temiz görsel üretilir, metni Remotion bindirir (metin garanti doğru,
 * marka fontu birebir, düzeltmesi bedava).
 */
export type SlideTextMode = "baked" | "overlay";

export interface Slide {
  id: string;
  index: number;
  /** Planner belirler (tasarım kararı). */
  role: SlideRole;
  /** Planner belirler (tasarım kararı). */
  textMode: SlideTextMode;
  /** Planner yazar: bu slide'ın anlatıdaki işi. Copywriter bunu okuyup metni yazar. */
  intent: string;
  /** Copywriter doldurur. */
  headline: string;
  /** Copywriter doldurur. */
  body: string;
  visualPrompt: string;
}

// ---- Gerçek video modu yükü -----------------------------------------------

export type RealSceneRole = "hook" | "problem" | "cozum" | "kanit" | "cta";

/**
 * Sahne, gerçek video modunda bir ANLATI BİRİMİ — tek bir klip değil. Kurgu
 * aşaması bir sahneyi birden çok klibe bölebilir (Aşama B), o yüzden klip
 * bilgisi ayrı (`FootageClip`) tutuluyor.
 */
export interface RealScene {
  id: string;
  index: number;
  role: RealSceneRole;
  /** Sanat yönetmeni yazar: bu sahnenin anlatıdaki işi. */
  intent: string;
  /** Sanat yönetmeni yazar: hangi tür çekim aranmalı (materyal seçim brief'i). */
  shotIdea: string;
  /** Tahmini süre; gerçek süre seslendirmeden sonra netleşir. */
  durationSec: number;
  /** Copywriter doldurur — seslendirilecek metin. */
  voiceLine: string;
  /** Copywriter doldurur — ekranda yazacak kısa metin (altyazıdan ayrı). */
  onScreenText: string;
}

// ---- ai-video modu yükü (absürt/AI-yerli üretim) ---------------------------

/**
 * Karakter ÇAPASI — carousel'in `styleContract` deseninin kimlik eşdeğeri.
 * Çapa İLK SAHNE DEĞİL, ayrı bir portre: sahne 1 geniş plan olabilir ve yüz
 * kötü bir referans olurdu. `identityContract` her sahne prompt'una HARFİYEN
 * eklenir — ortam vahşice değişirken karakterin aynı kalmasını sağlayan cümle.
 */
export interface CharacterSpec {
  /** Planner yazar: kim bu kişi — yaş, görünüm, giysi, ayırt edici detay. */
  description: string;
  /** Çapa görselinin üretim prompt'u: orta-yakın plan, nötr fon, yüz net. */
  anchorPrompt: string;
  /** Her sahne prompt'una harfiyen eklenir. */
  identityContract: string;
}

export type SceneCamera = "sabit" | "hareketli";

/**
 * ai-video sahnesi — `RealScene`'in üretim-yerli karşılığı. Aynı alanları
 * taşıyor (kurgu çekirdeği ikisini de aynı `KurguSceneBase`'den türetiyor,
 * bkz. `lib/agents/video/kurguCore.ts`) artı üç KARAR alanı:
 * `environmentJump`/`camera`/`speaking` — bunlar serbest metinden ÇIKARILMAZ,
 * LLM'in kapalı enum/boolean olarak bildirmesi gerekir, çünkü kurgu kararı
 * ("ortam sıçradıysa sert kesme") serbest metin karşılaştırmasına dayanamaz.
 */
export interface AiScene {
  id: string;
  index: number;
  role: RealSceneRole;
  intent: string;
  /** ÜRETİM prompt'u — real-video'nun arama tarifinin ZITTI, eksiksiz tarif olmalı. */
  shotIdea: string;
  /** Ortam tarifi — prompt malzemesi. */
  environment: string;
  /** Bir önceki sahneye göre ortam sıçradı mı — kurgu bunu okuyup sert kesme uygular. */
  environmentJump: boolean;
  /** Ken Burns kapısı: "sabit" ise render kamera hareketi eklemez (klip kendi hareketini getiriyor). */
  camera: SceneCamera;
  /** Lip-sync DİKİŞİ — henüz hiçbir model bağlı değil, yalnızca taşınıyor. */
  speaking: boolean;
  durationSec: number;
  voiceLine: string;
  onScreenText: string;
}

/** ffprobe ile ölçülmüş kaynak klip. Ölçüm, LLM tahmini değil. */
export interface FootageClip {
  sceneId: string;
  /** cwd'ye göreli dosya yolu — assets/footage/ altında. */
  file: string;
  /** Kaynak klip içindeki kullanılacak aralık. */
  inSec: number;
  outSec: number;
  probe: {
    durationSec: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    rotation: number;
  };
}

export type RunPayload =
  | { kind: "video"; scenes: Scene[] }
  | {
      kind: "carousel";
      theme: VisualTheme | null;
      slides: Slide[];
      caption: string;
      hashtags: string[];
    }
  | {
      kind: "real-video";
      theme: VisualTheme | null;
      scenes: RealScene[];
      footage: FootageClip[];
      caption: string;
      hashtags: string[];
      /**
       * Kreatif direktörün sembolik olay listesi. Aşama A'da null kalır (kurgu
       * deterministik kurulur); Aşama B'de LLM direktörü doldurur ve
       * `lib/timeline/anchors.ts` saniyeye çevirir.
       */
      edl: unknown[] | null;
    }
  | {
      kind: "ai-video";
      theme: VisualTheme | null;
      character: CharacterSpec | null;
      scenes: AiScene[];
      /** Aynı `FootageClip` şekli — üretilen klip de ffprobe ile ÖLÇÜLÜYOR (bkz. sahne.ts). */
      footage: FootageClip[];
      caption: string;
      hashtags: string[];
    };

export function emptyPayload(kind: RunPayload["kind"]): RunPayload {
  if (kind === "carousel") {
    return { kind: "carousel", theme: null, slides: [], caption: "", hashtags: [] };
  }
  if (kind === "real-video") {
    return {
      kind: "real-video",
      theme: null,
      scenes: [],
      footage: [],
      caption: "",
      hashtags: [],
      edl: null,
    };
  }
  if (kind === "ai-video") {
    return {
      kind: "ai-video",
      theme: null,
      character: null,
      scenes: [],
      footage: [],
      caption: "",
      hashtags: [],
    };
  }
  return { kind: "video", scenes: [] };
}

/** Video modu ajanları için güvenli erişim; yanlış moddaysa boş döner. */
export function videoScenes(state: RunState): Scene[] {
  return state.payload.kind === "video" ? state.payload.scenes : [];
}

/**
 * Seslendirilecek sahneler — MODDAN BAĞIMSIZ.
 *
 * `runVoiceAgent` paylaşılan bir ajan ve eskiden doğrudan `videoScenes`
 * kullanıyordu; o da `kind !== "video"` olduğunda BOŞ DİZİ döndürüyor. Sonuç:
 * real-video modunda seslendirme aşaması "başarılı" görünüp hiçbir şey
 * üretmiyordu ve hata ancak kurgu aşamasında oransal dağıtım yedeğine
 * düşüldüğünde dolaylı olarak fark ediliyordu. Bu fonksiyon o sessiz boşluğu
 * kapatıyor: her iki yük tipinden de ses üretilecek sahneleri çıkarıyor.
 */
export interface VoiceableScene {
  id: string;
  voiceLine: string;
  durationSec: number;
}

export function voiceableScenes(state: RunState): VoiceableScene[] {
  if (state.payload.kind === "video") {
    return state.payload.scenes.map((s) => ({
      id: s.id,
      voiceLine: s.voiceLine,
      durationSec: s.durationSec,
    }));
  }
  if (state.payload.kind === "real-video" || state.payload.kind === "ai-video") {
    return state.payload.scenes.map((s) => ({
      id: s.id,
      voiceLine: s.voiceLine,
      durationSec: s.durationSec,
    }));
  }
  // carousel'de seslendirme yok — boş dönmek doğru.
  return [];
}

/** Carousel ajanları için; yanlış moddaysa açıkça patlar (sessiz hata istemiyoruz). */
export function carouselPayload(
  state: RunState,
): Extract<RunPayload, { kind: "carousel" }> {
  if (state.payload.kind !== "carousel") {
    throw new Error(
      `Bu ajan carousel yükü bekliyor ama run '${state.payload.kind}' modunda.`,
    );
  }
  return state.payload;
}

/** Gerçek video ajanları için; aynı gerekçeyle gürültülü patlıyor. */
export function realVideoPayload(
  state: RunState,
): Extract<RunPayload, { kind: "real-video" }> {
  if (state.payload.kind !== "real-video") {
    throw new Error(
      `Bu ajan real-video yükü bekliyor ama run '${state.payload.kind}' modunda.`,
    );
  }
  return state.payload;
}

/** ai-video ajanları için; aynı gerekçeyle gürültülü patlıyor. */
export function aiVideoPayload(
  state: RunState,
): Extract<RunPayload, { kind: "ai-video" }> {
  if (state.payload.kind !== "ai-video") {
    throw new Error(
      `Bu ajan ai-video yükü bekliyor ama run '${state.payload.kind}' modunda.`,
    );
  }
  return state.payload;
}

// ---- Ortak ------------------------------------------------------------------

export interface VariantIdea {
  id: string;
  label: string;
  hook: string;
  cta: string;
}

// ---- Konsept aşaması (Stratejist × Muhalif) --------------------------------

/**
 * Powius pazarlama taksonomisi — bkz. powius-pazarlama/taksonomi.json (tek kaynak).
 * Bu enum'lar orada değişirse burada da değişmeli.
 */
export type Aci = "sonuc-kazanim" | "aci-korku" | "kimlik" | "sosyal-kanit";
export type DegerBileseni =
  | "islevsel"
  | "duygusal"
  | "statu"
  | "guven"
  | "parasal"
  | "zaman-caba"
  | "psikolojik-risk"
  | "sosyal-risk";
export type Cerceve = "olumlu" | "ters";
export type IcerikTipi = "donusum" | "kurgu" | "how-to" | "lifestyle" | "podcast" | "ugc";
export type HookAmaci = "beklendik" | "soru-ac";
export type AnatomikKanal = "gorsel" | "yazi" | "isitsel";
export type Tetikleyici =
  | "merak"
  | "zaman-tasarrufu"
  | "para-tasarrufu"
  | "sosyal-kanit"
  | "otorite";

/**
 * Stratejist + Kreatif Muhalif'in üretim öncesi kurduğu konsept. Konsept aşaması
 * bittiğinde RunState.brief dolar; planner ve copywriter varsa bunu okur, yoksa
 * (brief=null) eski davranışlarıyla kendi kararlarını verirler — geriye dönük uyumluluk.
 */
export interface KreatifBrief {
  funnelKatmani: 1 | 2 | 3 | 4 | 5;
  segment: string;
  aci: Aci;
  degerBileseni: DegerBileseni;
  cerceve: Cerceve;
  icerikTipi: IcerikTipi;
  hookAmaci: HookAmaci;
  anatomikKanal: AnatomikKanal;
  tetikleyici: Tetikleyici;
  /** Stratejist'in gerekçesi — planner/copywriter'a bağlam olarak geçer. */
  hucreGerekcesi: string;
  copyYonu: string;
  temaYonu: string;
  yasaklar: string[];
  /** Kreatif Muhalif'in itirazı/karşı önerisi — konsepte katılmıyor olabilir. */
  muhalifNotu: string;
  /** variants[0].hook ile aynı olmalı — Stratejist'in önerdiği, insanın onayladığı hook. */
  secilenHook: string;
  ucSaniyeTesti: "gecti" | "kaldi" | "belirsiz";
}

export interface HistoryEntry {
  at: string;
  stage: StageId;
  action: string;
  note?: string;
}

/**
 * baseUrl: fal-hosted URL — zincirleme /edit çağrılarında referans olarak kullanılır.
 * basePath: yerel dosya — Remotion, QC ve tarayıcı servisi yerel dosya ister.
 * finalPath: tipografi/overlay geçişinden sonraki nihai PNG.
 */
export interface SlideAsset {
  baseUrl: string;
  basePath: string;
  finalPath?: string;
}

export interface RunAssets {
  voice: Record<string, string>;
  visual: Record<string, { image: string; video: string }>;
  slideAssets?: Record<string, SlideAsset>;
  captionFile?: string;
  /**
   * real-video'da Remotion'ın bastığı SESSİZ montaj (`montage.mp4`). Ses ffmpeg
   * finisajında biniyor — donmuş video modunda ise bu alan timeline.json yolunu
   * tutuyor. İki mod aynı alanı farklı anlamda kullanıyor, bu yüzden okuyan
   * taraf moda bakmalı.
   */
  montage?: string;
  musicTrack?: string;
  /** Finisaj sonrası yayına hazır dosya. */
  finalVideo?: string;

  // ---- real-video modu ----
  /** sceneId → `{sceneId}.words.json` yolu (kelime damgaları). */
  words?: Record<string, string>;
  /** Kaynak klip yolları — operatörün `assets/footage/` altına attıkları. */
  footage?: Record<string, string>;
  /** Gemini'nin 20MB sınırı için üretilmiş küçültülmüş kopyalar. */
  proxies?: Record<string, string>;
  /** Analiz/QC için çıkarılmış kareler. */
  keyframes?: Record<string, string[]>;
  /** Çok kanallı çizelgenin diskteki hâli (`timeline.v2.json`). */
  timelineV2?: string;

  // ---- ai-video modu ----
  /**
   * Karakter çapası — `url` (hosted, i2i zincirleme referansı için) VE `path`
   * (yerel dosya, asset servisi/QC için) İKİSİ DE saklanıyor. Aynı ikilik
   * `SlideAsset`teki gerekçenin aynısı.
   */
  characterRef?: { url: string; path: string };
}

/**
 * QC Heyeti'nin üç merceği — bilimsel vekilleri KREATIF-DIREKTORLUK-ARGE.md §4, §6.2.
 * Ölçüm amaçlı (checklist), üretken değil — tek çağrıda üç blok olarak dönerler.
 */
export interface QcLensScore {
  puan: 1 | 2 | 3 | 4 | 5;
  not: string;
}

export interface QcResult {
  verdict: "pending" | "approved" | "rejected";
  notes?: string;
  flaggedScenes?: string[];
  /** Mock'ta veya video modunda boş kalabilir — yalnızca carousel QC dolduruyor. */
  mercekler?: {
    dikkat: QcLensScore;
    duygu: QcLensScore;
    marka: QcLensScore;
  };
}

export interface RunState {
  runId: string;
  projectSlug: string;
  createdAt: string;
  updatedAt: string;
  auto: boolean;
  mode: ModeId;
  /**
   * Kanal run oluşturulurken SABİTLENİR (projeden kopyalanır). İki sebep:
   * (1) ajanların proje config'ini okuması runStore'a bağımlılık yaratır ve
   *     runStore -> cost -> modes -> ajanlar döngüsünü geri getirir;
   * (2) projenin kanalı sonradan değişse bile eski run kendi kanalıyla kalmalı.
   */
  platform: Platform;
  /**
   * Çıktı dili — `platform` ile AYNI GEREKÇEYLE run'a dondurulmuş kopyalanıyor
   * (bkz. yukarıdaki not). Ek olarak: bir projenin dili sonradan değişirse
   * yayınlanmış run'ın metni hangi dilde üretildiği bilgisini kaybetmemeli.
   * Eski run'larda alan yok — `languageSpec()` undefined'ı Türkçe'ye düşürüyor.
   */
  language?: Language;
  /**
   * Kare oranı — `platform`/`language` ile AYNI GEREKÇEYLE run'a dondurulmuş
   * (yukarıdaki not). `language` projeye, bu RUN'A ait: kullanıcı kararı gereği
   * oran run başına seçiliyor, proje varsayılanı yalnızca formu önden doldurur.
   * Eski run'larda alan yok — `resolveAspect()` mod+platform varsayılanına düşer.
   */
  aspect?: AspectRatioId;
  /**
   * "AI ile üretildi" ibaresi — `platform`/`language`/`aspect` ile AYNI
   * GEREKÇEYLE run'a dondurulmuş. Env değil: bu bir BEYAN ve yayınlanmış bir
   * videonun onu taşıyıp taşımadığı `state.json`'dan geri okunabilmeli; env
   * global ve denetlenemez. Eski run'larda alan yok → yoksa kapalı sayılır.
   */
  watermark?: boolean;
  stage: StageId;
  status: RunStatus;
  topic: string;
  notes: string;
  variants: VariantIdea[];
  chosenVariantId: string | null;
  /** Konsept aşaması tamamlanmadan (ya da mod desteklemiyorsa) null. */
  brief?: KreatifBrief | null;
  payload: RunPayload;
  assets: RunAssets;
  qc: QcResult;
  history: HistoryEntry[];
  error?: string;
  operatorTask?: OperatorTask;
  cost?: RunCost;
}

export type Platform = "tiktok" | "instagram" | "youtube_shorts" | "other";

export interface ProjectConfig {
  slug: string;
  name: string;
  platform: Platform;
  defaultMode: ModeId;
  defaultAuto: boolean;
  /** Yoksa Türkçe — hattın eklenmeden önceki tek davranışı. */
  language?: Language;
  createdAt: string;
}

export interface ReservedVariant extends VariantIdea {
  runId: string;
  createdAt: string;
}

/**
 * Bir performans kaydının hangi dünyadan geldiği. ZORUNLU alan — bkz.
 * powius-pazarlama/olcum/creative-key.md.
 *
 * Aynı creative hem organik hem ücretli yayınlanabilir ve ikisinin metrik şeması
 * tamamen farklıdır (organik: izlenme/kaydetme/trial, ücretli: spend/roas/frequency).
 * Bu alan olmadan iki şema aynı `performance[]` dizisinde ayırt edilemeden karışır ve
 * ortalama alan her kod yanlış sayı üretir.
 */
export type PerformanceKanal = "organik" | "ucretli" | "site";

export interface PerformanceEntry {
  at: string;
  runId: string;
  variantId: string;
  kanal: PerformanceKanal;
  /**
   * Kaydın kaynağı: organikte "instagram" | "tiktok" | ..., ücretlide "meta" | "google",
   * sitede "posthog" gibi. Ücretli için ZORUNLU sayılmalı: ads-analyst spec'inin 2.
   * doğruluk kuralı ("Meta ROAS'ı ile Google ROAS'ı toplanmaz, atıf pencereleri
   * farklıdır") ancak bu alan varsa brand-memory tarafında da korunabilir.
   */
  platform?: string;
  metrics: Record<string, number>;
  notes?: string;
}

export interface BrandMemory {
  projectSlug: string;
  tone: string;
  history: { at: string; note: string }[];
  reservedVariants: ReservedVariant[];
  performance: PerformanceEntry[];
}

export interface AgentResult {
  patch: Partial<RunState>;
  note: string;
  /** Ajan gerçek maliyetini biliyorsa (claude CLI zarfı, fal çağrı sayısı) bildirir. */
  cost?: ActualCostReport;
}

export type CostVendor =
  | "claude"
  | "elevenlabs"
  | "elevenlabs-music"
  | "fal"
  | "higgsfield"
  | "gemini"
  | "compute";

export interface CostLine {
  vendor: CostVendor;
  detail: string;
  usd: number;
}

export interface RunCost {
  estimated: Record<StageId, CostLine[]>;
  actual: Record<StageId, CostLine[]>;
}

/** Operatör (veya claude CLI zarfı) submit sırasında gerçek maliyeti bildirebilir. */
export interface ActualCostReport {
  costUsd?: number;
  vendor?: CostVendor;
  detail?: string;
  claudeInputTokens?: number;
  claudeOutputTokens?: number;
}
