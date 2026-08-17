import React from "react";
import {
  AbsoluteFill,
  Freeze,
  Img,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ClipItem } from "./timeline";
import { kenBurnsTransform, transitionInStyle } from "./transitions";

/**
 * TEK KLİP — gerçek medyayı çizen bileşen.
 *
 * `remotion/Scene.tsx` bunu hiç yapmıyor: orada `hashColor(scene.id)` ile
 * id'den türetilmiş bir arka plan rengi basılıyor ve görsel varsa yalnızca
 * "[MOCK GÖRSEL]" yazısı yazılıyor — ne `<Img>` ne `<OffthreadVideo>`. Donmuş
 * mod bozulmasın diye o dosyaya dokunmuyoruz; gerçek çizim burada.
 *
 * Kırpma prop adları KURULU SÜRÜMDEN doğrulandı (remotion 4.0.498):
 * `trimBefore`/`trimAfter` güncel, `startFrom`/`endAt` `@deprecated`.
 */
export function Clip({ clip }: { clip: ClipItem }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Sequence içindeyiz: frame 0 = klibin kendi başlangıcı.
  const localSec = frame / fps;
  const clipProgress = clip.durationSec > 0 ? localSec / clip.durationSec : 0;

  // Giriş geçişi yalnızca klibin ilk transitionIn.durationSec'inde etkili.
  const tIn = clip.transitionIn;
  const transitionStyle =
    tIn && tIn.kind !== "cut" && tIn.durationSec > 0 && localSec < tIn.durationSec
      ? transitionInStyle(tIn.kind, localSec / tIn.durationSec)
      : {};

  const { media, motion, fit, focus } = clip;

  // 16:9 kaynağı 9:16'ya yeniden çerçeveleme: objectPosition bedavaya çözüyor.
  const objectPosition = focus
    ? `${(focus.x * 100).toFixed(1)}% ${(focus.y * 100).toFixed(1)}%`
    : "center center";

  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: fit,
    objectPosition,
  };

  /**
   * KAYNAK SAHNEDEN KISAYSA SON KAREYİ DONDUR.
   *
   * `kurgu.ts` bu durumu görüp "son kare donacak" diye UYARIYOR ama donmayı
   * kimse uygulamıyordu: `OffthreadVideo` malzemesi bitince hiçbir şey çizmiyor
   * ve altındaki siyah zemin görünüyor. Canlı testte 21 saniyelik videonun ~8
   * saniyesi böyle simsiyah çıktı — üstelik altyazı akmaya devam ettiği için
   * "bozuk" değil "kasıtlı" görünüyordu, en kötü hata biçimi.
   *
   * `Freeze` frame'i DİNAMİK veriyoruz (min ile), sabit değil: böylece bileşen
   * yeniden bağlanmıyor, malzeme varken normal oynuyor, bitince son kareye
   * kilitleniyor. Koşullu olarak iki ayrı ağaç render etmek geçiş anında
   * OffthreadVideo'yu yeniden yükletir ve gözle görülür bir sıçrama yaratırdı.
   */
  const availableSec = Math.max(0, media.outSec - media.inSec);
  const lastFrame = Math.max(0, Math.round(availableSec * fps) - 1);
  const needsFreeze = media.kind === "video" && clip.durationSec > availableSec + 0.05;

  return (
    // Dış katman geçişi taşıyor, iç katman kamera hareketini — ikisini ayırmak
    // şart, yoksa transform'lar birbirini eziyor.
    <AbsoluteFill style={{ ...transitionStyle, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: kenBurnsTransform(motion, clipProgress) }}>
        {media.kind === "video" ? (
          <Freeze frame={needsFreeze ? Math.min(frame, lastFrame) : frame} active={needsFreeze}>
            <OffthreadVideo
              src={media.src}
              trimBefore={Math.max(0, Math.round(media.inSec * fps))}
              trimAfter={Math.max(1, Math.round(media.outSec * fps))}
              // Ses Remotion'da SUSTURULUYOR: nihai karışım ffmpeg'de
              // (sidechaincompress ducking + loudnorm). Yine de gain'i taşıyoruz
              // ki dashboard önizlemesi doğru duyulsun.
              muted={!media.useSourceAudio}
              volume={media.useSourceAudio ? media.sourceGain : 0}
              style={mediaStyle}
            />
          </Freeze>
        ) : (
          <Img src={media.src} style={mediaStyle} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
