import type { TargetTypes } from "@/types/game";
import type { Dispatch, SetStateAction } from "react";

type AttackPickerProps = {
  target: TargetTypes;
  setTarget: Dispatch<SetStateAction<TargetTypes>>;
};

type TargetButtonProps = {
  label: string;
  selected: boolean;
  onClick: () => void;
};

const TargetButton: React.FC<TargetButtonProps> = ({
  label,
  selected,
  onClick,
}) => {
  return (
    <div className="grid group overflow-hidden rounded-full">
      {/* Animated background */}
      <div
        className={`col-span-full row-span-full rounded-full p-2
          transition-all duration-150 ease-in-out
          ${
            selected
              ? "translate-y-0 bg-zinc-800"
              : "-translate-y-full bg-zinc-500 group-hover:translate-y-0"
          }`}
      />

      {/* Button */}
      <button
        type="button"
        onClick={onClick}
        className={`z-10 col-span-full row-span-full cursor-pointer p-2
          transition-colors duration-150 ease-in-out
          ${
            selected
              ? "text-white"
              : "text-black group-hover:text-white"
          }`}
      >
        {label}
      </button>
    </div>
  );
};

const AttackPicker: React.FC<AttackPickerProps> = ({
  target,
  setTarget,
}) => {
  return (
    <div className="flex gap-x-3 rounded-full px-4 py-2 font-semibold shadow-lg">
      <TargetButton
        label="First"
        selected={target === "first"}
        onClick={() => setTarget("first")}
      />

      <TargetButton
        label="Random"
        selected={target === "random"}
        onClick={() => setTarget("random")}
      />

      <TargetButton
        label="Last"
        selected={target === "last"}
        onClick={() => setTarget("last")}
      />
    </div>
  );
};

export default AttackPicker;