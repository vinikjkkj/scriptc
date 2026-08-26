/* The armed pair, both discovered TRANSITIVELY and both attempted in the
 * same expansion round: 'hub/util' has a source twin and must map to it,
 * 'hub/ghost' is exported by the published package and has NO twin in the
 * attested tree, so it must map to NOTHING and be named in the notes.
 *
 * A fixed point that maps a late-discovered subpath to the wrong file is
 * silent where the island refusal is loud, so the negative is the half
 * that matters: planting attested-src/hub/src/ghost/index.ts makes the
 * test fail, which is the only reason to believe it when it passes. */
import { GHOST } from "hub/ghost";
import { shoutHub } from "hub/util";

export const MARK = shoutHub(GHOST);
