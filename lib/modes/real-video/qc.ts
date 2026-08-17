import fsp from "node:fs/promises";
import path from "node:path";
import type { VideoTimeline } from "../../../remotion/real-video/timeline";
import {
  MEASUREMENT_SHAPE_TEXT,
  MEASUREMENT_SYSTEM_PROMPT,
  MEASUREMENT_USER_PROMPT,
  validateMeasurement,
  type VideoMeasurement,
} from "../../analysis/geminiVideo";
import { runClaude } from "../../agents/claude-cli";
import { runGemini } from "../../agents/gemini-cli";
import { isMock } from "../../config/mock";
import { detectScenes, makeProxy } from "../../media/ffmpeg";
import { runAssetsDir } from "../../orchestrator/paths";
import type { AgentResult, QcResult, RunState } from "../../orchestrator/types";
import { realVideoPayload } from "../../orchestrator/types";

/**
 * FİNAL QC — üç analiz katmanının buluştuğu yer.
 *
 *   1. ffmpeg  → ölçülebilir olan (sahne sınırları). Bedava, deterministik.
 *   2. Gemini  → temporal tarama (ne zaman ne oluyor). Abonelik, native video.
 *   3. Claude  → yargı (marka sesi, yasaklar, hook gücü). Bağlam zaten burada.
 *
 * Sıralama bilinçli: ölçülebilene model parası ödenmiyor, Gemini'ye "neyi
 * gördün" soruluyor, Claude'a "bu iyi mi" soruluyor. Claude'a ham video
 * verilmiyor — Gemini'nin ölçümü + ffmpeg'in sahne sınırları veriliyor, o da
 * bunları `brief.yasaklar` ve `styleContract` ile karşılaştırıyor.
 *
 * Gemini adımı düşerse (auth/tier) `OperatorRequiredError` fırlar ve run
 * operatör devrine geçer — hat kırılmaz, `submit-qc` ile devam eder.
 */

const QC_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["approved", "rejected"] },
    notes: { type: "string", description: "Kısa gerekçe — ölçüme dayalı." },
    flaggedScenes: {
      type: "array",
      items: { type: "string" },
      description: "Sorunlu sahne id'leri (yoksa boş dizi).",
    },
    dikkat: {
      type: "object",
      properties: {
        puan: { type: "integer", enum: [1, 2, 3, 4, 5] },
        not: { type: "string" },
      },
      required: ["puan", "not"],
      additionalProperties: false,
      description:
        "İlk 3 saniye: ilk kesme kaçıncı saniyede, açılışta kaç ayrı uyaran var, " +
        "hook metni spesifik mi belirsiz mi? Sıfat değil SAYIM.",
    },
    duygu: {
      type: "object",
      properties: {
        puan: { type: "integer", enum: [1, 2, 3, 4, 5] },
        not: { type: "string" },
      },
      required: ["puan", "not"],
      additionalProperties: false,
      description:
        "Sağ-beyin özellik sayımı: yüz planı var mı, mekân var mı, hikaye yayı " +
        "kuruluyor mu? Duygu gösteriliyor mu yoksa yalnızca söyleniyor mu?",
    },
    marka: {
      type: "object",
      properties: {
        puan: { type: "integer", enum: [1, 2, 3, 4, 5] },
        not: { type: "string" },
      },
      required: ["puan", "not"],
      additionalProperties: false,
      description:
        "Klipler tek seri gibi mi duruyor (styleContract'a sadakat), ekran " +
        "metinleri marka sesine uygun mu, yasaklara uyulmuş mu?",
    },
  },
  required: ["verdict", "notes", "flaggedScenes", "dikkat", "duygu", "marka"],
  additionalProperties: false,
};

interface ClaudeVerdict {
  verdict: "approved" | "rejected";
  notes: string;
  flaggedScenes: string[];
  dikkat: { puan: 1 | 2 | 3 | 4 | 5; not: string };
  duygu: { puan: 1 | 2 | 3 | 4 | 5; not: string };
  marka: { puan: 1 | 2 | 3 | 4 | 5; not: string };
}

export async function runRealVideoQc(state: RunState): Promise<AgentResult> {
  const payload = realVideoPayload(state);

  if (isMock("qc")) {
    /**
     * Mock QC'de "video yok, o yüzden rejected" demek YANILTICI olurdu: render
     * mock'landıysa video zaten olmayacak ve bu bir kalite kararı değil.
     * O yüzden hattın o mock yapılandırmasında üretebileceği şeye bakıyoruz —
     * çizelge kurulduysa yapısal olarak sağlam sayıyoruz ve neyin
     * DEĞERLENDİRİLMEDİĞİNİ açıkça yazıyoruz.
     */
    const renderMocked = isMock("render") || isMock("finish");
    const hasVideo = Boolean(state.assets.finalVideo);
    const hasTimeline = Boolean(state.assets.timelineV2);
    const scenesOk = payload.scenes.length > 0 && payload.scenes.every((s) => s.voiceLine);

    const structurallyOk = hasTimeline && scenesOk;
    const qc: QcResult = {
      verdict: structurallyOk ? "approved" : "rejected",
      notes: structurallyOk
        ? `[MOCK] Yapısal kontrol geçti (${payload.scenes.length} sahne, çizelge var).` +
          (hasVideo
            ? " final.mp4 mevcut ama İZLENMEDİ — gerçek analiz için MOCK_QC=false."
            : renderMocked
              ? " Render mock'lu olduğu için görüntü değerlendirilmedi."
              : " UYARI: render mock değil ama final.mp4 yok.")
        : `[MOCK] Yapısal kontrol başarısız: ${!hasTimeline ? "çizelge yok" : "repliksiz sahne var"}.`,
      flaggedScenes: payload.scenes.filter((s) => !s.voiceLine).map((s) => s.id),
    };
    return { patch: { qc }, note: `[MOCK] QC: ${qc.verdict}. ${qc.notes}` };
  }

  const finalVideo = state.assets.finalVideo;
  if (!finalVideo) throw new Error("final.mp4 yok — 'finish' aşaması önce koşmalı.");

  const abs = path.resolve(process.cwd(), finalVideo);
  const assetsDir = runAssetsDir(state.projectSlug, state.runId);

  // ---- Katman 1: ffmpeg ölçümü (bedava) ----------------------------------
  const cuts = await detectScenes(abs);

  // ---- Katman 2: Gemini temporal tarama -----------------------------------
  // 20MB sert sınırı için proxy ŞART — kaynak neredeyse hep aşıyor.
  const proxyPath = path.join(assetsDir, "qc-proxy.mp4");
  await makeProxy(abs, proxyPath, { maxHeight: 720 });

  const { data: measurement, cost: geminiCost } = await runGemini<VideoMeasurement>(
    {
      prompt: [
        MEASUREMENT_SYSTEM_PROMPT,
        "",
        `read_file aracıyla şu videoyu oku ve analiz et: ${proxyPath}`,
        "",
        MEASUREMENT_USER_PROMPT,
        "",
        "SADECE şu şekle uyan JSON döndür:",
        MEASUREMENT_SHAPE_TEXT,
      ].join("\n"),
      validate: validateMeasurement,
      includeDir: assetsDir,
      timeoutMs: 300_000,
    },
    "video ölçümü",
  );

  // ---- Katman 3: Claude yargısı -------------------------------------------
  const timeline = state.assets.timelineV2
    ? (JSON.parse(
        await fsp.readFile(path.resolve(process.cwd(), state.assets.timelineV2), "utf8"),
      ) as VideoTimeline)
    : null;

  const intended = payload.scenes
    .map(
      (s) =>
        `  ${s.id} [${s.role}] niyet: ${s.intent}\n` +
        `      replik: "${s.voiceLine}"` +
        (s.onScreenText ? `\n      ekran metni: "${s.onScreenText}"` : ""),
    )
    .join("\n");

  const measured = [
    `süre: ${measurement.durationSec.toFixed(1)}sn`,
    `konu (Gemini'nin gördüğü): ${measurement.oneLineSubject}`,
    `plan sayısı: ${measurement.shots.length}, ortalama plan: ${measurement.pacing.avgShotSec.toFixed(2)}sn`,
    `ilk 5 saniyedeki plan sayısı: ${measurement.pacing.shotsInFirst5Sec}`,
    `ilk kesme: ${measurement.hook.firstCutAtSec.toFixed(2)}sn`,
    `ilk 1.5 saniye: ${measurement.hook.first1_5SecDescription}`,
    `açılış metni: "${measurement.hook.openingText}"`,
    `ses: seslendirme=${measurement.audio.hasVoiceover} müzik=${measurement.audio.hasMusic} ~${Math.round(measurement.audio.approxWordsPerMinute)} kelime/dk`,
    `ekran metinleri: ${measurement.onScreenText.map((t) => `"${t.text}"@${t.startSec.toFixed(1)}s(${t.position})`).join(", ") || "yok"}`,
  ].join("\n  ");

  const briefSection = state.brief
    ? [
        "",
        "KONSEPT SÖZLEŞMESİ:",
        `  içerik tipi: ${state.brief.icerikTipi} · tetikleyici: ${state.brief.tetikleyici}`,
        `  seçilen hook: "${state.brief.secilenHook}"`,
        state.brief.yasaklar.length > 0
          ? `  YASAKLAR: ${state.brief.yasaklar.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const prompt = [
    "Üretilmiş bir dikey kısa videonun FİNAL QC'sini yapıyorsun.",
    "Videoyu sen izlemiyorsun — aşağıda iki bağımsız ÖLÇÜM var. Yargını bunlara daya.",
    "",
    `Konu: ${state.topic}`,
    briefSection,
    "",
    "NİYET (üretim öncesi plan):",
    intended,
    payload.theme?.styleContract
      ? `\nSTİL SÖZLEŞMESİ:\n${payload.theme.styleContract}`
      : "",
    "",
    "ÖLÇÜM 1 — Gemini (videoyu izledi):",
    `  ${measured}`,
    "",
    "ÖLÇÜM 2 — ffmpeg sahne tespiti (deterministik):",
    `  ${cuts.length} kesme noktası: ${cuts.map((c) => c.sec.toFixed(2)).join(", ") || "yok"}`,
    timeline
      ? `\nÇİZELGE (ne yapmayı amaçladık):\n  ${timeline.video[0]?.items.length ?? 0} klip, ` +
        `${timeline.overlays[0]?.items.length ?? 0} overlay, ${timeline.durationSec.toFixed(1)}sn`
      : "",
    // Watermark kalıcı ve overlay listesinde YOK (bkz. timeline.ts'teki süre
    // tuzağı notu) — Gemini'nin ölçtüğü onScreenText'te bunu görürse "kaçak
    // metin" ya da tutarsızlık sanmasın diye açıkça bildiriyoruz.
    timeline?.watermark
      ? `\nNOT: videoda sabit bir watermark var: "${timeline.watermark.text}" (${timeline.watermark.position}). ` +
        "Bu kasıtlı bir marka ibaresi — ölçümde görürsen içerik sorunu SAYMA."
      : "",
    "",
    "DEĞERLENDİR:",
    "- İki ölçüm birbiriyle çelişiyorsa bunu not et (Gemini uydurmuş olabilir).",
    "- Ölçülen plan sayısı ve süre, amaçlanan çizelgeyle tutarlı mı?",
    "- Hook ilk 3 saniyede iş görüyor mu (ilk kesme zamanı ve açılış metnine bak)?",
    "- Yasaklara uyulmuş mu?",
    "- Puanlar SAYIMA dayansın, sıfata değil.",
  ]
    .filter(Boolean)
    .join("\n");

  const { data, cost: claudeCost } = await runClaude<ClaudeVerdict>(
    { prompt, schema: QC_SCHEMA, model: "sonnet", maxBudgetUsd: 2, timeoutMs: 300_000 },
    "final QC",
  );

  const qc: QcResult = {
    verdict: data.verdict,
    notes: data.notes,
    flaggedScenes: data.flaggedScenes,
    mercekler: { dikkat: data.dikkat, duygu: data.duygu, marka: data.marka },
  };

  // İki çağrının maliyeti tek satırda toplanıyor; Gemini tarafı $0 ama token
  // sayısı detay metninde taşınıyor.
  const combined = {
    vendor: "claude" as const,
    detail: `QC — ${geminiCost.detail} + Claude yargısı`,
    costUsd: (claudeCost.costUsd ?? 0) + (geminiCost.costUsd ?? 0),
    claudeInputTokens: claudeCost.claudeInputTokens,
    claudeOutputTokens: claudeCost.claudeOutputTokens,
  };

  return {
    patch: { qc },
    note:
      `QC ${data.verdict} — dikkat ${data.dikkat.puan}/5, duygu ${data.duygu.puan}/5, ` +
      `marka ${data.marka.puan}/5. Gemini ${measurement.shots.length} plan ölçtü, ` +
      `ffmpeg ${cuts.length} kesme buldu.`,
    cost: combined,
  };
}
