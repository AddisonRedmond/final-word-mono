import { variants } from "@/utils/duel";

type StatusBadgeProps = {
  badgeType: keyof typeof variants;
  label: string;
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ badgeType, label }) => {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${variants[badgeType]}`}
    >
      {label}
    </span>
  );
};

export default StatusBadge;
