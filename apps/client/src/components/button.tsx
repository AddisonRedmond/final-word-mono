import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
}
type ButtonVariant =
  | "solid"
  | "outline"
  | "selected"
  | "red"
  | "yellow"
  | "blue";

const variantClasses: Record<ButtonVariant, string> = {
  solid: "bg-green-400 text-white hover:bg-green-300",
  outline: "border border-gray-200 text-gray-500 hover:bg-gray-100",
  selected: "border-green-400 bg-green-50 text-green-600",
  red: "border border-red-500 bg-red-400 text-white hover:bg-red-300",
  yellow: "border border-amber-500 bg-amber-400 text-white hover:bg-amber-300",
  blue: "border border-blue-500 bg-blue-400 text-white hover:bg-blue-300",
};

const Button = ({
  children,
  className = "",
  type = "button",
  variant = "outline",
  ...props
}: ButtonProps) => {
  return (
    <button
      {...props}
      type={type}
      className={`cursor-pointer  text-[11px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-md transition-all active:scale-95 ${variantClasses[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

export default Button;
