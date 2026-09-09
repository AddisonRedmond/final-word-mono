export type SectionVariant = "default" | "green" | "amber" | "blue";

const sectionVariantClasses: Record<SectionVariant, string> = {
  default: "text-gray-400",
  green: "text-emerald-500",
  amber: "text-amber-500",
  blue: "text-sky-500",
};

interface SectionHeadingProps {
  label: string;
  variant?: SectionVariant;
}

export const SectionHeading = ({
  label,
  variant = "default",
}: SectionHeadingProps) => (
  <h2
    className={`text-[11px] font-semibold uppercase tracking-widest mb-3 ${sectionVariantClasses[variant]}`}
  >
    {label}
  </h2>
);

interface EmptyStateProps {
  message: string;
}

export const EmptyState = ({ message }: EmptyStateProps) => (
  <p className="text-[11px] text-gray-500 font-mono py-3 text-center">
    {message}
  </p>
);
