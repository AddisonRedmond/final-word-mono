import { memo } from "react";
import Flipper from "./flipper";

/**
 * Arena backdrop: near-black base, the ghosted flipping word tiles, then two
 * soft colour glows (lime top-right, hot pink left) and a vignette so UI sits
 * on a dark, slightly cinematic stage.
 */
const Background = () => {
  return (
    <div
      aria-hidden="true"
      role="presentation"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Layer 1: base */}
      <div className="absolute inset-0 z-0 bg-ink" />

      {/* Layer 2: animated tiles */}
      <div className="absolute inset-0 z-10 opacity-60">
        <Flipper />
      </div>

      {/* Layer 3: colour glows + vignette */}
      <div
        className="absolute inset-0 z-20"
        style={{
          background:
            "radial-gradient(60rem 36rem at 90% -10%, rgba(182,255,46,0.20), transparent 60%)," +
            "radial-gradient(48rem 40rem at -10% 35%, rgba(255,61,129,0.16), transparent 62%)," +
            "radial-gradient(70rem 50rem at 50% 120%, rgba(110,231,255,0.08), transparent 60%)," +
            "radial-gradient(ellipse at center, transparent 40%, rgba(11,11,16,0.75) 100%)",
        }}
      />
    </div>
  );
};

export default memo(Background);
