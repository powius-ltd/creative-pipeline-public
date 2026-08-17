import fsp from "node:fs/promises";
import path from "node:path";
import { generateClip } from "../../agents/video/generateClip";
import { aspectSpec } from "../../config/aspect";
import { isMock } from "../../config/mock";
import { PRICES } from "../../cost/prices";
import { probe } from "../../media/ffmpeg";
import { OperatorRequiredError } from "../../orchestrator/operatorError";
import { runAssetsDir } from "../../orchestrator/paths";
import type { AgentResult, FootageClip, RunState } from "../../orchestrator/types";
import { realVideoPayload } from "../../orchestrator/types";
import { toRelative } from "../../providers/download";
import { hasGenerationProvider } from "../../providers/generation";
import { runAspect } from "../descriptors";

/**
 * MATERYAL SEÇİMİ.
 *
 * Aşama A'da bu bir OPERATÖR DEVRİ: klipleri sen seçip klasöre atıyorsun, hat
 * onları ölçüp çizelgeye bağlıyor. Otomatik seçim (klip analizi + vision ile
 * aday puanlama) Aşama B'nin işi — ve o gelene kadar hat yarı otomatik, ki
 * kreatif seçim zaten insanda kalmalı.
 *
 * Ölçüm LLM'e sorulmuyor: süre, çözünürlük, fps ve rotasyon ffprobe ile
 * ÖLÇÜLÜYOR. Bunlar `{at:"absolute"}` çapasını yazmaya yetkili tek kaynak
 * (bkz. lib/timeline/anchors.ts).
 */

export function footageDir(state: RunState): string {
  return path.join(runAssetsDir(state.projectSlug, state.runId), "footage");
}

/**
 * MATERYAL KAYNAĞI — operatör arşivi mi, AI üretimi mi.
 *
 * Anahtar varlığına bakıp OTOMATİK karar VERMİYORUZ, bilinçli olarak. `visual.ts`
 * öyle yapıyor ve orada doğru: carousel'de görsel zaten üretilecek, tek soru
 * nasıl. Burada soru başka — bu modun adı "gerçek video" ve varsayılanı gerçek
 * çekim. `FAL_KEY` duruyor diye bir salonun kendi çekimi yerine sessizce AI
 * kirpik üretmek, kullanıcının istemediği bir şeyi parayla yapmak olurdu.
 *
 * Bu yüzden AÇIK BAYRAK: `FOOTAGE_SOURCE=generate`. Yoksa operatör devri.
 */
export type FootageSource = "operator" | "generate";

export function footageSource(): FootageSource {
  return process.env.FOOTAGE_SOURCE === "generate" ? "generate" : "operator";
}

function buildGenerationOperatorInstructions(state: RunState): string {
  const payload = realVideoPayload(state);
  const sceneLines = payload.scenes
    .map((s) => `  - ${s.id} (${s.durationSec}sn): "${s.shotIdea.split("\n")[0]}"`)
    .join("\n");

  return (
    `FOOTAGE_SOURCE=generate ama HTTP ile üretecek anahtar yok ` +
    `(HIGGSFIELD_API_KEY ve FAL_KEY ikisi de boş).\n\n` +
    `Bir Claude Code operatörü Higgsfield MCP araçlarıyla (generate_image, ardından ` +
    `generate_video/motion_control) şu sahneleri üretmeli:\n${sceneLines}\n\n` +
    `Üretilen dosyaları şu klasöre koy:\n   ${footageDir(state)}\n\n` +
    `Sonra POST /api/runs/${state.runId}/submit-footage ile bildir ` +
    `(gövde biçimi operatör seçimiyle aynı — ölçüm yine ffprobe ile yapılır).`
  );
}

function buildOperatorInstructions(state: RunState, dir: string): string {
  const payload = realVideoPayload(state);

  const sceneLines = payload.scenes
    .map(
      (s) =>
        `  ${s.id} [${s.role}] ~${s.durationSec}sn\n` +
        `     replik : "${s.voiceLine}"\n` +
        `     aranan : ${s.shotIdea.split("\n")[0]}`,
    )
    .join("\n");

  const contract = payload.theme?.styleContract
    ? `\nSTİL SÖZLEŞMESİ (materyal seçim ölçütü — hepsi tek seri gibi durmalı):\n${payload.theme.styleContract}\n`
    : "";

  return (
    `Materyal seçimi operatöre ait (Aşama A'da otomatik klip analizi yok).\n\n` +
    `1. Aşağıdaki sahneler için kendi arşivinden klip/foto seç ve şu klasöre kopyala:\n` +
    `   ${dir}\n` +
    `   Desteklenen uzantılar: .mp4 .mov .webm .m4v (video) · .png .jpg .jpeg .webp (foto)\n\n` +
    `2. Sahneler:\n${sceneLines}\n${contract}\n` +
    `3. Sonucu bildir:\n` +
    `   POST /api/runs/${state.runId}/submit-footage\n` +
    `   {\n` +
    `     "projectSlug": "${state.projectSlug}",\n` +
    `     "clips": [\n` +
    `       { "sceneId": "${payload.scenes[0]?.id ?? "scene-1"}", "file": "dosya-adi.mp4", "inSec": 0, "outSec": 3.5 }\n` +
    `     ]\n` +
    `   }\n` +
    `   "file" yalnızca DOSYA ADI (klasör yolu değil). "inSec"/"outSec" kaynak klip\n` +
    `   içindeki aralık — vermezsen 0'dan sahne süresi kadarı alınır.\n\n` +
    `Not: her sahne için en az bir klip gerekli. Süre, çözünürlük ve rotasyon\n` +
    `ffprobe ile ölçülecek, tahmin etmene gerek yok.`
  );
}

/**
 * Mock'ta gerçek dosya yok. Sahte bir FootageClip üretiyoruz ki aşağı akış
 * (kurgu, compose) uçtan uca test edilebilsin — compose zaten `MOCK_RENDER` ile
 * ayrıca kapatılabiliyor.
 */
function buildMockFootage(state: RunState): FootageClip[] {
  const payload = realVideoPayload(state);
  return payload.scenes.map((s) => ({
    sceneId: s.id,
    file: `[MOCK]/${s.id}.mp4`,
    inSec: 0,
    outSec: s.durationSec,
    probe: {
      durationSec: s.durationSec,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: false,
      rotation: 0,
    },
  }));
}

export async function runFootageStage(state: RunState): Promise<AgentResult> {
  const payload = realVideoPayload(state);
  const dir = footageDir(state);
  await fsp.mkdir(dir, { recursive: true });

  if (isMock("footage")) {
    const footage = buildMockFootage(state);
    return {
      patch: { payload: { ...payload, footage } },
      note: `[MOCK] ${footage.length} sahne için sahte materyal kaydı üretildi (gerçek dosya yok).`,
    };
  }

  if (footageSource() === "generate") {
    return generateFootage(state, dir);
  }

  throw new OperatorRequiredError(buildOperatorInstructions(state, dir));
}

/**
 * AI ÜRETİMİ İLE MATERYAL.
 *
 * Aşağı akış (kurgu → render → finisaj → QC) mp4'ün nereden geldiğini
 * UMURSAMIYOR, o yüzden burada yeni bir yol açmıyoruz: üretilen dosya diske
 * indirilip `measureSubmittedClips`e veriliyor — operatörün gönderdiğiyle
 * TAM AYNI ölçüm, kırpma ve uyarı yolundan geçsin diye. İkinci bir ölçüm
 * yazmak, iki kaynağın zamanla ayrışması demekti.
 */
async function generateFootage(state: RunState, dir: string): Promise<AgentResult> {
  const payload = realVideoPayload(state);

  // `visual.ts:55` ile aynı kapı: HTTP sağlayıcı yoksa iş Higgsfield MCP işi,
  // sessizce başarısız olmak yerine operatöre devret.
  if (!hasGenerationProvider()) {
    throw new OperatorRequiredError(buildGenerationOperatorInstructions(state));
  }

  const { getGenerationProvider } = await import("../../providers/generation");
  const { downloadTo } = await import("../../providers/download");
  const provider = await getGenerationProvider();
  const aspect = aspectSpec(runAspect(state));

  const submitted: SubmittedClip[] = [];
  const failures: string[] = [];
  let generatedSec = 0;

  for (const scene of payload.scenes) {
    // `shotIdea`ya stil sözleşmesi zaten eklenmiş durumda (planner.ts) — üretim
    // prompt'u olarak da doğru şey o: tüm sahnelerin tek görsel dilde kalmasını
    // sağlayan cümle.
    const prompt = scene.shotIdea;
    try {
      // t2i → i2v: bkz. generateClip.ts başlığı — image_url'siz i2v çağrısı
      // (eski hâli) model tarafında hata veriyordu.
      const { videoUrl } = await generateClip(provider, {
        prompt,
        durationSec: scene.durationSec,
        aspect,
      });
      const file = `${scene.id}.mp4`;
      await downloadTo(videoUrl, path.join(dir, file));
      submitted.push({ sceneId: scene.id, file });
      generatedSec += scene.durationSec;
    } catch (err) {
      // Tek sahne patlarsa run'ı düşürmüyoruz: kalanlar üretilsin, eksik
      // sahneler uyarıya dönüşsün ve operatör yalnızca onları tamamlasın.
      failures.push(`${scene.id}: ${(err as Error).message}`);
    }
  }

  if (submitted.length === 0) {
    throw new Error(
      `Hiçbir sahne üretilemedi (${provider.name}).\n` + failures.join("\n"),
    );
  }

  const measured = await measureSubmittedClips(state, submitted);
  const warnings = [...measured.warnings, ...failures];

  return {
    patch: {
      payload: { ...payload, footage: measured.footage },
      assets: {
        ...state.assets,
        footage: { ...(state.assets.footage ?? {}), ...measured.files },
      },
    },
    note:
      `${measured.footage.length}/${payload.scenes.length} sahne ${provider.name} ile ` +
      `üretildi (~${generatedSec.toFixed(1)}sn), ffprobe ile ölçüldü.` +
      (warnings.length > 0 ? `\nUYARILAR:\n  - ${warnings.join("\n  - ")}` : ""),
    cost: {
      vendor: provider.name === "higgsfield" ? "higgsfield" : "fal",
      detail: `${submitted.length} klip video üretimi (~${generatedSec.toFixed(1)}sn)`,
      costUsd: generatedSec * PRICES.falVideoPerSec,
    },
  };
}

export interface SubmittedClip {
  sceneId: string;
  file: string;
  inSec?: number;
  outSec?: number;
}

/**
 * `submit-footage` route'unun çağırdığı ölçüm adımı. Route'un içinde değil
 * burada duruyor çünkü ffprobe ve yol kuralları modun bilgisi — route yalnızca
 * taşıyıcı olmalı.
 *
 * real-video'ya özel ince sarmalayıcı — asıl ölçüm `measureClipsIn`'de,
 * çünkü ai-video'nun 'sahne' aşaması AYNI ölçümü kullanıyor
 * (`lib/modes/ai-video/sahne.ts`). İkinci bir ölçüm yazmak iki kaynağın
 * zamanla ayrışması demekti.
 */
export async function measureSubmittedClips(
  state: RunState,
  clips: SubmittedClip[],
): Promise<{ footage: FootageClip[]; files: Record<string, string>; warnings: string[] }> {
  const payload = realVideoPayload(state);
  return measureClipsIn(footageDir(state), payload.scenes, clips);
}

/**
 * ffprobe ile ölçüm — moddan bağımsız. `scenes`, klip için beklenen süreyi
 * (fallback) ve geçerli sahne id kümesini vermek için yeterli minimal şekil.
 */
export async function measureClipsIn(
  dir: string,
  scenes: { id: string; durationSec: number }[],
  clips: SubmittedClip[],
): Promise<{ footage: FootageClip[]; files: Record<string, string>; warnings: string[] }> {
  const validIds = new Set(scenes.map((s) => s.id));

  const footage: FootageClip[] = [];
  const files: Record<string, string> = {};
  const warnings: string[] = [];

  for (const clip of clips) {
    if (!validIds.has(clip.sceneId)) {
      warnings.push(`Bilinmeyen sahne '${clip.sceneId}' atlandı.`);
      continue;
    }

    // Yalnızca dosya adı kabul ediliyor: operatörün gönderdiği bir yol run
    // klasörünün dışına çıkamamalı.
    const base = path.basename(clip.file);
    const abs = path.join(dir, base);

    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat?.isFile()) {
      warnings.push(`Dosya bulunamadı, atlandı: ${base} (beklenen konum: ${dir})`);
      continue;
    }

    const p = await probe(abs);

    const scene = scenes.find((s) => s.id === clip.sceneId);
    const inSec = Math.max(0, clip.inSec ?? 0);
    const wanted = clip.outSec ?? inSec + (scene?.durationSec ?? p.durationSec);
    // Kaynağın sonunu aşan bir çıkış noktası siyah kare üretir — kırpıyoruz.
    const outSec = Math.min(wanted, p.durationSec);

    if (wanted > p.durationSec + 0.01) {
      warnings.push(
        `${base}: istenen çıkış ${wanted.toFixed(2)}sn ama klip ${p.durationSec.toFixed(2)}sn — kırpıldı.`,
      );
    }
    if (outSec - inSec < 0.3) {
      warnings.push(`${base}: kullanılabilir aralık 0.3sn'den kısa (${clip.sceneId}).`);
    }
    if (p.height < p.width) {
      warnings.push(
        `${base}: yatay klip (${p.width}x${p.height}) — dikey karede kırpılacak, 'focus' gerekebilir.`,
      );
    }

    footage.push({
      sceneId: clip.sceneId,
      file: toRelative(abs),
      inSec,
      outSec,
      probe: {
        durationSec: p.durationSec,
        width: p.width,
        height: p.height,
        fps: p.fps,
        hasAudio: p.hasAudio,
        rotation: p.rotation,
      },
    });
    files[clip.sceneId] = toRelative(abs);
  }

  const covered = new Set(footage.map((f) => f.sceneId));
  for (const s of scenes) {
    if (!covered.has(s.id)) warnings.push(`Sahne '${s.id}' için materyal yok.`);
  }

  return { footage, files, warnings };
}
