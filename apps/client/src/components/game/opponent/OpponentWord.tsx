import { m } from "motion/react";

type OpponentWordProps = {
  word: string;
  uniqueKey?: string;
  revealIndex?: number[];
};

const OpponentWord: React.FC<OpponentWordProps> = ({
  word,
  uniqueKey = "",
  ...props
}) => {
  return (
    <div className="mt-1 flex justify-between">
      {word.split("").map((letter, index) => {
        return (
          <div
            style={{
              backgroundColor: props.revealIndex?.includes(index)
                ? "#00DFA2"
                : "#d4d4d8",
            }}
            className="grid aspect-square h-full w-[18%] place-content-center rounded-md text-xl font-semibold"
            key={`${index}${letter}${uniqueKey}`}
          >
            {props.revealIndex?.includes(index) && (
              <m.p
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={`hidden font-bold lg:block`}
              >
                {letter}
              </m.p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default OpponentWord;
