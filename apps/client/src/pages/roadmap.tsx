import { promises as fs } from "node:fs";
import path from "node:path";
import type { GetStaticProps, InferGetStaticPropsType } from "next";
import Head from "next/head";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import Navbar from "@/components/navigation/navbar";
import Tile from "@/components/tile";

/**
 * The public roadmap is authored as plain Markdown at
 * `src/content/roadmap.md` so copy can be edited without touching any JSX.
 * We read it once at build time (`getStaticProps`) and hand the raw string to
 * <ReactMarkdown>, which renders it through the themed `components` map below.
 * This is intentionally NOT the internal planning doc under `.kiro/specs` —
 * that one carries implementation detail that shouldn't be shown to players.
 */
const ROADMAP_PATH = path.join(process.cwd(), "src", "content", "roadmap.md");

export const getStaticProps = (async () => {
	const markdown = await fs.readFile(ROADMAP_PATH, "utf8");
	return { props: { markdown } };
}) satisfies GetStaticProps<{ markdown: string }>;

/**
 * Themed renderers for each Markdown element, matching the Final Word look:
 * amber/stone palette, mono accents on headings, emerald rule, and translucent
 * surfaces. Keeping the map module-level gives it a stable identity across
 * renders.
 */
const markdownComponents: Components = {
	h1: ({ children }: ComponentPropsWithoutRef<"h1">) => (
		<h1 className="mt-2 mb-4 font-bold text-3xl text-stone-800 tracking-tight sm:text-4xl">
			{children}
		</h1>
	),
	h2: ({ children }: ComponentPropsWithoutRef<"h2">) => (
		<h2 className="mt-10 mb-3 font-mono font-semibold text-stone-500 text-xs uppercase tracking-[0.2em]">
			{children}
		</h2>
	),
	h3: ({ children }: ComponentPropsWithoutRef<"h3">) => (
		<h3 className="mt-6 mb-2 font-bold text-stone-800 text-xl">{children}</h3>
	),
	p: ({ children }: ComponentPropsWithoutRef<"p">) => (
		<p className="my-3 text-stone-600 leading-relaxed">{children}</p>
	),
	ul: ({ children }: ComponentPropsWithoutRef<"ul">) => (
		<ul className="my-3 flex flex-col gap-y-2">{children}</ul>
	),
	li: ({ children }: ComponentPropsWithoutRef<"li">) => (
		<li className="flex items-start gap-x-2.5 text-stone-600 leading-relaxed">
			{/* A small amber tile-dot leads each bullet, echoing the game's tiles. */}
			<span className="mt-[0.45rem] size-2 shrink-0 rounded-[3px] bg-amber-400" />
			<span>{children}</span>
		</li>
	),
	strong: ({ children }: ComponentPropsWithoutRef<"strong">) => (
		<strong className="font-semibold text-stone-800">{children}</strong>
	),
	a: ({ children, href }: ComponentPropsWithoutRef<"a">) => (
		<a
			className="font-medium text-emerald-600 underline decoration-emerald-300 underline-offset-2 transition-colors hover:text-emerald-700"
			href={href}
		>
			{children}
		</a>
	),
	hr: () => <hr className="my-8 border-amber-200/70" />,
	table: ({ children }: ComponentPropsWithoutRef<"table">) => (
		<div className="my-4 overflow-x-auto">
			<table className="w-full border-collapse text-left text-sm">
				{children}
			</table>
		</div>
	),
	th: ({ children }: ComponentPropsWithoutRef<"th">) => (
		<th className="border border-amber-200/70 bg-amber-50 px-3 py-2 font-semibold text-stone-700">
			{children}
		</th>
	),
	td: ({ children }: ComponentPropsWithoutRef<"td">) => (
		<td className="border border-amber-200/70 px-3 py-2 text-stone-600">
			{children}
		</td>
	),
};

export default function Roadmap({
	markdown,
}: InferGetStaticPropsType<typeof getStaticProps>) {
	return (
		<>
			<Head>
				<title>Roadmap — Final Word</title>
				<meta
					content="See what's coming to Final Word: new live game modes, mobile apps, Premium, and more."
					name="description"
				/>
				<link href="/favicon_v2.png" rel="icon" />
			</Head>
			<main className="flex h-dvh flex-col overflow-hidden">
				<Navbar />
				<div className="flex min-h-0 grow flex-col items-center overflow-y-auto px-4 py-8">
					<div className="w-full max-w-2xl">
						{/* Themed hero: the FINAL/WORD tiles tie the page back to the
                home screen so the roadmap reads as part of the game. */}
						<div className="mb-8 flex scale-[0.72] flex-col items-center gap-y-2 sm:scale-90">
							<Tile revealed={true} size="md" variant="correct" word="FINAL" />
							<Tile revealed={true} size="sm" variant="present" word="WORD" />
						</div>
						<article className="rounded-2xl border border-amber-200/60 bg-white/70 p-6 shadow-sm backdrop-blur-sm sm:p-8">
							<ReactMarkdown
								components={markdownComponents}
								remarkPlugins={[remarkGfm]}
							>
								{markdown}
							</ReactMarkdown>
						</article>
					</div>
				</div>
			</main>
		</>
	);
}
