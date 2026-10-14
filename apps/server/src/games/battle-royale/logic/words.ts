// Battle Royale SECRET word source. BR is fixed at 5-letter words, so it draws
// from the shared curated five-letter guess/answer pool (`shared/words.ts`) —
// the single source of truth both game modes share. Guess spell-checking is a
// separate concern handled client-side against the larger spell-check lexicon
// (`shared/spell-check-words.ts`).
//
// Re-exported as the default so existing `import words from "./words.js"`
// consumers are unchanged.
import { FIVE_LETTER_GUESS_WORDS } from "shared/words.js";

const words: readonly string[] = FIVE_LETTER_GUESS_WORDS;

export default words;
