import type { OpponentState } from "@/state/useGameStore"

interface OpponentPanelProps {
  opponents: OpponentState[]
  targetMode: "random" | "first" | "last" | "specific"
  selectedTargetId: string
  onSelectTarget: (userId: string) => void
}

export function OpponentPanel({
  opponents,
  targetMode,
  selectedTargetId,
  onSelectTarget,
}: OpponentPanelProps) {
  return (
    <div className="flex flex-col gap-2">
      {opponents.map((opp) => {
        const isSelected = targetMode === "specific" && opp.userId === selectedTargetId
        const isClickable = targetMode === "specific"

        return (
          <div
            key={opp.userId}
            onClick={isClickable ? () => onSelectTarget(opp.userId) : undefined}
            className={[
              "rounded-lg border p-2 text-sm",
              isClickable ? "cursor-pointer" : "",
              isSelected ? "border-orange-500 bg-orange-500/10" : "border-gray-700 bg-gray-800",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={[
                  "max-w-[100px] truncate font-mono text-xs",
                  opp.eliminated ? "text-red-400 line-through" : "text-white",
                ].join(" ")}
                title={opp.userId}
              >
                {opp.userId}
              </span>
              <StatusBadge won={opp.won} eliminated={opp.eliminated} />
            </div>
            <div className="mt-1 flex gap-3 text-xs text-gray-400">
              <span>{opp.guessCount} guesses</span>
              <span>{(opp.healthMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ won, eliminated }: { won: boolean; eliminated: boolean }) {
  if (won) return <span className="text-xs text-green-400">👑 Won</span>
  if (eliminated) return <span className="text-xs text-red-400">💀 Out</span>
  return <span className="text-xs text-gray-400">Playing</span>
}
