import React from "react";
import { Composition } from "remotion";
import { CreativeRunComposition, timelineDurationInFrames } from "./CreativeRunComposition";
import { SAMPLE_TIMELINE, type Timeline } from "./types";
import { SlideComposition } from "./carousel/SlideComposition";
import { aspectSpec } from "../lib/config/aspect";
import { RealVideoComposition } from "./real-video/RealVideoComposition";
import {
  emptyTimeline,
  timelineDurationInFrames as videoTimelineFrames,
  type VideoTimeline,
} from "./real-video/timeline";

// CreativeRun: `npx remotion render` CLI kullanımı için kayıtlı (gerçek mp4 export —
// açık madde). Dashboard önizlemesi CreativeRunComposition'ı @remotion/player ile
// doğrudan gömüyor ve bu Root'tan geçmiyor.
//
// CarouselSlide: lib/render/still.ts buradan renderStill ile TEK KARE PNG basıyor —
// carousel dizgi aşamasının çıktısı bu.
//
// RealVideo: lib/render/media.ts buradan renderMedia ile mp4 basıyor. Boyut, fps ve
// süre tamamen inputProps'taki çizelgeden geliyor — aşağıdaki varsayılanlar yalnızca
// Remotion Studio'da boş kompozisyonun açılabilmesi için.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CreativeRun"
        component={CreativeRunComposition}
        fps={SAMPLE_TIMELINE.fps}
        width={1080}
        height={1920}
        durationInFrames={timelineDurationInFrames(SAMPLE_TIMELINE)}
        defaultProps={{ timeline: SAMPLE_TIMELINE }}
        calculateMetadata={async ({ props }) => {
          const timeline = props.timeline as Timeline;
          return {
            durationInFrames: timelineDurationInFrames(timeline),
            fps: timeline.fps,
          };
        }}
      />

      <Composition
        id="CarouselSlide"
        component={SlideComposition}
        fps={30}
        durationInFrames={1}
        width={aspectSpec("4:5").still.width}
        height={aspectSpec("4:5").still.height}
        defaultProps={{
          headline: "Örnek başlık",
          body: "",
          role: "hook" as const,
          index: 0,
          total: 1,
          imageDataUri: null,
          accent: "#1f2937",
          width: aspectSpec("4:5").still.width,
          height: aspectSpec("4:5").still.height,
        }}
        // Kare boyutu kanala göre değişiyor (4:5 vs 9:16); yukarıdaki width/height
        // yalnızca varsayılan. Gerçek boyut her render'da inputProps'tan geliyor.
        calculateMetadata={async ({ props }) => ({
          width: (props as { width: number }).width,
          height: (props as { height: number }).height,
        })}
      />

      <Composition
        id="RealVideo"
        component={RealVideoComposition}
        fps={30}
        width={aspectSpec("9:16").video.width}
        height={aspectSpec("9:16").video.height}
        durationInFrames={videoTimelineFrames(
          emptyTimeline(aspectSpec("9:16").video.width, aspectSpec("9:16").video.height),
        )}
        defaultProps={{
          timeline: emptyTimeline(aspectSpec("9:16").video.width, aspectSpec("9:16").video.height),
        }}
        // Süre, fps ve kare boyutu ÇİZELGEDEN türetiliyor: kaynak footage'ın
        // uzunluğu ve kanalın oranı run'a göre değişiyor, sabitlenemez.
        calculateMetadata={async ({ props }) => {
          const timeline = (props as { timeline: VideoTimeline }).timeline;
          return {
            width: timeline.width,
            height: timeline.height,
            fps: timeline.fps,
            durationInFrames: videoTimelineFrames(timeline),
          };
        }}
      />
    </>
  );
};
