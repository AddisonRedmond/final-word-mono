import { useWebSocket } from "@/hooks/useWebSocket";
import { useWsStore } from "@/state/useWsStore";
import { env } from "@/env.js";
import type { ClientMessage } from "types";

interface BattleRoyaleProps {
  onLeave: () => void;
}

const WS_URL = env.NEXT_PUBLIC_WS_URL;

export default function BattleRoyale({ onLeave }: BattleRoyaleProps) {
  const status = useWsStore((s) => s.status);
  const lastMessage = useWsStore((s) => s.lastMessage);
  const sendMessage = useWsStore((s) => s.sendMessage);

  useWebSocket({
    url: WS_URL,
    onMessage: (msg: ClientMessage) => {
      console.log("ws message:", msg);
    },
  });

  const handleJoinLobby = () => {
    sendMessage({ type: "join_lobby", lobbyId: "battle-royale" });
  };

  const handlePing = () => {
    sendMessage({ type: "ping" });
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <h1 className="font-mono text-lg uppercase tracking-widest">
          Battle Royale
        </h1>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-gray-400 uppercase tracking-widest">
            {status === "open" ? (
              <span className="text-green-400">● Connected</span>
            ) : status === "connecting" ? (
              <span className="text-yellow-400">● Connecting…</span>
            ) : (
              <span className="text-red-400">● Disconnected</span>
            )}
          </span>
          <button
            onClick={onLeave}
            className="font-mono text-xs text-gray-400 hover:text-white uppercase tracking-widest transition-colors"
          >
            ← Leave
          </button>
        </div>
      </div>

      <div className="flex flex-col grow items-center justify-center gap-4">
        {status !== "open" ? (
          <p className="font-mono text-sm text-gray-400">
            {status === "connecting" ? "Connecting to server…" : "Disconnected"}
          </p>
        ) : (
          <>
            <div className="flex gap-3">
              <button
                onClick={handleJoinLobby}
                className="font-mono text-xs bg-green-400 hover:bg-green-300 active:scale-95 transition-all rounded-md px-4 py-2 text-white font-bold uppercase tracking-widest"
              >
                Join Lobby
              </button>
              <button
                onClick={handlePing}
                className="font-mono text-xs bg-stone-500/30 hover:bg-stone-500/50 active:scale-95 transition-all rounded-md px-4 py-2 text-white uppercase tracking-widest"
              >
                Ping
              </button>
            </div>

            {lastMessage && (
              <pre className="font-mono text-xs text-gray-400 bg-stone-500/10 rounded-md px-4 py-3 max-w-sm w-full">
                {JSON.stringify(lastMessage, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
