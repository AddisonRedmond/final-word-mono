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

// Arena buttons are keycaps: a hard coloured bottom edge that presses down.
const variantClasses: Record<ButtonVariant, string> = {
	solid:
		"keycap bg-green-400 text-ink [--keycap-edge:var(--color-lime-edge)] hover:bg-green-300",
	outline:
		"border border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-white",
	selected: "border border-green-400 bg-green-50 text-green-400",
	red: "keycap bg-hot text-white [--keycap-edge:var(--color-hot-edge)] hover:brightness-110",
	yellow:
		"keycap bg-amber-400 text-ink [--keycap-edge:var(--color-sun-edge)] hover:bg-amber-300",
	blue: "keycap bg-ice text-ink [--keycap-edge:var(--color-ice-edge)] hover:brightness-110",
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
			className={`cursor-pointer rounded-lg px-3 py-1.5 font-display text-[11px] uppercase tracking-widest transition-all ${variantClasses[variant]} ${className}`}
			type={type}
		>
			{children}
		</button>
	);
};

export default Button;
