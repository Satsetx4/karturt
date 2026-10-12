import { ImageResponse } from "next/og";

/** Public, brand-aligned home-screen artwork; does not access user data. */
export function createPwaIcon(size: 180 | 192 | 512) {
  return new ImageResponse(
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      position: "relative",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#173745",
      color: "#f4fbf8",
    }}>
      <span style={{
        display: "flex",
        fontFamily: "Arial, sans-serif",
        fontWeight: 800,
        fontSize: Math.round(size * 0.58),
        lineHeight: 1,
        marginTop: -Math.round(size * 0.02),
      }}>K</span>
      <span style={{
        position: "absolute",
        width: Math.round(size * 0.08),
        height: Math.round(size * 0.08),
        right: Math.round(size * 0.19),
        bottom: Math.round(size * 0.19),
        backgroundColor: "#82c0b5",
        borderRadius: Math.max(2, Math.round(size * 0.01)),
      }} />
    </div>,
    { width: size, height: size },
  );
}
