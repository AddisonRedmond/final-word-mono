import type { DuelParticipant } from "@/db/schema";
import {
	type KeyboardState,
	MAX_GUESSES,
	type MatchResult,
} from "@/utils/duel";

type DuelData = {
	duel: {
		id: string;
		initiatedBy: string;
		createdAt: Date;
		completed: boolean;
		winner: string | null;
		participants: string[];
	};
	participant: DuelParticipant[];
	matchResults: MatchResult[];
	keyboardState: KeyboardState;
	secretWord?: string;
};
type DuelResultProps = {
	duelData: DuelData;
	currentUserId: string;
	opponents: Array<{
		id: string;
		name: string;
		status: string;
		guesses: string[];
	}>;
	onClose: () => void;
};
const formatElapsed = (startTime: Date | null, endTime: Date | null) => {
	if (!startTime || !endTime) {
		return "--:--";
	}
	const seconds = Math.max(
		0,
		Math.floor((endTime.getTime() - startTime.getTime()) / 1000),
	);
	return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const PlayerGuesses: React.FC<{ name: string; guesses: string[] }> = ({
	name,
	guesses,
}) => {
	const guessOccurrences = new Map<string, number>();
	return (
		<div className="space-y-1">
			{" "}
			<p className="font-semibold text-sm text-stone-700">{name}</p>{" "}
			{guesses.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{" "}
					{guesses.map((guess) => {
						const occurrence = guessOccurrences.get(guess) ?? 0;
						guessOccurrences.set(guess, occurrence + 1);
						return (
							<span
								className="rounded bg-stone-100 px-2 py-1 font-bold font-mono text-stone-700 text-xs tracking-widest"
								key={`${guess}-${occurrence}`}
							>
								{" "}
								{guess}{" "}
							</span>
						);
					})}{" "}
				</div>
			) : (
				<p className="text-stone-500 text-xs">No guesses yet</p>
			)}{" "}
		</div>
	);
};
const DuelResult: React.FC<DuelResultProps> = ({
	duelData,
	currentUserId,
	opponents,
	onClose,
}) => {
	const { duel, participant } = duelData;
	const currentParticipant = participant.find(
		(participant) => participant.userId === currentUserId,
	);
	const winnerName = () => {
		if (!duel.completed) {
			return "—";
		}
		if (duel.winner === null) {
			return "Draw";
		}
		if (duel.winner === currentUserId) {
			return "You";
		}
		const winner = opponents.find((opponent) => opponent.id === duel.winner);
		return winner?.name ?? "Unknown";
	};
	return (
		<div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 text-center shadow-xl">
			{" "}
			<p className="font-bold text-stone-500 text-xs uppercase tracking-widest">
				{" "}
				Duel result{" "}
			</p>{" "}
			<h2 className="font-bold text-2xl text-stone-800">
				{" "}
				{currentParticipant?.success ? "Solved!" : "Not solved"}{" "}
			</h2>{" "}
			<div className="space-y-1 text-sm text-stone-600">
				{" "}
				<p>
					{" "}
					Word:{" "}
					<span className="font-bold tracking-widest">
						{" "}
						{duelData.secretWord ?? "—"}{" "}
					</span>{" "}
				</p>{" "}
				<p>
					{" "}
					{currentParticipant?.totalGuesses ?? 0} of {MAX_GUESSES} guesses ·{" "}
					{formatElapsed(
						currentParticipant?.startTime ?? null,
						currentParticipant?.endTime ?? null,
					)}{" "}
				</p>{" "}
			</div>{" "}
			<div className="border-stone-200 border-y py-3">
				{" "}
				<p className="font-bold text-stone-500 text-xs uppercase tracking-widest">
					{" "}
					Winner{" "}
				</p>{" "}
				<p className="mt-1 font-bold text-lg text-stone-800">
					{" "}
					{winnerName()}{" "}
				</p>{" "}
			</div>{" "}
			<div className="border-stone-200 border-t pt-3 text-left">
				{" "}
				<p className="mb-1 font-bold text-stone-500 text-xs uppercase tracking-widest">
					{" "}
					Opponents{" "}
				</p>{" "}
				{opponents.map((opponent) => (
					<div
						className="flex justify-between text-sm text-stone-700"
						key={opponent.id}
					>
						{" "}
						<span>{opponent.name}</span>{" "}
						<span className="font-semibold capitalize">
							{" "}
							{opponent.status}{" "}
						</span>{" "}
					</div>
				))}{" "}
			</div>{" "}
			<div className="border-stone-200 border-t pt-3 text-left">
				{" "}
				<p className="mb-2 font-bold text-stone-500 text-xs uppercase tracking-widest">
					{" "}
					Guesses{" "}
				</p>{" "}
				<div className="space-y-3">
					{" "}
					<PlayerGuesses
						guesses={currentParticipant?.guesses ?? []}
						name="You"
					/>{" "}
					{opponents.map((opponent) => (
						<PlayerGuesses
							guesses={opponent.guesses}
							key={opponent.id}
							name={opponent.name}
						/>
					))}{" "}
				</div>{" "}
			</div>{" "}
			<button
				className="rounded-md bg-stone-800 px-4 py-2 font-semibold text-sm text-white"
				onClick={onClose}
				type="button"
			>
				{" "}
				Close{" "}
			</button>{" "}
		</div>
	);
};
export default DuelResult;
