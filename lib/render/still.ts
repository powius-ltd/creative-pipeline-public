import { getServeUrl } from "./bundle";

/**
 * Bundle kurulumu ve tembel-import gerekçesi `./bundle.ts`'e taşındı — artık iki
 * tüketicisi var (bu dosya ve `./media.ts`), bundle ise süreç başına tek olmalı.
 * Buradaki `@remotion/renderer` importu aynı sebeple tembel kalıyor.
 */
export async function renderSlideStill(
  inputProps: Record<string, unknown>,
  outputPath: string,
): Promise<string> {
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await getServeUrl();

  const composition = await selectComposition({
    serveUrl,
    id: "CarouselSlide",
    inputProps,
  });

  await renderStill({
    composition,
    serveUrl,
    output: outputPath,
    inputProps,
    imageFormat: "png",
  });

  return outputPath;
}
