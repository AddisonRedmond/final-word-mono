interface GameBoardProps {
  guesses: string[]
  feedbacks: Array<Array<"correct" | "present" | "absent">>
  currentInput: string
  revealedPositions: number[]
  isAttackWord: boolean
}

const ROWS = 6
const COLS = 5

function feedbackColor(fb: "correct" | "present" | "absent"): string {
  if (fb === "correct") return "bg-green-600"
  if (fb === "present") return "bg-yellow-500"
  return "bg-gray-600"
}

export default function GameBoard({
  guesses,
  feedbacks,
  currentInput,
  revealedPositions,
  isAttackWord,
}: GameBoardProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      {isAttackWord && (
        <p className="font-mono text-xs text-orange-400 uppercase tracking-widest">
          ⚔ Attack Word
        </p>
      )}
      <div
        className={`flex flex-col gap-1 p-2 border-2 ${
          isAttackWord ? "border-orange-500" : "border-transparent"
        }`}
      >
        {Array.from({ length: ROWS }, (_, row) => {
          const isSubmitted = row < guesses.length
          const isCurrent = row === guesses.length

          return (
            <div key={row} className="flex gap-1">
              {Array.from({ length: COLS }, (_, col) => {
                let letter = ""
                let bgClass = "bg-transparent border border-white/30"

                if (isSubmitted) {
                  letter = guesses[row]?.[col]?.toUpperCase() ?? ""
                  const fb = feedbacks[row]?.[col]
                  bgClass = fb ? feedbackColor(fb) : "bg-gray-600"
                } else if (isCurrent) {
                  letter = currentInput[col]?.toUpperCase() ?? ""
                  if (isAttackWord && revealedPositions.includes(col)) {
                    bgClass = "bg-blue-700 border border-blue-400"
                  } else {
                    bgClass = "bg-transparent border border-white/60"
                  }
                }

                return (
                  <div
                    key={col}
                    className={`w-14 h-14 flex items-center justify-center font-mono text-white text-xl font-bold uppercase ${bgClass}`}
                  >
                    {letter}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
