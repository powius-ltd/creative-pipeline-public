export const MOCK_MODE = process.env.MOCK_MODE !== "false";

export type MockableStage =
  | "konsept"
  | "script"
  | "voice"
  | "visual"
  | "montage"
  | "qc"
  | "music"
  // ---- real-video modu ----
  // `render` ve `finish` ayrı: render Remotion (dakikalar, GPU), finish ffmpeg
  // (saniyeler). Birini gerçek koşup diğerini mocklamak sık gereken bir kombinasyon.
  //
  // `kurgu` BİLEREK YOK: o aşama deterministik ve bedava (LLM yok, ağ yok), yani
  // mocklanacak bir maliyeti de riski de yok. Bayrağı tanımlamak "kapatılabilir"
  // izlenimi verirdi.
  | "footage"
  | "render"
  | "finish"
  // ---- ai-video modu ----
  // footage'ın üretim dalıyla aynı gerekçe: karakter çapası ve sahne üretimi
  // bu modun en pahalı kalemleri, ayrı ayrı kapatılabilmeleri gerekiyor.
  | "karakter"
  | "sahne";

const OVERRIDE_ENV: Record<MockableStage, string> = {
  konsept: "MOCK_KONSEPT",
  script: "MOCK_SCRIPT",
  voice: "MOCK_VOICE",
  visual: "MOCK_VISUAL",
  montage: "MOCK_MONTAGE",
  qc: "MOCK_QC",
  music: "MOCK_MUSIC",
  footage: "MOCK_FOOTAGE",
  render: "MOCK_RENDER",
  finish: "MOCK_FINISH",
  karakter: "MOCK_KARAKTER",
  sahne: "MOCK_SAHNE",
};

/**
 * Per-stage mock control: MOCK_MODE is the global default, but any stage can be
 * flipped independently (e.g. MOCK_VOICE=false while everything else stays mocked)
 * as real API keys become available one at a time.
 */
export function isMock(stage: MockableStage): boolean {
  const raw = process.env[OVERRIDE_ENV[stage]];
  if (raw === "true") return true;
  if (raw === "false") return false;
  return MOCK_MODE;
}
