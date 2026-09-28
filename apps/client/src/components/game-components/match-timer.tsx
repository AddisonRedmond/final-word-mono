import { useEffect } from "react";
import { useTimer } from "react-timer-hook";
import { useServerClockStore } from "@/state/server-clock-store";

type MatchTimerProps = {
	expiryTimestamp?: number;
	/** Caption shown above the countdown. Defaults to Battle Royale's wording. */
	label?: string;
};

const MatchTimer: React.FC<MatchTimerProps> = ({
	expiryTimestamp,
	label = "Match Ends In",
}) => {
	const hasExpiryTimestamp =
		typeof expiryTimestamp === "number" && Number.isFinite(expiryTimestamp);
	// Convert the server-issued match-end timestamp onto the client clock.
	const offsetMs = useServerClockStore((state) => state.offsetMs);
	const clientExpiry = hasExpiryTimestamp
		? expiryTimestamp - offsetMs
		: Date.now();

	const { totalSeconds, restart } = useTimer({
		autoStart: hasExpiryTimestamp,
		expiryTimestamp: new Date(clientExpiry),
	});

	useEffect(() => {
		if (!hasExpiryTimestamp) {
			return;
		}

		restart(new Date(clientExpiry), true);
	}, [clientExpiry, hasExpiryTimestamp, restart]);

	if (!hasExpiryTimestamp) {
		return null;
	}

	const remainingSeconds = Math.max(totalSeconds, 0);
	const minutes = Math.floor(remainingSeconds / 60);
	const seconds = remainingSeconds % 60;

	return (
		<div
			aria-label={label}
			className="text-center font-semibold text-xs tabular-nums"
			role="timer"
		>
			<p className="text-[10px] text-zinc-500 uppercase tracking-wide">
				{label}
			</p>
			<p>
				{minutes}:{seconds.toString().padStart(2, "0")}
			</p>
		</div>
	);
};

export default MatchTimer;
