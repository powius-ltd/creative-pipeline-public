import { NextResponse } from "next/server";
import { createRun, getProject, listRuns } from "@/lib/orchestrator/runStore";
import { advanceRun } from "@/lib/orchestrator/stateMachine";
import { isAspectRatioId, type AspectRatioId } from "@/lib/config/aspect";
import {
  DEFAULT_MODE,
  MODE_DESCRIPTORS,
  isModeId,
  isSelectableMode,
} from "@/lib/modes/descriptors";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get("project");
  if (!project) {
    return NextResponse.json({ error: "project query param gerekli." }, { status: 400 });
  }
  const runs = await listRuns(project);
  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const body = await request.json();
  const projectSlug = body.projectSlug as string | undefined;
  const topic = (body.topic ?? "").trim();
  const notes = (body.notes ?? "").trim();
  const auto = Boolean(body.auto);
  const watermark: boolean | undefined =
    body.watermark === undefined ? undefined : Boolean(body.watermark);

  if (!projectSlug || !topic) {
    return NextResponse.json(
      { error: "projectSlug ve topic gerekli." },
      { status: 400 },
    );
  }

  const project = await getProject(projectSlug);
  if (!project) {
    return NextResponse.json({ error: "Proje bulunamadı." }, { status: 404 });
  }

  // Kullanıcı açıkça bir mod istediyse doğrula. Dondurulmuş bir modu sessizce
  // başka moda çevirmek yanlış olur — açıkça reddediyoruz.
  const explicit: unknown = body.mode;
  if (explicit !== undefined) {
    if (!isModeId(explicit)) {
      return NextResponse.json({ error: `Bilinmeyen mod: ${explicit}` }, { status: 400 });
    }
    // isSelectableMode bir tip koruyucusu (value is ModeId); explicit zaten ModeId'e
    // daraltıldığı için negatifi never'a düşerdi. Burada doğrudan descriptor'a bakıyoruz.
    const d = MODE_DESCRIPTORS[explicit];
    if (d.frozen) {
      return NextResponse.json(
        {
          error: `'${d.label}' modu dondurulmuş, yeni run başlatılamaz. ${d.frozenReason ?? ""}`.trim(),
        },
        { status: 400 },
      );
    }
  }

  // Projenin varsayılanı sonradan dondurulmuş olabilir; o durumda run oluşturmayı
  // engellemek yerine aktif varsayılana düşüyoruz.
  const requested = explicit ?? project.defaultMode;
  const mode = isSelectableMode(requested) ? requested : DEFAULT_MODE;

  // Bilinmeyen bir oranı sessizce varsayılana düşürmek yerine reddediyoruz —
  // dondurulmuş mod reddiyle aynı gerekçe: kullanıcının seçtiğini sandığı şey
  // sessizce başka bir şeye dönüşmesin.
  const explicitAspect: unknown = body.aspect;
  if (explicitAspect !== undefined) {
    if (!isAspectRatioId(explicitAspect)) {
      return NextResponse.json({ error: `Bilinmeyen oran: ${explicitAspect}` }, { status: 400 });
    }
    if (!MODE_DESCRIPTORS[mode].aspects.includes(explicitAspect)) {
      return NextResponse.json(
        {
          error:
            `'${MODE_DESCRIPTORS[mode].label}' modu '${explicitAspect}' oranını desteklemiyor. ` +
            `Desteklenenler: ${MODE_DESCRIPTORS[mode].aspects.join(", ")}`,
        },
        { status: 400 },
      );
    }
  }
  const aspect = explicitAspect as AspectRatioId | undefined;

  /**
   * real-video VE ai-video'da AUTO YASAK.
   *
   * `stateMachine.ts:67` auto modda kendini özyineli çağırıyor ve tüm zincir TEK
   * HTTP isteği içinde koşuyor. Her iki modda da `compose` aşaması Remotion
   * render'ı — dakikalar sürüyor — ve istek düşerse run yarıda kalır. ai-video
   * üstüne bir de `sahne` aşamasında dakikalarca video ÜRETİYOR, yani yasağı
   * hak eden ikinci (ve daha ağır) bir aşaması daha var. Kuyruk gelene kadar
   * (Aşama B'nin ilk maddesi) sessizce auto'yu kapatmak yerine AÇIKÇA
   * reddediyoruz: sessizce kapatmak kullanıcıya "auto çalıştı" yalanı söylerdi.
   */
  if (auto && (mode === "real-video" || mode === "ai-video")) {
    return NextResponse.json(
      {
        error:
          `'${MODE_DESCRIPTORS[mode].label}' modunda auto çalıştırma kapalı: render (ve ` +
          "ai-video'da ayrıca üretim) aşaması dakikalar sürüyor ve tüm zincir tek HTTP " +
          "isteğinde koşuyor (henüz iş kuyruğu yok). Run'ı auto olmadan başlatıp " +
          "aşamaları tek tek ilerlet.",
      },
      { status: 400 },
    );
  }

  let run = await createRun({
    projectSlug,
    mode,
    platform: project.platform,
    language: project.language,
    aspect,
    watermark,
    topic,
    notes,
    auto,
  });

  if (auto) {
    run.status = "running";
    run = await advanceRun(run);
  }

  return NextResponse.json({ run }, { status: 201 });
}
