import type { GameOverPayload } from "@/state/useGameStore"

interface GameOverScreenProps {
  gameOver: GameOverPayload
  myUserId: string | null
  onPlayAgain: () => void
}

export function GameOverScreen({ gameOver, myUserId, onPlayAgain }: GameOverScreenProps) {
  const didWin = myUserId !== null && myUserId === gameOver.winner

  return (
    <div className="flex flex-col items-center justify-center min-h-screen font-mono gap-6 p-8">
      <div className={`text-4xl font-bold ${didWin ? "text-green-400" : "text-red-400"}`}>
        {didWin ? "🏆 You Won!" : "💀 You Lost"}
      </div>

      <div className="text-lg text-gray-300">
        {gameOver.winner ? `Winner: ${gameOver.winner}` : "No winner"}
      </div>

      <table className="border-collapse text-sm">
        <thead>
          <tr className="text-gray-400 border-b border-gray-600">
            <th className="px-4 py-2 text-left">Player</th>
            <th className="px-4 py-2 text-left">Secret Word</th>
            <th className="px-4 py-2 text-center">Won</th>
          </tr>
        </thead>
        <tbody>
          {gameOver.players.map((player) => (
            <tr key={player.userId} className="border-b border-gray-700 text-gray-200">
              <td className="px-4 py-2">{player.userId}</td>
              <td className="px-4 py-2">{player.secretWord}</td>
              <td className="px-4 py-2 text-center">
                {player.won ? "✓" : "✗"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        onClick={onPlayAgain}
        className="mt-4 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded transition-colors"
      >
        Play Again
      </button>
    </div>
  )
}
