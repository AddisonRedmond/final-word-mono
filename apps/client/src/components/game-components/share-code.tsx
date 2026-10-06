import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";

type ShareCodeProps = {
	code: string;
};

/**
 * Pre-match lobby chip showing this room's share code (v1 play-with-friends).
 * A player reads it to a friend or copies it so the friend can enter it via
 * "Join Game" on the home screen and land in the same public match. Copy falls
 * back silently if the Clipboard API is unavailable (e.g. non-secure context).
 */
const ShareCode: React.FC<ShareCodeProps> = ({ code }) => {
	const [copied, setCopied] = useState(false);

	const copy = useCallback(async () => {
		try {
			await navigator.clipboard?.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard unavailable (insecure context / denied). The code is still
			// visible for the player to type manually, so no error surfaced.
		}
	}, [code]);

	return (
		<div className="flex flex-col items-center gap-1">
			<span className="font-semibold text-[10px] text-gray-400 uppercase tracking-widest">
				Invite friends — share code
			</span>
			<button
				aria-label={`Copy game code ${code}`}
				className="flex cursor-pointer items-center gap-2 rounded-md border border-stone-300 bg-white/70 px-3 py-1.5 font-mono text-sm tracking-widest transition-all hover:border-green-400 active:scale-95"
				onClick={copy}
				type="button"
			>
				<span>{code}</span>
				{copied ? (
					<Check aria-hidden="true" className="h-3.5 w-3.5 text-green-500" />
				) : (
					<Copy aria-hidden="true" className="h-3.5 w-3.5 text-gray-400" />
				)}
			</button>
		</div>
	);
};

export default ShareCode;
