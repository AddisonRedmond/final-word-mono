import { variants } from "@/utils/duel";

type StatusBadgeProps = {
  badgeType: keyof typeof variants;
  label: string;
};

// Minimal status chip: a small colour dot (the status colour) next to a neutral
// label, rather than a fully colour-filled pill. Keeps the three-colour status
// language legible while staying unobtrusive in the list.
const StatusBadge: React.FC<StatusBadgeProps> = ({ badgeType, label }) => {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${variants[badgeType]}`}
      />
      {label}
    </span>
  );
};

export default StatusBadge;
