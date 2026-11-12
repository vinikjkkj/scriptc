/* THE FIBER-LANE CENSUS. With SCRIPTC_NO_FIBERS=1 the emitters fail the build, listing every function they would still give a fiber (an async
 * function or generator with no stackless lowering on that backend) and why. It is the deletion safety net of the fiber runtime: a program that
 * compiles under it references no scr_async_spawn / scr_gen_new / scr_agen_new. */
export interface FiberLaneUse {
  fn: string;
  reason: string;
}

export function fiberCensusEnabled(): boolean {
  return true;
}

/** Throws one error naming every fiber-lane function when the census is on and any exists. */
export function failOnFiberLane(backend: string, uses: readonly FiberLaneUse[]): void {
  if (!fiberCensusEnabled() || uses.length === 0) return;
  throw new Error(
    `fiber lane in use on the ${backend} backend (SCRIPTC_NO_FIBERS=1), ${uses.length} function(s):\n` +
      uses.map((u) => `  FIBERLANE\t${u.fn}\t${u.reason}`).join("\n"),
  );
}
