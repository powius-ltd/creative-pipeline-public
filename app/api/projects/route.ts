import { NextResponse } from "next/server";
import { createProjectFromTemplate, listProjects } from "@/lib/orchestrator/runStore";
import { DEFAULT_MODE, isSelectableMode } from "@/lib/modes/descriptors";
import { DEFAULT_LANGUAGE, isLanguage } from "@/lib/config/language";
import type { Platform } from "@/lib/orchestrator/types";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = await request.json();
  const name = (body.name ?? "").trim();
  const platform = (body.platform ?? "other") as Platform;
  const defaultMode = body.defaultMode ?? DEFAULT_MODE;
  const defaultAuto = Boolean(body.defaultAuto);

  if (!name) {
    return NextResponse.json({ error: "İsim gerekli." }, { status: 400 });
  }
  if (!isSelectableMode(defaultMode)) {
    return NextResponse.json(
      { error: `Geçersiz veya dondurulmuş mod: ${defaultMode}` },
      { status: 400 },
    );
  }
  // Bilinmeyen bir dil kodunu sessizce Türkçe'ye düşürmek, yurt dışı bir markaya
  // yanlış dilde copy üretmek demekti — açıkça reddediyoruz.
  if (body.language !== undefined && !isLanguage(body.language)) {
    return NextResponse.json(
      { error: `Desteklenmeyen dil: ${body.language}` },
      { status: 400 },
    );
  }

  try {
    const project = await createProjectFromTemplate({
      name,
      platform,
      defaultMode,
      defaultAuto,
      language: body.language ?? DEFAULT_LANGUAGE,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
