/* The implementation twin of index.d.ts. The values are BUILT here rather
 * than written as literals, so a missing %init shows up as a wrong value
 * (or a NULL) and never as a constant the reader could have folded. */
const CHANNEL = "pbgen";

export const GEN_VERSION = CHANNEL + "-2.0.1";

export const GEN_LIMITS = Object.freeze({ frame: 60000 + 5535, retries: 2 + 3 });
