import { memo } from "react";
import Flipper from "./flipper";

const Background = () => {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Layer 1: base */}
      <div className="absolute inset-0 z-0 bg-white" />

      {/* Layer 2: animated tiles */}
      <div className="absolute inset-0 z-10">
        <Flipper />
      </div>

      {/* Layer 3: gradient wash */}
      <div className="absolute inset-0 z-20 bg-linear-to-br from-white/40 via-white/40 to-pink-200/40" />
    </div>
  );
};

export default memo(Background);
