import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { DISPLAY_FONT } from "../fonts";

// `interface` değil `type`: Remotion'ın Composition'ı props'un
// Record<string, unknown> ile uyumlu olmasını istiyor ve interface'lerde örtük
// index signature olmadığı için interface burada atanamaz.
export type SlideProps = {
  headline: string;
  body: string;
  role: "hook" | "body" | "cta";
  index: number;
  total: number;
  /**
   * Görsel data URI olarak geçiyor, dosya yolu olarak değil: renderStill headless
   * Chrome'da bundle'ı http:// üzerinden servis ediyor ve oradan yerel bir mutlak
   * yola erişilemiyor. staticFile() ise asset'in public/ altında olmasını isterdi —
   * ama üretilen asset'ler projects/ altında duruyor.
   */
  imageDataUri: string | null;
  /** Görsel yoksa (mock) arka planı temadan türetmek için. */
  accent: string;
  /**
   * Kare boyutu kanala göre değişiyor (Instagram 4:5, TikTok/Shorts 9:16), o yüzden
   * inputProps ile geliyor ve Root.tsx calculateMetadata ile kompozisyonu buna göre
   * boyutlandırıyor. Tipografi ölçeği de yüksekliğe oranlanıyor — aksi halde 9:16
   * karede 4:5 için ayarlanmış punto boğuk kalırdı.
   */
  width: number;
  height: number;
};

/**
 * Eskiden burada çıplak `'"Segoe UI", ...'` yazıyordu ve hiçbir yerde font
 * YÜKLENMİYORDU — headless Chromium'da Segoe UI olmadığı için carousel PNG'leri
 * sessizce yedek fontla basılıyordu. `../fonts` self-host edilmiş Montserrat'ı
 * delayRender ile ilk kareden önce yüklüyor.
 */
const FONT = DISPLAY_FONT;

function Backdrop({ imageDataUri, accent }: { imageDataUri: string | null; accent: string }) {
  if (imageDataUri) {
    return (
      <AbsoluteFill>
        <Img
          src={imageDataUri}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${accent} 0%, #0b0b0f 100%)`,
      }}
    />
  );
}

export function SlideComposition({
  headline,
  body,
  role,
  index,
  total,
  imageDataUri,
  accent,
  height,
}: SlideProps) {
  const isCentered = role === "hook" || role === "cta";
  // Tüm ölçüler 1360px yüksekliğe (Instagram 4:5) göre ayarlanmıştı; diğer
  // kanallarda orantılı büyüsün diye tek bir ölçek katsayısına bağlıyoruz.
  const k = height / 1360;
  const px = (n: number) => Math.round(n * k);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0b0f", fontFamily: FONT }}>
      <Backdrop imageDataUri={imageDataUri} accent={accent} />

      {/* Metnin her görselde okunur kalması için kontrast perdesi. */}
      <AbsoluteFill
        style={{
          background: isCentered
            ? "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.65) 100%)"
            : "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.82) 100%)",
        }}
      />

      <AbsoluteFill
        style={{
          padding: px(88),
          display: "flex",
          flexDirection: "column",
          justifyContent: isCentered ? "center" : "flex-end",
          alignItems: isCentered ? "center" : "flex-start",
          textAlign: isCentered ? "center" : "left",
        }}
      >
        {role === "cta" ? (
          <div
            style={{
              marginBottom: px(28),
              padding: `${px(10)}px ${px(22)}px`,
              border: `${Math.max(2, px(2))}px solid rgba(255,255,255,0.85)`,
              borderRadius: 999,
              color: "white",
              fontSize: px(26),
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Son adım
          </div>
        ) : null}

        <h1
          style={{
            margin: 0,
            color: "white",
            fontSize: role === "hook" ? px(104) : px(72),
            lineHeight: 1.08,
            fontWeight: 700,
            letterSpacing: -1.5,
            textWrap: "balance",
          }}
        >
          {headline}
        </h1>

        {body ? (
          <p
            style={{
              margin: `${px(32)}px 0 0`,
              color: "rgba(255,255,255,0.88)",
              fontSize: px(38),
              lineHeight: 1.42,
              maxWidth: "88%",
              fontWeight: 400,
            }}
          >
            {body}
          </p>
        ) : null}
      </AbsoluteFill>

      {/* Kaydırma göstergesi — carousel'de kaçıncı karede olunduğunu belli eder. */}
      <div
        style={{
          position: "absolute",
          top: px(56),
          right: px(64),
          color: "rgba(255,255,255,0.75)",
          fontSize: px(28),
          fontWeight: 600,
          letterSpacing: 1,
        }}
      >
        {index + 1}/{total}
      </div>
    </AbsoluteFill>
  );
}
