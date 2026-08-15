/* The LLVM backend's refusal: an IR construct outside the current tier.
 * `kind` is a stable machine-readable tag ("stmt:switch", "expr:closure",
 * "type:union", ...) — the differential harness histograms the next
 * phase's queue from it. Never catch-and-continue: any refusal aborts the
 * whole module. compile()'s DEFAULT lane catches exactly this error and
 * re-emits through the C backend (the transparent fallback); an explicit
 * backend "llvm" surfaces it as diagnostic SC3001 instead — the
 * fail-loudly pin. Its own module so the emitter and the shape/RC tables
 * can both throw it without an import cycle. */
import type { SrcLoc } from "../../ir/nodes.js";

export class LlvmUnsupportedError extends Error {
  constructor(
    readonly kind: string,
    readonly loc?: SrcLoc,
  ) {
    super(
      `the LLVM backend does not support this construct yet (${kind}); ` +
        `build with the reference C backend (--backend c, or the default's transparent fallback)`,
    );
    this.name = "LlvmUnsupportedError";
  }
}

/* ── the CENSUS instrument ──────────────────────────────────────────────
 *
 * A refusal aborts the module at the FIRST unhandled construct, so the
 * diagnostic a build prints is a lower bound of one: how much else is out
 * of tier is not knowable from it. For a program the size of zapo that is
 * the difference between "one afternoon" and "a different project", and
 * no instrument answered it.
 *
 * SCRIPTC_LLVM_CENSUS=1 turns the emitter's refusals into a COLLECTED
 * list: each statement and each function is attempted inside a recovery
 * boundary, the refusal is recorded with its construct tag and source
 * location, and the emit continues so the next one is reached too. One
 * build then enumerates the whole gap.
 *
 * Two properties keep this honest and keep it out of the product's way:
 *
 *  - it is OFF unless the environment variable is set, and the enabled
 *    check is the only thing a normal build pays (one boolean per
 *    statement, read once per module);
 *  - a census run NEVER yields a usable artifact. The recovered module is
 *    missing whole statements, so the emitter reports the census and then
 *    rethrows the first refusal — the build fails exactly as it would
 *    have, SC3001 and all. There is no lane in which census output can be
 *    linked, cached or shipped.
 *
 * Errors that are NOT refusals are recorded too, flagged `downstream`:
 * skipping a statement can leave a later one referring to a definition
 * that was never emitted, and a census that aborted on that cascade would
 * report less than the one refusal we already had. They are counted
 * separately and are never presented as tier gaps. */

export interface LlvmCensusRow {
  /** The refusal's construct tag, or `ice:<message>` for a downstream error. */
  readonly kind: string;
  /** Number of times this exact tag was recorded. */
  count: number;
  /** First source location seen for the tag, if the throw carried one. */
  loc?: SrcLoc;
  /** IR function name the first occurrence was recorded in. */
  fn: string;
  /** False for a real tier refusal, true for a knock-on error after one. */
  readonly downstream: boolean;
}

export function llvmCensusEnabled(): boolean {
  return process.env["SCRIPTC_LLVM_CENSUS"] === "1";
}

/** The per-module collector. One instance per emit; nothing is global, so
 * two modules compiled in one process cannot pollute each other's census. */
export class LlvmCensus {
  private readonly rows = new Map<string, LlvmCensusRow>();
  private first: LlvmUnsupportedError | undefined;

  record(err: unknown, fn: string, loc?: SrcLoc): void {
    const refusal = err instanceof LlvmUnsupportedError;
    if (refusal && this.first === undefined) this.first = err;
    const kind = refusal
      ? err.kind
      : `ice:${err instanceof Error ? err.message : String(err)}`;
    const existing = this.rows.get(kind);
    if (existing !== undefined) {
      existing.count++;
      if (existing.loc === undefined && refusal && err.loc !== undefined) existing.loc = err.loc;
      return;
    }
    this.rows.set(kind, {
      kind,
      count: 1,
      ...(refusal && err.loc !== undefined ? { loc: err.loc } : {}),
      fn,
      downstream: !refusal,
    });
  }

  get size(): number {
    return this.rows.size;
  }

  /** The refusal to rethrow so the build fails as it always would. */
  get firstRefusal(): LlvmUnsupportedError | undefined {
    return this.first;
  }

  /** One line per distinct construct, refusals first, each with its count
   * and the first source location that produced it. Machine-readable: the
   * fields are tab-separated after the leading marker. */
  report(): string {
    const all = [...this.rows.values()];
    const refusals = all.filter((r) => !r.downstream).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
    const ices = all.filter((r) => r.downstream).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
    const out: string[] = [];
    out.push(`SCRIPTC_LLVM_CENSUS: ${refusals.length} distinct tier refusals, ${ices.length} distinct downstream errors`);
    for (const r of refusals) {
      const at = r.loc ? `${r.loc.file}:${r.loc.start}` : "";
      out.push(`SCRIPTC_LLVM_CENSUS\tREFUSAL\t${r.count}\t${r.kind}\t${r.fn}\t${at}`);
    }
    for (const r of ices) {
      out.push(`SCRIPTC_LLVM_CENSUS\tDOWNSTREAM\t${r.count}\t${r.kind}\t${r.fn}\t`);
    }
    return out.join("\n");
  }
}
