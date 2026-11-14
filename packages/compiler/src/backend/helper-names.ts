/* STABLE NAMES FOR THE EMITTERS' COUNTER-NAMED HELPERS.
 *
 * The emitters intern many helpers (static-to-dyn converters sc_td_N, dyn builders sc_dc_N, arm builders sc_da_N, matchers, union walkers,
 * view tables, closure thunks ...) and used to name each `prefix_<size of its map>`: first-seen order, so one cast added early in a
 * program renumbered every helper after it, and a symbol-keyed profile or section-ordering file went stale. A helper is now named
 * `prefix_<6 base-36 chars>` from what it IS: its prefix and the key its map already interns it under (a typeKey, a union id, a shape id
 * plus a type, a class name), with every record and union id in that key replaced by a bounded-depth, memoised structural digest of the
 * shape (the frontend assigns the ids as first-seen counters, so the ids themselves cannot name anything). Two helpers that hash alike get
 * a numeric suffix in the order they are requested; with SCRIPTC_STABLE_NAMES=0 every name is the old counter. */
import { typeKey } from "../ir/nodes.js";
import type { IrRecordShape, IrType, IrUnionDef } from "../ir/nodes.js";

/** 6 base-36 characters (about 2.1e9 values) of an FNV-1a hash. */
export function hash6(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, "0").slice(-6);
}

const ID = /\b([ru])(\d+)\b/g;
const DEPTH = 3;

export class HelperNamer {
  private readonly digests = new Map<string, string>();
  private readonly seen = new Map<string, number>();
  private readonly enabled = process.env["SCRIPTC_STABLE_NAMES"] !== "0";

  constructor(
    private readonly record: (id: string) => IrRecordShape | undefined,
    private readonly union: (id: string) => IrUnionDef | undefined,
  ) {}

  /** `key` with every record/union id replaced by the shape's structural digest (to a bounded depth). */
  private norm(key: string, depth: number): string {
    return key.replace(ID, (m: string, k: string, n: string) => {
      if (depth >= DEPTH) return "#";
      const id = k + n;
      const mem = this.digests.get(id + "@" + depth);
      if (mem !== undefined) return mem;
      let d: string;
      if (k === "r") {
        const s = this.record(id);
        d = s === undefined ? m : "R" + hash6((s.view ? "view|" : "") + (s.tuple ? "tuple|" : "") + s.fields.map((f) => JSON.stringify(f.name) + ":" + this.norm(typeKey(f.type), depth + 1)).join(","));
      } else {
        const u = this.union(id);
        d = u === undefined ? m : "U" + hash6(u.arms.map((a: IrType) => this.norm(typeKey(a), depth + 1)).sort().join("|"));
      }
      this.digests.set(id + "@" + depth, d);
      return d;
    });
  }

  /** A token `r<decimal>` for every record shape, from its structural digest (decimal digits so tools that read `r\d+` out of a symbol
   * still do); shapes whose digests clash take `_k` in the order the module lists them. null when the counter names are asked for. */
  shapeTokens(records: readonly IrRecordShape[]): Map<string, string> | null {
    if (!this.enabled) return null;
    const out = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const r of records) {
      const h = this.norm(`record:${r.id}`, 0).replace(/^record:R/, "");
      const base = "r" + String(parseInt(h, 36));
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.set(r.id, n === 0 ? base : `${base}_${n}`);
    }
    return out;
  }

  /** The name of the helper `prefix` (e.g. "sc_td") interned under `key`; `counter` is the old first-seen number. */
  name(prefix: string, key: string, counter: number): string {
    if (!this.enabled) return `${prefix}_${counter}`;
    const base = `${prefix}_${hash6(prefix + "|" + this.norm(key, 0))}`;
    // a hash clash (distinct keys whose structure digests alike) is told apart by the order the keys are requested; the count keeps
    // this O(1) however many keys share a digest
    const n = this.seen.get(base) ?? 0;
    this.seen.set(base, n + 1);
    return n === 0 ? base : `${base}_${n}`;
  }
}
