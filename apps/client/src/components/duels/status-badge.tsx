import { variants } from "@/utils/duel";

type StatusBadgeProps = {
  badgeType: keyof typeof variants;
  label: string;
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ badgeType, label }) => {
  return (
    <div className="flex items-center text-xs">
      <div className={`h-2 w-2 rounded-full ${variants[badgeType]}`} />
      <p>{label}</p>
    </div>
  );
};

export default StatusBadge;
