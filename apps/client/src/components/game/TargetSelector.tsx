interface TargetSelectorProps {
  targetMode: "random" | "first" | "last" | "specific"
  onModeChange: (mode: "random" | "first" | "last" | "specific") => void
}

const MODES: { label: string; value: "random" | "first" | "last" | "specific" }[] = [
  { label: "Random", value: "random" },
  { label: "First", value: "first" },
  { label: "Last", value: "last" },
  { label: "Specific", value: "specific" },
]

export function TargetSelector({ targetMode, onModeChange }: TargetSelectorProps) {
  return (
    <div className="flex gap-1">
      {MODES.map(({ label, value }) => (
        <button
          key={value}
          type="button"
          onClick={() => onModeChange(value)}
          className={[
            "font-mono text-xs rounded px-3 py-1",
            targetMode === value
              ? "bg-orange-500 text-white"
              : "bg-gray-700 text-gray-300",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
