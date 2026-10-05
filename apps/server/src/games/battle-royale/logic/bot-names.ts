// Human-looking display names for bots so a lobby reads like a room full of
// real people rather than "bot0", "bot1", … IMPORTANT: these are DISPLAY names
// only. Bots are still keyed `bot0`/`bot1`/… everywhere (that key is how the
// server distinguishes bots from real players via the UUID regex in handlers.ts
// and stats.ts). Never use these names as ids/keys.

const FIRST_NAMES: readonly string[] = [
  "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery",
  "Quinn", "Parker", "Reese", "Rowan", "Sawyer", "Emerson", "Finley", "Hayden",
  "Jesse", "Kai", "Logan", "Micah", "Noah", "Owen", "Peyton", "Sage",
  "Blake", "Cameron", "Devon", "Elliot", "Harper", "Jade", "Kendall", "Lane",
  "Marley", "Nico", "Oakley", "Phoenix", "Remy", "Skyler", "Tatum", "Wren",
  "Amara", "Bianca", "Carlos", "Diego", "Elena", "Farah", "Gabriel", "Hana",
  "Ibrahim", "Jasmine", "Kenji", "Leila", "Mateo", "Nadia", "Omar", "Priya",
  "Rafael", "Sofia", "Tariq", "Yuki", "Zara", "Aiden", "Bella", "Caleb",
  "Daria", "Ethan", "Fiona", "Grace", "Henry", "Isla", "Jonah", "Kira",
  "Liam", "Maya", "Nolan", "Olivia", "Petra", "Rhys", "Simone", "Theo",
];

const LAST_NAMES: readonly string[] = [
  "Carter", "Reyes", "Nguyen", "Patel", "Kim", "Rossi", "Silva", "Haddad",
  "Novak", "Flynn", "Okafor", "Mendez", "Larsen", "Costa", "Ferraro", "Ortega",
  "Walsh", "Bauer", "Hughes", "Kowalski", "Delgado", "Fischer", "Montes", "Park",
  "Rivera", "Sato", "Toth", "Vargas", "Weaver", "Yusuf", "Abbott", "Blanco",
  "Cho", "Dalton", "Everett", "Franco", "Greer", "Holt", "Ingram", "Jansen",
  "Keller", "Lambert", "Marsh", "Navarro", "Osei", "Pierce", "Quintero", "Rhodes",
  "Sharma", "Tran", "Underwood", "Vega", "Whitaker", "Xu", "Yates", "Zimmer",
  "Barnes", "Chen", "Diaz", "Ellis", "Foster", "Gomez", "Hassan", "Ivanov",
];

/**
 * Fisher-Yates shuffle (in place) of a copy — never mutates the source pool.
 */
const shuffled = <T>(source: readonly T[]): T[] => {
  const out = source.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

/**
 * Returns `count` human-looking "First Last" names, unique within the returned
 * batch (so no two bots in the same lobby share a name as long as the pool is
 * large enough; it comfortably covers a full 99-player field). If `count`
 * somehow exceeds the number of unique first/last pairs available, it falls
 * back to appending a numeric suffix so the result is always exactly `count`
 * names and still collision-free.
 */
export const generateBotNames = (count: number): string[] => {
  const firsts = shuffled(FIRST_NAMES);
  const lasts = shuffled(LAST_NAMES);
  const used = new Set<string>();
  const names: string[] = [];

  let i = 0;
  while (names.length < count) {
    const first = firsts[i % firsts.length] as string;
    // Offset the last-name index by how many full passes we've made over the
    // first names, so we walk different first/last pairings instead of locking
    // the same pairs together each cycle.
    const lap = Math.floor(i / firsts.length);
    const last = lasts[(i + lap) % lasts.length] as string;
    i += 1;

    let name = `${first} ${last}`;
    if (used.has(name)) {
      // Extremely large lobby exhausted unique pairs: disambiguate numerically.
      name = `${first} ${last} ${used.size}`;
    }
    used.add(name);
    names.push(name);
  }

  return names;
};
