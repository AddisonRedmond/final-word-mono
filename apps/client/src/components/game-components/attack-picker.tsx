import type { TargetMode } from "@/types/battle-royale.types";

type AttackPickerProps = {
  mode: TargetMode;
  onSelect: (mode: "first" | "last" | "random") => void;
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
          ${selected ? "text-white" : "text-black group-hover:text-white"}`}
      >
        {label}
      </button>
    </div>
  );
};

const AttackPicker: React.FC<AttackPickerProps> = ({ mode, onSelect }) => {
  return (
    <div className="flex gap-x-3 rounded-full px-4 py-2 font-semibold shadow-lg">
      <TargetButton
        label="First"
        selected={mode === "first"}
        onClick={() => onSelect("first")}
      />

      <TargetButton
        label="Random"
        selected={mode === "random"}
        onClick={() => onSelect("random")}
      />

      <TargetButton
        label="Last"
        selected={mode === "last"}
        onClick={() => onSelect("last")}
      />
    </div>
  );
};

export default AttackPicker;
