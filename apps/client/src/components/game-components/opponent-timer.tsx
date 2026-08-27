type CircularTimerProps = {
  duration: number;
  remaining: number;
  initials: string;
};

const CircularTimer: React.FC<CircularTimerProps> = ({
  duration,
  remaining,
  initials,
}) => {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, remaining / duration));

  return (
    <div className="relative aspect-square w-full">
      <svg
        className="absolute inset-0 size-full -rotate-90"
        viewBox="0 0 100 100"
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-zinc-200"
        />

        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          className="text-zinc-700"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-semibold">{initials}</span>
      </div>
    </div>
  );
};

export default CircularTimer;
