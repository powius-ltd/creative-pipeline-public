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
import { aiVideoPayload } from "../../orchestrator/types";

/**
 * FİNAL QC (ai-video) — real-video'nun üç katmanlı QC'siyle AYNI iskelet
 * (ffmpeg ölçüm + Gemini temporal tarama + Claude yargısı), TEK farkla:
 * merceklerden biri "marka sesi" değil "KARAKTER TUTARLILIĞI" soruyor —
 * bu modda asıl kırılma noktası ortam vahşice değişirken yüzün/kimliğin
 * aynı kalıp kalmadığı. Gemini videoyu görüyor, o yüzden bu soruyu
 * yanıtlayabilecek tek katman o.
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
      properties: { puan: { type: "integer", enum: [1, 2, 3, 4, 5] }, not: { type: "string" } },
      required: ["puan", "not"],
      additionalProperties: false,
      description:
        "İlk 3 saniye: ilk kesme kaçıncı saniyede, açılışta kaç ayrı uyaran var, " +
        "hook metni spesifik mi belirsiz mi? Sıfat değil SAYIM.",
    },
    duygu: {
      type: "object",
      properties: { puan: { type: "integer", enum: [1, 2, 3, 4, 5] }, not: { type: "string" } },
      required: ["puan", "not"],
      additionalProperties: false,
      description:
        "Absürtlük iş görüyor mu: ortam sıçramaları GERÇEKTEN çarpıcı mı yoksa " +
        "belirsiz/silik mi? Şaşırtma anı var mı yoksa akış düz mü hissediliyor?",
    },
    marka: {
      type: "object",
      properties: { puan: { type: "integer", enum: [1, 2, 3, 4, 5] }, not: { type: "string" } },
      required: ["puan", "not"],
      additionalProperties: false,
      description:
        "KARAKTER TUTARLILIĞI: Gemini'nin gördüğü kişi sahneler arasında AYNI kişi mi " +
        "kalıyor (yüz, saç, giysi) yoksa sahneden sahneye belirgin şekilde değişiyor mu? " +
        "Bu modda 'marka sesine uygunluk' değil bu soru ölçülüyor.",
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

export async function runAiVideoQc(state: RunState): Promise<AgentResult> {
  const payload = aiVideoPayload(state);

  if (isMock("qc")) {
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

  const cuts = await detectScenes(abs);

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

  const timeline = state.assets.timelineV2
    ? (JSON.parse(
        await fsp.readFile(path.resolve(process.cwd(), state.assets.timelineV2), "utf8"),
      ) as VideoTimeline)
    : null;

  const intended = payload.scenes
    .map(
      (s) =>
        `  ${s.id} [${s.role}] ortam: ${s.environment}${s.environmentJump ? " (SIÇRAMA)" : ""} niyet: ${s.intent}\n` +
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

  const characterSection = payload.character
    ? `\nKARAKTER TARİFİ (referans — Gemini'nin gördüğü kişi buna uymalı):\n  ${payload.character.description}\n`
    : "";

  const prompt = [
    "Üretilmiş bir dikey kısa videonun FİNAL QC'sini yapıyorsun. Bu video TAMAMEN AI",
    "ÜRETİMİ ve BİLİNÇLİ OLARAK ABSÜRT: aynı karakter, ortam sahneden sahneye vahşice",
    "değişiyor (ay, okyanus dibi vb). Bu NORMAL ve İSTENEN — ortam sıçramasını hata",
    "sayma. Değerlendireceğin şey ortam DEĞİL karakterin tutarlılığı ve absürtlüğün",
    "gerçekten çarpıcı mı yoksa silik mi olduğu.",
    "Videoyu sen izlemiyorsun — aşağıda iki bağımsız ÖLÇÜM var. Yargını bunlara daya.",
    "",
    `Konu: ${state.topic}`,
    characterSection,
    "NİYET (üretim öncesi plan):",
    intended,
    payload.theme?.styleContract ? `\nSTİL SÖZLEŞMESİ:\n${payload.theme.styleContract}` : "",
    "",
    "ÖLÇÜM 1 — Gemini (videoyu izledi):",
    `  ${measured}`,
    "",
    "ÖLÇÜM 2 — ffmpeg sahne tespiti (deterministik):",
    `  ${cuts.length} kesme noktası: ${cuts.map((c) => c.sec.toFixed(2)).join(", ") || "yok"}`,
    timeline
      ? `\nÇİZELGE (ne yapmayı amaçladık):\n  ${timeline.video[0]?.items.length ?? 0} klip, ` +
        `${timeline.overlays[0]?.items.length ?? 0} overlay, ${timeline.durationSec.toFixed(1)}sn, ` +
        `planlanan ortam sıçraması: ${payload.scenes.filter((s) => s.environmentJump).length}`
      : "",
    timeline?.watermark
      ? `\nNOT: videoda sabit bir watermark var: "${timeline.watermark.text}" (${timeline.watermark.position}). ` +
        "Bu kasıtlı — ölçümde görürsen içerik sorunu SAYMA."
      : "",
    "",
    "DEĞERLENDİR:",
    "- İki ölçüm birbiriyle çelişiyorsa bunu not et (Gemini uydurmuş olabilir).",
    "- Ölçülen plan sayısı ve kesme noktaları, planlanan ortam sıçramalarıyla tutarlı mı?",
    "  (Her sıçrama sahnesi bir kesmeye denk gelmeli — kurgu bunları 'cut' yapıyor.)",
    "- Gemini'nin gördüğü kişi sahneler arasında AYNI mı kalıyor (KARAKTER TUTARLILIĞI",
    "  — bu modda en kritik ölçüt)?",
    "- Hook ilk 3 saniyede iş görüyor mu?",
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
      `QC ${data.verdict} — dikkat ${data.dikkat.puan}/5, absürtlük ${data.duygu.puan}/5, ` +
      `karakter tutarlılığı ${data.marka.puan}/5. Gemini ${measurement.shots.length} plan ölçtü, ` +
      `ffmpeg ${cuts.length} kesme buldu.`,
    cost: combined,
  };
}
