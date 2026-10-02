import Button from "@/components/button";
import type { Friend } from "@/components/friends/types";

export interface ArchivedDuel {
	id: string;
	initiatedBy: string;
	createdAt: Date;
	completed: boolean;
	winner: string | null;
	participants: string[];
}

export interface ArchivedDuelRowProps {
	duel: ArchivedDuel;
	currentUserId: string;
	friends: Friend[];
	onViewResult: (duelId: string) => void;
	isLoading?: boolean;
}

const getInitials = (name: string) =>
	name
		.split(" ")
		.map((n) => n[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);

/**
 * A single row in the archived-duels list. Archived duels are completed and
 * read-only, so the only action is reopening the result view — no start,
 * forfeit, decline, or archive controls.
 */
const ArchivedDuelRow: React.FC<ArchivedDuelRowProps> = ({
	duel,
	currentUserId,
	friends,
	onViewResult,
	isLoading = false,
}) => {
	const opponentIds = duel.participants.filter((id) => id !== currentUserId);

	const outcomeLabel = () => {
		if (duel.winner === null) {
			return "Draw";
		}
		if (duel.winner === currentUserId) {
			return "You won";
		}
		const name =
			friends.find((friend) => friend.id === duel.winner)?.name ?? "Opponent";
		return `${name} won`;
	};

	return (
		<div className="flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-stone-500/10">
			<div className="min-w-0">
				<div className="flex items-center gap-1.5">
					<p className="font-semibold text-gray-800 text-sm">vs</p>
					{opponentIds.map((id) => {
						const name =
							friends.find((friend) => friend.id === id)?.name ?? "Unknown";
						return (
							<span
								className="grid size-6 shrink-0 select-none place-content-center rounded-md bg-stone-400 font-bold text-[10px] text-white"
								key={id}
								title={name}
							>
								{getInitials(name)}
							</span>
						);
					})}
				</div>
				<p className="truncate text-[11px] text-gray-500">
					{new Date(duel.createdAt).toLocaleDateString()} · {outcomeLabel()}
				</p>
			</div>

			<Button
				disabled={isLoading}
				onClick={() => onViewResult(duel.id)}
				variant="yellow"
			>
				View result
			</Button>
		</div>
	);
};

export default ArchivedDuelRow;
