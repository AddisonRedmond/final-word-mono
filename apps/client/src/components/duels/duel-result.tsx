import { useState } from "react";
import type { DuelParticipant } from "@/db/schema";
import { toast } from "@/state/toast-store";
import { api } from "@/utils/api";
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
type Opponent = {
	id: string;
	name: string;
	status: string;
	guesses: string[];
};
type DuelResultProps = {
	duelData: DuelData;
	currentUserId: string;
	opponents: Opponent[];
	onClose: () => void;
	// Omitted when viewing an already-archived duel (read-only), so no Archive
	// button is shown in that mode.
	onArchive?: () => void;
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

/**
 * One-line summary of the running rivalry, e.g. "Sarah won the last 2" or
 * "You won the last 3". A draw run reads "last N drawn". `count === 0` means
 * the two have no shared completed duels yet, so nothing is rendered.
 */
const streakSummary = (
	streak: { outcome: "self" | "opponent" | "draw"; count: number },
	opponentName: string,
): string | null => {
	if (streak.count === 0) {
		return null;
	}
	const games = streak.count === 1 ? "game" : "games";
	if (streak.outcome === "draw") {
		return `last ${streak.count} ${games} drawn`;
	}
	const who = streak.outcome === "self" ? "You" : opponentName;
	const verb =
		streak.count === 1 ? "won the last game" : `won the last ${streak.count}`;
	return `${who} ${verb}`;
};

/**
 * Head-to-head record for the current user against a single opponent, read on
 * demand from `duels.headToHead`. Renders a one-line rivalry summary like
 * "You vs. Sarah — 23 games, 11-10, 2 draws, Sarah won the last 2". Shows a
 * lightweight loading line while the query is in flight and nothing (except an
 * invitation to play) when the two have never shared a completed duel.
 */
const HeadToHeadPanel: React.FC<{
	opponentId: string;
	opponentName: string;
}> = ({ opponentId, opponentName }) => {
	const { data, isLoading } = api.duels.headToHead.useQuery({ opponentId });

	if (isLoading) {
		return (
			<p className="text-stone-500 text-xs">
				Loading record vs. {opponentName}…
			</p>
		);
	}

	if (!data || data.totalGames === 0) {
		return (
			<p className="text-stone-500 text-xs">
				No head-to-head record with {opponentName} yet.
			</p>
		);
	}

	const drawsLabel = data.draws === 1 ? "draw" : "draws";
	const summary = streakSummary(data.streak, opponentName);

	return (
		<p className="text-sm text-stone-700">
			<span className="font-semibold">You vs. {opponentName}</span> —{" "}
			{data.totalGames} {data.totalGames === 1 ? "game" : "games"},{" "}
			{data.selfWins}-{data.opponentWins}, {data.draws} {drawsLabel}
			{summary ? `, ${summary}` : ""}
		</p>
	);
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
	onArchive,
}) => {
	const { duel, participant } = duelData;
	const utils = api.useUtils();
	const rematchMutation = api.duels.rematchDuel.useMutation();
	// Guards against a double-tap on "Rematch" creating two duels before the
	// mutation's pending state has a chance to disable the button.
	const [isRematching, setIsRematching] = useState(false);
	const currentParticipant = participant.find(
		(participant) => participant.userId === currentUserId,
	);
	// The winner is only meaningful once the whole duel is resolved. While other
	// participants are still playing (`completed = false`) there is no winner yet,
	// so we never run the winner calculation or render a name — the section shows
	// a pending dash instead.
	const winnerName = () => {
		if (duel.winner === null) {
			return "Draw";
		}
		if (duel.winner === currentUserId) {
			return "You";
		}
		const winner = opponents.find((opponent) => opponent.id === duel.winner);
		return winner?.name ?? "Unknown";
	};

	const handleRematch = async () => {
		if (isRematching) {
			return;
		}
		setIsRematching(true);
		try {
			await rematchMutation.mutateAsync({ sourceDuelId: duel.id });
			// A rematch is just a new duel: refresh the active list so it shows up
			// the same way any new duel does, then dismiss the result view.
			await utils.duels.allDuels.invalidate();
			toast("Rematch sent!", { variant: "success" });
			onClose();
		} catch (error) {
			// Surface the server's tier-aware gate messages (friendship checks,
			// active-duel cap, invitee cap) rather than letting the reject vanish.
			toast(
				error instanceof Error
					? error.message
					: "Something went wrong sending the rematch.",
				{ variant: "error" },
			);
		} finally {
			setIsRematching(false);
		}
	};

	return (
		<div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-4 text-center shadow-xl sm:p-6">
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
					{duel.completed ? winnerName() : "—"}{" "}
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
			{/* Head-to-head rivalry record. The 1v1 case is primary; for a
			    multi-opponent duel we show one line per opponent so "see our
			    record → rematch" stays a single flow (R6.6). */}
			<div className="border-stone-200 border-t pt-3 text-left">
				{" "}
				<p className="mb-2 font-bold text-stone-500 text-xs uppercase tracking-widest">
					{" "}
					Head-to-head{" "}
				</p>{" "}
				<div className="space-y-1">
					{" "}
					{opponents.map((opponent) => (
						<HeadToHeadPanel
							key={opponent.id}
							opponentId={opponent.id}
							opponentName={opponent.name}
						/>
					))}{" "}
				</div>{" "}
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
			<div className="flex justify-center gap-2">
				{" "}
				<button
					className="rounded-md bg-stone-800 px-4 py-2 font-semibold text-sm text-white"
					onClick={onClose}
					type="button"
				>
					{" "}
					Close{" "}
				</button>{" "}
				{/* A rematch re-challenges the same opponents; only meaningful once
				    the duel is over (R5.1). */}
				{duel.completed && (
					<button
						aria-busy={isRematching}
						className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
						disabled={isRematching}
						onClick={() => void handleRematch()}
						type="button"
					>
						{" "}
						{isRematching ? "Sending…" : "Rematch"}{" "}
					</button>
				)}{" "}
				{duel.completed && onArchive && (
					<button
						className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-sm text-white"
						onClick={onArchive}
						type="button"
					>
						{" "}
						Archive{" "}
					</button>
				)}{" "}
			</div>{" "}
		</div>
	);
};
export default DuelResult;
