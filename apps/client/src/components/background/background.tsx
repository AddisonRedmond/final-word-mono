import { memo } from "react";
import Flipper from "./flipper";

const Background: React.FC = () => {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0 " />
      <div className="absolute inset-0 from-white via-white to-pink-200  dark:opacity-0 " />
      <Flipper />
    </div>
  );
};

export default memo(Background);
