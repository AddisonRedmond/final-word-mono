import {useState} from "react";
import {useWebSocket} from "@/hooks/useWebSocket";
import {useWsStore} from "@/state/useWsStore";
import {env} from "@/env.js";
import type {ClientMessage} from "types";
import ScrollTile from "../scroll-tile";

type LobbyState = Extract<ClientMessage, { type: "lobby_state" }>;

interface BattleRoyaleProps {
    onLeave: () => void;
}

const WS_URL = env.NEXT_PUBLIC_WS_URL;

export default function BattleRoyale({onLeave} : BattleRoyaleProps) {
    const status = useWsStore((s) => s.status);
    const sendMessage = useWsStore((s) => s.sendMessage);
    const [lobby, setLobby] = useState<LobbyState | null>(null);

    useWebSocket({
        url: WS_URL,
        onOpen: () => {
            sendMessage({type: "find_or_create_lobby"});
        },
        onMessage: (msg : ClientMessage) => {
            if (msg.type === "lobby_state") {
                setLobby(msg);
            }
        }
    });

    const countdown = lobby
        ? Math.max(0, Math.ceil((lobby.beginAtCountdown - Date.now()) / 1000))
        : null;

    const countdownDigits = countdown !== null ? String(countdown) : null;

    console.log(lobby)

    return (
        <div className="flex flex-col h-screen">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h1 className="font-mono text-lg uppercase tracking-widest">
                    Battle Royale
                </h1>
                <div className="flex items-center gap-4">
                    <span className="font-mono text-xs text-gray-400 uppercase tracking-widest">
                        {
                        status === "open" ? (
                            <span className="text-green-400">● Connected</span>
                        ) : status === "connecting" ? (
                            <span className="text-yellow-400">● Connecting…</span>
                        ) : (
                            <span className="text-red-400">● Disconnected</span>
                        )
                    } </span>
                    <button onClick={onLeave}
                        className="font-mono text-xs text-gray-400 hover:text-white uppercase tracking-widest transition-colors">
                        ← Leave
                    </button>
                </div>
            </div>

            <div className="flex flex-col grow items-center justify-center gap-6">
                {
                status !== "open" ? (
                    <p className="font-mono text-sm text-gray-400">
                        {
                        status === "connecting" ? "Connecting to server…" : "Disconnected"
                    } </p>
                ) : (
                    <>
                        <p className="font-mono text-xs text-gray-400 uppercase tracking-widest">
                            Game starts in
                        </p>
                        {
                        countdownDigits ? (
                            <ScrollTile letters={countdownDigits}
                                theme="present"
                                size="lg"/>
                        ) : (
                            <p className="font-mono text-sm text-gray-400">Waiting…</p>
                        )
                    } </>
                )
            } </div>
        </div>
    );
}
