/* 'hub/util' is imported by NOTHING the driver names. It is reached only
 * from spoke's source, which the pipeline does not walk until hub's entry
 * table has already been built — so this file is the first thing the old
 * one-shot table could never see. It in turn imports a subpath of spoke,
 * which is how the discovery goes back and forth. */
import { EXTRA } from "spoke/extra";

export function shoutHub(s: string): string {
  return s.toUpperCase() + EXTRA;
}
