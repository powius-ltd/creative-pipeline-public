import { NextResponse } from "next/server";
import { recordMetrics } from "@/lib/orchestrator/metrics";
import type { PerformanceKanal } from "@/lib/orchestrator/types";

const KANALLAR: PerformanceKanal[] = ["organik", "ucretli", "site"];

/**
 * Performans girişi. Organik metrikler 48 saat sonra elle doldurulur (bkz.
 * powius-pazarlama/olcum/utm-standardi.md), ücretli metrikler ads-analyst'ten gelir.
 * Body: { projectSlug, kanal, platform?, metrics: {...}, notes? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const body = await request.json().catch(() => ({}));
  const projectSlug = body.projectSlug as string | undefined;
  const kanal = body.kanal as PerformanceKanal | undefined;
  const platform = body.platform as string | undefined;
  const metrics = body.metrics as Record<string, number> | undefined;
  const notes = body.notes as string | undefined;

  if (!projectSlug || !metrics || typeof metrics !== "object") {
    return NextResponse.json(
      { error: "projectSlug ve metrics (obje) gerekli." },
      { status: 400 },
    );
  }
  // Varsayılan kanal YOK: eksik bırakılırsa kayıt reddedilir. "organik" varsaymak,
  // ads-analyst'in ücretli kayıtlarını sessizce organik diye etiketlerdi.
  if (!kanal || !KANALLAR.includes(kanal)) {
    return NextResponse.json(
      { error: `kanal gerekli ve şunlardan biri olmalı: ${KANALLAR.join(" | ")}` },
      { status: 400 },
    );
  }

  try {
    const entry = await recordMetrics(projectSlug, runId, {
      kanal,
      platform,
      metrics,
      notes,
    });
    return NextResponse.json({ entry });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
