import type { DuelParticipant } from "@/db/schema";

type DuelResultProps = {
	duelData: DuelParticipant & { secretWord?: string };
	opponents: Array<{
		id: string;
		name: string;
		status: string;
		guesses: string[];
	}>;
	onClose: () => void;
};

const formatElapsed = (startTime: Date | null, endTime: Date | null) => {
	if (!startTime || !endTime) return "--:--";

	const seconds = Math.max(
		0,
		Math.floor((endTime.getTime() - startTime.getTime()) / 1000),
	);

	return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
		seconds % 60,
	).padStart(2, "0")}`;
};

const PlayerGuesses: React.FC<{ name: string; guesses: string[] }> = ({
	name,
	guesses,
}) => (
	<div className="space-y-1">
		<p className="text-sm font-semibold text-stone-700">{name}</p>
		{guesses.length > 0 ? (
			<div className="flex flex-wrap gap-1">
				{guesses.map((guess, index) => (
					<span
						key={`${guess}-${index}`}
						className="rounded bg-stone-100 px-2 py-1 font-mono text-xs font-bold tracking-widest text-stone-700"
					>
						{guess}
					</span>
				))}
			</div>
		) : (
			<p className="text-xs text-stone-500">No guesses yet</p>
		)}
	</div>
);

const DuelResult: React.FC<DuelResultProps> = ({
	duelData,
	opponents,
	onClose,
}) => (
	<div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-center shadow-xl">
		<p className="text-xs font-bold uppercase tracking-widest text-stone-500">
			Duel result
		</p>
		<h2 className="text-2xl font-bold text-stone-800">
			{duelData.success ? "Solved!" : "Not solved"}
		</h2>
		<div className="space-y-1 text-sm text-stone-600">
			<p>
				Word:{" "}
				<span className="font-bold tracking-widest">
					{duelData.secretWord ?? "—"}
				</span>
			</p>
			<p>
				{duelData.totalGuesses} of 6 guesses ·{" "}
				{formatElapsed(duelData.startTime, duelData.endTime)}
			</p>
		</div>
		<div className="border-t border-stone-200 pt-3 text-left">
			<p className="mb-1 text-xs font-bold uppercase tracking-widest text-stone-500">
				Opponents
			</p>
			{opponents.map((opponent) => (
				<div
					key={opponent.id}
					className="flex justify-between text-sm text-stone-700"
				>
					<span>{opponent.name}</span>
					<span className="font-semibold capitalize">{opponent.status}</span>
				</div>
			))}
		</div>
		<div className="border-t border-stone-200 pt-3 text-left">
			<p className="mb-2 text-xs font-bold uppercase tracking-widest text-stone-500">
				Guesses
			</p>
			<div className="space-y-3">
				<PlayerGuesses name="You" guesses={duelData.guesses} />
				{opponents.map((opponent) => (
					<PlayerGuesses
						key={opponent.id}
						name={opponent.name}
						guesses={opponent.guesses}
					/>
				))}
			</div>
		</div>
		<button
			type="button"
			onClick={onClose}
			className="rounded-md bg-stone-800 px-4 py-2 text-sm font-semibold text-white"
		>
			Close
		</button>
	</div>
);

export default DuelResult;
