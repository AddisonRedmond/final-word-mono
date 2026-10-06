import { Info } from "lucide-react";
import type React from "react";
import { useState } from "react";
import Tile from "@/components/tile";

type GameCardProps = {
	desc: string;
	title: string;
	badge?: string;
	badgeVariant?: "green" | "yellow" | "gray";
	tiles?: {
		word: string;
		variant: "correct" | "present" | "absent" | "default";
	}[];
	/**
	 * The game's "How to play" modal, rendered controlled by the card. The card
	 * owns the open state and the Info trigger in the header; each card passes
	 * its own rules component (Battle Royale, Race, ...) so GameCard stays
	 * generic rather than hardcoding one game's rules.
	 */
	rules?: (props: {
		isOpen: boolean;
		setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
	}) => React.ReactNode;
	children: React.ReactNode;
};

const GameCard: React.FC<GameCardProps> = ({
	desc,
	title,
	badge,
	badgeVariant = "green",
	tiles,
	rules,
	children,
}) => {
	const badgeColors = {
		green: "bg-green-400",
		yellow: "bg-yellow-400",
		gray: "bg-gray-400",
	};
	const [isOpen, setIsOpen] = useState(false);
	return (
		// Outer wrapper is NOT clipped so the badge can poke outside the card
		// (`-top-1 -right-1`). The inner wrapper owns `overflow-hidden` so the
		// slide-up Join Game panel (an `absolute inset-0` child) is clipped to the
		// card bounds without also clipping the badge.
		<div className="relative h-56 w-full max-w-xs font-mono">
			{badge && (
				<span
					className={`absolute -top-1 -right-1 z-20 ${badgeColors[badgeVariant]} rounded-sm px-1.5 py-0.5 font-semibold text-[9px] text-white uppercase tracking-widest`}
				>
					{badge}
				</span>
			)}

			<div className="relative h-full w-full overflow-hidden rounded-lg bg-stone-500/10 p-5 shadow-xl backdrop-blur-lg transition-all hover:border-green-400 active:scale-[0.98]">
				{tiles && (
					<div className="mb-3.5 flex gap-1.5">
						{tiles.map((tile, i) => (
							<Tile
								key={i}
								revealed
								size="sm"
								variant={tile.variant}
								word={tile.word}
							/>
						))}
					</div>
				)}

				<h2 className="m-0 mb-1.5 flex items-center gap-x-2 text-lg uppercase tracking-wide">
					{title}
					{rules && (
						<span>
							<button
								aria-label={`How to play ${title}`}
								onClick={() => setIsOpen(true)}
								type="button"
							>
								<Info size={15} />
							</button>
						</span>
					)}
				</h2>
				<p className="m-0 mb-4 text-[11px] text-gray-400 leading-relaxed">
					{desc}
				</p>

				{children}
				{rules?.({ isOpen, setIsOpen })}
			</div>
		</div>
	);
};

export default GameCard;
