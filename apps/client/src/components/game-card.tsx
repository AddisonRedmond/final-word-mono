import { Info } from "lucide-react";
import type React from "react";
import { useState } from "react";
import Tile from "@/components/tile";

type GameCardProps = {
	desc: string;
	title: string;
	badge?: string;
	badgeVariant?: "green" | "yellow" | "gray";
	/** Colour identity of the mode: drives the card's glow and hover edge. */
	accent?: "lime" | "hot" | "ice" | "sun";
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
	accent = "lime",
	tiles,
	rules,
	children,
}) => {
	const badgeColors = {
		green: "bg-hot text-white",
		yellow: "bg-sun text-ink",
		gray: "bg-ice text-ink",
	};
	// Per-mode glow colour (RGB so it can be used at several alphas) and the
	// hover ring colour.
	const accents = {
		lime: { rgb: "182,255,46", ring: "hover:ring-lime/60" },
		hot: { rgb: "255,61,129", ring: "hover:ring-hot/60" },
		ice: { rgb: "110,231,255", ring: "hover:ring-ice/60" },
		sun: { rgb: "255,214,10", ring: "hover:ring-sun/60" },
	}[accent];
	const [isOpen, setIsOpen] = useState(false);
	return (
		// Outer wrapper is NOT clipped so the badge can poke outside the card
		// (`-top-1 -right-1`). The inner wrapper owns `overflow-hidden` so the
		// slide-up Join Game panel (an `absolute inset-0` child) is clipped to the
		// card bounds without also clipping the badge.
		<div className="group relative min-h-56 w-full max-w-xs">
			{badge && (
				<span
					className={`absolute -top-2 -right-2 z-20 ${badgeColors[badgeVariant]} -rotate-3 rounded-md px-2 py-0.5 font-display text-[10px] uppercase tracking-widest shadow-lg`}
				>
					{badge}
				</span>
			)}

			<div
				className={`relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-panel/80 p-5 shadow-2xl ring-2 ring-transparent backdrop-blur-xl transition-all duration-200 group-hover:-translate-y-1 ${accents.ring}`}
				style={{
					backgroundImage: `radial-gradient(18rem 10rem at 100% 0%, rgba(${accents.rgb},0.22), transparent 70%)`,
				}}
			>
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

				<h2 className="m-0 mb-1.5 flex items-center gap-x-2 text-xl uppercase leading-none tracking-tight">
					{title}
					{rules && (
						<span>
							<button
								aria-label={`How to play ${title}`}
								className="cursor-pointer text-gray-500 transition-colors hover:text-white"
								onClick={() => setIsOpen(true)}
								type="button"
							>
								<Info size={15} />
							</button>
						</span>
					)}
				</h2>
				<p className="m-0 mb-4 text-gray-600 text-xs leading-relaxed">{desc}</p>

				{children}
				{rules?.({ isOpen, setIsOpen })}
			</div>
		</div>
	);
};

export default GameCard;
