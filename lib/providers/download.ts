import fs from "node:fs/promises";
import path from "node:path";

/**
 * Üretim modelleri barındırılan URL döner; hattın geri kalanı yerel dosya ister
 * (Remotion dizgisi görseli okur, QC PNG'leri okur, tarayıcı asset route'undan
 * servis alır). Bu adım daha önce açık maddeydi — carousel modu zorunlu kıldı.
 */
export async function downloadTo(url: string, destPath: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Asset indirilemedi (${res.status} ${res.statusText}): ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buffer);
  return destPath;
}

/** state.json'da mutlak yol tutmuyoruz — proje taşınabilir kalsın. */
export function toRelative(absPath: string): string {
  return path.relative(process.cwd(), absPath).split(path.sep).join("/");
}
