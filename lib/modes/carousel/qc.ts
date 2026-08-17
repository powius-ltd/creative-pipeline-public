import path from "node:path";
import { runClaude } from "../../agents/claude-cli";
import { isMock } from "../../config/mock";
import { runAssetsDir } from "../../orchestrator/paths";
import type { AgentResult, RunState } from "../../orchestrator/types";
import { carouselPayload } from "../../orchestrator/types";

interface LensScore {
  puan: 1 | 2 | 3 | 4 | 5;
  not: string;
}

interface QcVerdict {
  verdict: "approved" | "rejected";
  notes: string;
  flaggedSlides: string[];
  dikkat: LensScore;
  duygu: LensScore;
  marka: LensScore;
}

const LENS_SCHEMA = {
  type: "object",
  properties: {
    puan: { type: "integer", enum: [1, 2, 3, 4, 5] },
    not: { type: "string", description: "Kısa, ölçüme dayalı gerekçe — sıfat değil sayım." },
  },
  required: ["puan", "not"],
  additionalProperties: false,
};

const QC_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["approved", "rejected"] },
    notes: { type: "string", description: "Kısa gerekçe" },
    flaggedSlides: {
      type: "array",
      items: { type: "string" },
      description: "Sorunlu slide id'leri (yoksa boş dizi)",
    },
    dikkat: {
      ...LENS_SCHEMA,
      description:
        "Nelson-Field/Lang/Loewenstein merceği: slide-1'de kaç ayrı uyaran var " +
        "(görsel+yazı+renk kontrastı — 2'den fazla dikkat dağıtır)? Merak boşluğu " +
        "spesifik mi belirsiz mi?",
    },
    duygu: {
      ...LENS_SCHEMA,
      description:
        "Wood/Binet&Field merceği: sağ-beyin özellik sayımı — yüz, hikaye, mizah, " +
        "mekân var mı? Duygu gösteriliyor mu, yoksa sadece söyleniyor mu?",
    },
    marka: {
      ...LENS_SCHEMA,
      description:
        "Sharp/Burnett merceği: bu slide seti, temanın styleContract'ına ve marka " +
        "sesine (varsa anayasa ses tonu) sadık mı — yoksa kopuk mu duruyor?",
    },
  },
  required: ["verdict", "notes", "flaggedSlides", "dikkat", "duygu", "marka"],
  additionalProperties: false,
};

export async function runCarouselQc(state: RunState): Promise<AgentResult> {
  const payload = carouselPayload(state);
  const slideAssets = state.assets.slideAssets ?? {};

  if (isMock("qc")) {
    const missing = payload.slides.filter((s) => !slideAssets[s.id]?.finalPath);
    const verdict = missing.length === 0 ? "approved" : "rejected";
    const mockLens = (not: string) => ({ puan: 3 as const, not: `[MOCK] ${not}` });
    return {
      patch: {
        qc: {
          verdict,
          notes:
            verdict === "approved"
              ? "[MOCK] Tüm slide'ların nihai görseli mevcut (gerçek görsel incelemesi değil)."
              : `[MOCK] Nihai görseli eksik slide'lar: ${missing.map((s) => s.id).join(", ")}`,
          flaggedScenes: missing.map((s) => s.id),
          mercekler: {
            dikkat: mockLens("gerçek incelemede claude CLI puanlar"),
            duygu: mockLens("gerçek incelemede claude CLI puanlar"),
            marka: mockLens("gerçek incelemede claude CLI puanlar"),
          },
        },
      },
      note: `[MOCK] Carousel QC: ${verdict}.`,
    };
  }

  const assetsRoot = path.resolve(runAssetsDir(state.projectSlug, state.runId));
  const slideLines = payload.slides
    .map((s) => {
      const rel = slideAssets[s.id]?.finalPath;
      const abs = rel ? path.resolve(process.cwd(), rel) : "(görsel yok)";
      return (
        `  ${s.id} · rol=${s.role} · textMode=${s.textMode}\n` +
        `      dosya: ${abs}\n` +
        `      olması gereken başlık: "${s.headline}"` +
        (s.body ? `\n      olması gereken alt metin: "${s.body}"` : "")
      );
    })
    .join("\n");

  const prompt = [
    "Bir carousel postunun FİNAL KALİTE KONTROLÜNÜ yapıyorsun.",
    "Aşağıdaki PNG dosyalarını Read aracıyla TEK TEK AÇIP GERÇEKTEN İNCELE.",
    "Dosyaları okumadan hüküm verme.",
    "",
    `Konu: ${state.topic}`,
    payload.theme ? `Hedeflenen görsel tema: ${payload.theme.styleContract}` : "",
    "",
    "Slide'lar:",
    slideLines,
    "",
    "Şunları kontrol et:",
    "  1. YAZIM — özellikle textMode=baked slide'larda yazı görselin içine model",
    "     tarafından çizildi; bozuk harf, uydurma kelime veya yazım hatası olabilir.",
    "     Görseldeki yazı, yukarıda verilen 'olması gereken' metinle eşleşiyor mu?",
    "  2. TUTARLILIK — slide'lar tek bir seri gibi mi duruyor, yoksa biri stil olarak",
    "     kopuyor mu (renk, ışık, doku)?",
    "  3. OKUNAKLILIK — metin arka planın üstünde okunuyor mu?",
    "  4. Konu ve tema ile uyum.",
    "",
    "Ayrıca üç mercekten SAYIM YAP (sıfat değil, ölçüm — 'güzel/etkileyici' gibi yargı",
    "yazma, ne saydığını yaz):",
    "  - dikkat: slide-1'de kaç ayrı uyaran var (görsel+yazı+kontrast)? Merak boşluğu",
    "    spesifik mi belirsiz mi?",
    "  - duygu: sağ-beyin özellik sayımı — yüz/hikaye/mizah/mekân var mı?",
    "  - marka: styleContract'a ve slide'lar arası tutarlılığa sadık mı?",
    "Her mercek için 1-5 puan ver.",
    "",
    "Ciddi bir sorun varsa 'rejected' ver ve sorunlu slide id'lerini işaretle.",
  ]
    .filter(Boolean)
    .join("\n");

  const { data, cost } = await runClaude<QcVerdict>(
    {
      prompt,
      schema: QC_SCHEMA,
      model: "sonnet",
      allowedTools: ["Read"],
      addDirs: [assetsRoot],
      maxBudgetUsd: 2,
      timeoutMs: 300_000,
    },
    "carousel QC",
  );

  return {
    patch: {
      qc: {
        verdict: data.verdict,
        notes: data.notes,
        flaggedScenes: data.flaggedSlides,
        mercekler: { dikkat: data.dikkat, duygu: data.duygu, marka: data.marka },
      },
    },
    note:
      `Carousel QC (görsel inceleme): ${data.verdict}. ` +
      `Mercekler — dikkat:${data.dikkat.puan} duygu:${data.duygu.puan} marka:${data.marka.puan}.`,
    cost,
  };
}
