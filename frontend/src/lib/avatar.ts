/** Signal's avatar tile colours, keyed by the names stored on the backend. */

export const AVATAR_COLORS: Record<string, string> = {
  blue: "#2C6BED",
  ultramarine: "#3A76F0",
  indigo: "#6058CA",
  plum: "#AA377A",
  crimson: "#CF163E",
  vermilion: "#C73F0A",
  burlap: "#6F6A58",
  forest: "#3B7845",
  wintergreen: "#1D8663",
  teal: "#077D92",
  taupe: "#8F616A",
  steel: "#71717F",
};

export const AVATAR_COLOR_NAMES = Object.keys(AVATAR_COLORS);

export function avatarColor(name: string | null | undefined): string {
  if (name && AVATAR_COLORS[name]) return AVATAR_COLORS[name];
  return AVATAR_COLORS.ultramarine;
}

/** Deterministic pick so a new account still gets a varied tile. */
export function colorForSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLOR_NAMES[hash % AVATAR_COLOR_NAMES.length];
}
