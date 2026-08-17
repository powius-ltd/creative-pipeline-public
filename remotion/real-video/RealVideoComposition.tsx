import React from "react";
import { AbsoluteFill, Audio, Img, Sequence } from "remotion";
import { Captions } from "./Captions";
import { Clip } from "./Clip";
import { Title } from "./Title";
import { Watermark } from "./Watermark";
import type { AudioItem, OverlayItem, VideoTimeline } from "./timeline";

/**
 * ÇOK KANALLI KOMPOZİSYON.
 *
 * Kanal sırası (alttan üste) = DOM sırası:
 *   video[0] ana kurgu → video[1..] b-roll/PIP → overlays[*] yazı → ses
 *
 * Her öğe MUTLAK zamanda bir `<Sequence from>` içine giriyor. `TransitionSeries`
 * kullanmamamızın sebebi `transitions.ts`'te yazılı: o bileşen geçiş karelerini
 * tüketiyor ve çok kanallı modelde overlay'in zamanı video kanalıyla kayardı.
 *
 * Geçiş bindirmesi burada ZAMANLA ifade ediliyor: iki klibin aralıkları
 * çakışıyorsa, üstteki klip kendi `transitionIn` animasyonuyla açılırken alttaki
 * hâlâ çiziliyor — crossfade kendiliğinden oluşuyor.
 */

function secToFrames(sec: number, fps: number): number {
  return Math.round(sec * fps);
}

function OverlayRenderer({
  item,
  language,
}: {
  item: OverlayItem;
  language: VideoTimeline["language"];
}) {
  switch (item.kind) {
    case "caption":
      return <Captions item={item} language={language} />;
    case "title":
      return <Title item={item} language={language} />;
    case "sticker":
      return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <Img
            src={item.src}
            style={{
              position: "absolute",
              left: `${item.position.x * 100}%`,
              top: `${item.position.y * 100}%`,
              transform: `translate(-50%, -50%) scale(${item.scale})`,
            }}
          />
        </AbsoluteFill>
      );
  }
}

/**
 * Ses YALNIZCA ÖNİZLEME için çiziliyor.
 *
 * `renderMedia` bu kompozisyonu `muteAudio: true` ile basıyor; nihai karışım
 * (ducking, loudnorm, limiter) ffmpeg'de yapılıyor — tek karışım yetkisi olsun
 * diye. Bu bileşen dashboard'daki `<Player>`ın duyulabilmesi için var.
 */
function AudioTrack({ item, fps }: { item: AudioItem; fps: number }) {
  return (
    <Sequence from={secToFrames(item.startSec, fps)} name={`ses:${item.role}:${item.id}`}>
      <Audio
        src={item.src}
        volume={item.gain}
        trimBefore={secToFrames(item.inSec, fps)}
        trimAfter={Math.max(1, secToFrames(item.outSec, fps))}
      />
    </Sequence>
  );
}

export function RealVideoComposition({ timeline }: { timeline: VideoTimeline }) {
  const { fps, video, overlays, audio, language } = timeline;

  const hasAnyClip = video.some((t) => t.items.length > 0);
  if (!hasAnyClip) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#0b0b0f",
          color: "white",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          fontSize: 28,
        }}
      >
        Henüz klip yok.
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {video.map((track) => (
        <React.Fragment key={track.id}>
          {track.items.map((clip) => (
            <Sequence
              key={clip.id}
              from={secToFrames(clip.startSec, fps)}
              durationInFrames={Math.max(1, secToFrames(clip.durationSec, fps))}
              name={`klip:${clip.id}`}
            >
              <Clip clip={clip} />
            </Sequence>
          ))}
        </React.Fragment>
      ))}

      {overlays.map((track) => (
        <React.Fragment key={track.id}>
          {track.items.map((item) => (
            <Sequence
              key={item.id}
              from={secToFrames(item.startSec, fps)}
              durationInFrames={Math.max(1, secToFrames(item.durationSec, fps))}
              name={`overlay:${item.kind}:${item.id}`}
            >
              <OverlayRenderer item={item} language={language} />
            </Sequence>
          ))}
        </React.Fragment>
      ))}

      {audio.map((track) => (
        <React.Fragment key={track.id}>
          {track.items.map((item) => (
            <AudioTrack key={item.id} item={item} fps={fps} />
          ))}
        </React.Fragment>
      ))}

      {/* Overlay track'lerinden SONRA, koşulsuz — `<Sequence>` içinde DEĞİL.
          Süre tuzağı ve gerekçesi: WatermarkSpec'in üstündeki not (timeline.ts). */}
      {timeline.watermark ? <Watermark spec={timeline.watermark} /> : null}
    </AbsoluteFill>
  );
}
