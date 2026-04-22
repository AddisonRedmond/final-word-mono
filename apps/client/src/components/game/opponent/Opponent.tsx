import OpponentsContainer from "./OpponentContainer";
import { AnimatePresence, m } from "motion/react";
import OpponentHeader from "./OpponentHeader";
import OpponentWord from "./OpponentWord";

type MarathonOpponentsProps = {
  opponents?: Record<string, any>;
  lifeTimers: Record<string, number>;
};

const MarathonOpponents: React.FC<MarathonOpponentsProps> = ({
  opponents,
  lifeTimers,
}) => {

  const opponentSizePercentage =
    90 /
    Math.sqrt(
      Object.values(opponents ?? []).filter((data) => {
        return !data.eliminated;
      }).length,
    );

  return (
    <OpponentsContainer>
      <AnimatePresence>
        {Object.entries(opponents ?? []).map(([id, data]) => {
          return (
            <m.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.3, ease: "linear" }}
              style={{
                width: `${opponentSizePercentage}%`,
              }}
              key={id}
              className="flex max-w-96 flex-col gap-1 rounded-md p-1 shadow-md outline outline-1 outline-zinc-200 duration-150 ease-in-out"
            >
              <OpponentHeader
                initials={data.initials}
                correctGuessCount={data.correctGuessCount}
              />
              {lifeTimers?.[id] && (
                // <LifeTimer small={true} endTime={lifeTimers[id]} />
                <p>HP</p>
              )}
              <OpponentWord
                revealIndex={data.revealIndex}
                uniqueKey={id}
                word={data.word}
              />
            </m.div>
          );
        })}
      </AnimatePresence>
    </OpponentsContainer>
  );
};

export default MarathonOpponents;