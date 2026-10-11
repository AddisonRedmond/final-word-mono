import { SCORING_CONFIG } from "@/db/schema";

// Shared "How points work" visual + copy for the game-mode info modals.
//
// Every number here is READ from the shared `SCORING_CONFIG` (the same source
// of truth the server scores with), so the explanation can never drift from the
// real formula: retune the config and this UI updates with it. Both Battle
// Royale and Race use the identical seasonal scoring, so they share this one
// component rather than duplicating the copy.

const { placementTiers, winBonus, combatPointsCap, placementMultiplierTiers } =
  SCORING_CONFIG;

/** "1st", "2nd", "3rd", "4th", … for a placement number. */
const ordinal = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

/**
 * Render a tier's placement range as a short label. The first tier is "1st";
 * subsequent tiers read "top N" using their `maxPlacement`.
 */
const tierLabel = (maxPlacement: number, index: number): string =>
  index === 0 ? ordinal(maxPlacement) : `Top ${maxPlacement}`;

/** A labelled chip showing a tier threshold and its value. */
const Chip: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="flex flex-col items-center rounded-md border border-gray-200 bg-white/70 px-2 py-1">
    <span className="font-semibold text-[9px] text-gray-400 uppercase tracking-widest">
      {label}
    </span>
    <span className="font-bold text-[13px] text-gray-800">{value}</span>
  </div>
);

/**
 * The scoring-formula slide body: the plain-language formula, the placement
 * point tiers, the win bonus + combat cap, and the Apex-style placement
 * multiplier that scales combat by how well you finished.
 */
export const ScoreBreakdown: React.FC = () => (
  <div className="flex w-full max-w-md flex-col gap-2.5">
    {/* The formula, in words. */}
    <p className="text-center font-semibold text-[11px] text-stone-700 leading-snug tracking-wide">
      Placement points + win bonus + (combat × placement multiplier)
    </p>

    {/* Placement point tiers. */}
    <div>
      <p className="mb-1 text-[9px] text-gray-400 uppercase tracking-widest">
        Placement points
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {placementTiers.map((t, i) => (
          <Chip
            key={t.maxPlacement}
            label={tierLabel(t.maxPlacement, i)}
            value={`${t.points} pts`}
          />
        ))}
      </div>
    </div>

    {/* Placement multiplier tiers (the Apex-style part). */}
    <div>
      <p className="mb-1 text-[9px] text-gray-400 uppercase tracking-widest">
        Combat multiplier (by placement)
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {placementMultiplierTiers.map((t, i) => (
          <Chip
            key={t.maxPlacement}
            label={tierLabel(t.maxPlacement, i)}
            value={`×${t.multiplier}`}
          />
        ))}
      </div>
    </div>

    {/* Win bonus + combat cap footnote. */}
    <p className="text-center text-[10px] text-gray-500 leading-snug">
      Win for a <span className="font-semibold">+{winBonus}</span> bonus. Combat
      comes from words solved (capped at{" "}
      <span className="font-semibold">{combatPointsCap}</span> before the
      multiplier).
    </p>
  </div>
);
