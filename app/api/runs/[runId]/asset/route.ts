import fs from "node:fs/promises";
import path from "node:path";
import { runDir } from "@/lib/orchestrator/paths";

/**
 * projects/ klasörü public/ dışında olduğu için tarayıcı üretilen hiçbir asset'i
 * doğrudan göremiyor. Bu route onları servis eder.
 *
 * GET /api/runs/<runId>/asset?project=<slug>&path=<run klasörüne göre veya cwd'ye göre yol>
 */

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const { searchParams } = new URL(request.url);
  const project = searchParams.get("project");
  const rel = searchParams.get("path");

  if (!project || !rel) {
    return Response.json(
      { error: "project ve path query parametreleri gerekli." },
      { status: 400 },
    );
  }

  const ext = path.extname(rel).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return Response.json({ error: `İzin verilmeyen dosya tipi: ${ext}` }, { status: 400 });
  }

  // Path traversal koruması: istenen yol NE OLURSA OLSUN çözümlendikten sonra bu
  // run'ın klasörünün altında kalmak zorunda. state.json'daki yollar cwd'ye göre
  // saklandığı için önce cwd'ye göre çözüyoruz, sonra sınırı doğruluyoruz.
  const runRoot = path.resolve(runDir(project, runId));
  const resolved = path.resolve(process.cwd(), rel);
  const withinRun = resolved === runRoot || resolved.startsWith(runRoot + path.sep);

  if (!withinRun) {
    return Response.json(
      { error: "Yol bu run'ın klasörünün dışında." },
      { status: 400 },
    );
  }

  let file: Buffer;
  try {
    file = await fs.readFile(resolved);
  } catch {
    return Response.json({ error: "Dosya bulunamadı." }, { status: 404 });
  }

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
