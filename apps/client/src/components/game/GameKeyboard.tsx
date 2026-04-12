import { useEffect } from "react"

interface GameKeyboardProps {
  feedbacks: Array<Array<"correct" | "present" | "absent">>
  guesses: string[]
  onLetter: (letter: string) => void
  onEnter: () => void
  onDelete: () => void
  disabled?: boolean
}

const ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "DELETE"],
]

type KeyStatus = "correct" | "present" | "absent" | "unplayed"

const PRIORITY: Record<KeyStatus, number> = {
  correct: 3,
  present: 2,
  absent: 1,
  unplayed: 0,
}

const BG: Record<KeyStatus, string> = {
  correct: "bg-green-600",
  present: "bg-yellow-500",
  absent: "bg-gray-600",
  unplayed: "bg-gray-700",
}

function buildKeyStatuses(
  guesses: string[],
  feedbacks: Array<Array<"correct" | "present" | "absent">>
): Record<string, KeyStatus> {
  const statuses: Record<string, KeyStatus> = {}

  for (let i = 0; i < guesses.length; i++) {
    const word = guesses[i]?.toUpperCase() ?? ""
    const fb = feedbacks[i] ?? []
    for (let j = 0; j < word.length; j++) {
      const letter = word[j]
      if (!letter) continue
      const newStatus = fb[j] ?? "absent"
      const current = statuses[letter] ?? "unplayed"
      if (PRIORITY[newStatus] > PRIORITY[current]) {
        statuses[letter] = newStatus
      }
    }
  }

  return statuses
}

export default function GameKeyboard({
  feedbacks,
  guesses,
  onLetter,
  onEnter,
  onDelete,
  disabled = false,
}: GameKeyboardProps) {
  const keyStatuses = buildKeyStatuses(guesses, feedbacks)

  useEffect(() => {
    if (disabled) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        onEnter()
      } else if (e.key === "Backspace") {
        onDelete()
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        onLetter(e.key.toUpperCase())
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [disabled, onLetter, onEnter, onDelete])

  return (
    <div className="flex flex-col items-center gap-2">
      {ROWS.map((row, rowIdx) => (
        <div key={rowIdx} className="flex gap-1">
          {row.map((key) => {
            const isSpecial = key === "ENTER" || key === "DELETE"
            const status: KeyStatus = isSpecial ? "unplayed" : (keyStatuses[key] ?? "unplayed")
            const bg = BG[status]

            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (key === "ENTER") onEnter()
                  else if (key === "DELETE") onDelete()
                  else onLetter(key)
                }}
                className={`rounded font-mono text-white text-sm font-bold uppercase
                  ${isSpecial ? "px-4 py-4" : "px-3 py-4"}
                  ${bg}
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors`}
              >
                {key}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
