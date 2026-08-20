import { useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import CountDownTimer from "../game-components/timer";
import type { Game } from "@/types/game";
import { useBattleRoyaleSocket } from "@/hooks/useBattleRoyaleSocket";
import * as br from "@/utils/battle-royale";
import { motion } from "motion/react";
import GuessContainer from "../game-components/guess-container";
type BattleRoyaleProps = {
  socketRef: RefObject<Socket | null>;
};

const BattleRoyale = ({ socketRef }: BattleRoyaleProps) => {
  const [lobby, setLobby] = useState<Game>();

  useBattleRoyaleSocket({ socketRef, setLobby });

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 100 }}
      exit={{ scale: 0, opacity: 0 }}
      className="flex"
    >
      <div>OPponents</div>
      <div className="flex flex-col items-center gap-3 w-full grow">
        {!lobby?.room.isStarted && (
          <CountDownTimer
            expiryTimestamp={lobby?.room?.startTime}
            timerTitle="Game Starting"
          />
        )}
        <div className="flex gap-2">
          <button onClick={() => br.leave(socketRef)}>Leave</button>
        </div>

        <GuessContainer />

        <pre className="mt-3 max-w-md whitespace-pre-wrap wrap-break-words rounded-md bg-slate-100 p-3 text-xs text-slate-700">
          {JSON.stringify(lobby, null, 2)}
        </pre>
      </div>
      <div>OPponents</div>
    </motion.div>
  );
};

export default BattleRoyale;
