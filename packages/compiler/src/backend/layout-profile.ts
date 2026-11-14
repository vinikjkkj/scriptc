/* Turns a --layout-profile run's log into the order file --layout-order reads (see runtime/src/scr_layout_prof.c for the log).
 *
 * The log holds, per epoch, the address of each function's first entry (relative to the image base). Epochs are separated by
 * SIGUSR1 during the profiled run, so a function's LAST epoch says how late in the run it was still needed: the order is
 *     last epoch (highest first)  ->  the steady set, then what stopped being needed earlier, down to startup-only (epoch 0 only)
 * and inside one tier the order the functions were first reached in that epoch. What the log never saw is cold and is simply not
 * listed (the consumer puts unlisted functions last). Symbols come from `nm` (binutils or llvm-nm): the binary is the one that ran. */
import { execFileSync } from "node:child_process";

interface Sym {
  addr: number;
  size: number;
  name: string;
}

function readSymbols(exe: string): Sym[] {
  let out = "";
  const tried: string[] = [];
  for (const tool of ["nm", "llvm-nm"]) {
    try {
      out = execFileSync(tool, ["-S", "--defined-only", exe], { encoding: "utf8", maxBuffer: 1 << 30 });
      break;
    } catch {
      tried.push(tool);
    }
  }
  if (out === "") throw new Error(`layout-order: could not read symbols of ${exe} (tried ${tried.join(", ")})`);
  const syms: Sym[] = [];
  for (const line of out.split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p.length !== 4) continue;
    const kind = p[2]!;
    if (kind !== "t" && kind !== "T" && kind !== "w" && kind !== "W") continue;
    syms.push({ addr: parseInt(p[0]!, 16), size: parseInt(p[1]!, 16), name: p[3]! });
  }
  syms.sort((a, b) => a.addr - b.addr);
  return syms;
}

function symbolAt(syms: readonly Sym[], addr: number): string | undefined {
  let lo = 0;
  let hi = syms.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (syms[mid]!.addr <= addr) lo = mid + 1;
    else hi = mid - 1;
  }
  const s = syms[hi];
  if (s === undefined) return undefined;
  return addr < s.addr + Math.max(s.size, 1) ? s.name : undefined;
}

export function layoutOrderFromProfile(exe: string, profile: string): string {
  const lines = profile.split("\n");
  const head = /^# scr-layout-profile 1 base=([0-9a-f]+) guards=(\d+) epochs=(\d+)/.exec(lines[0] ?? "");
  if (head === null) throw new Error("layout-order: not a scr-layout-profile v1 file");
  const base = parseInt(head[1]!, 16);
  const entries: { epoch: number; off: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const m = /^(\d+) ([0-9a-f]+)$/.exec(lines[i]!);
    if (m !== null) entries.push({ epoch: Number(m[1]), off: parseInt(m[2]!, 16) });
  }
  const syms = readSymbols(exe);
  // A PIE's symbols are image-relative (offset = address); a fixed-address executable's are absolute (base + offset).
  const hits = (shift: number): number => {
    let n = 0;
    for (const e of entries.slice(0, 200)) if (symbolAt(syms, e.off + shift) !== undefined) n++;
    return n;
  };
  const shift = hits(0) >= hits(base) ? 0 : base;
  const last = new Map<string, { epoch: number; first: number }>();
  entries.forEach((e, idx) => {
    const name = symbolAt(syms, e.off + shift);
    if (name === undefined) return;
    const cur = last.get(name);
    if (cur === undefined || e.epoch > cur.epoch) last.set(name, { epoch: e.epoch, first: idx });
  });
  const ordered = [...last.entries()].sort((a, b) => (a[1].epoch !== b[1].epoch ? b[1].epoch - a[1].epoch : a[1].first - b[1].first));
  const out: string[] = [`# scriptc layout order: ${ordered.length} functions, last-epoch tiers (highest first = steady set; epoch 0 only = startup-only)`];
  let tier = -1;
  for (const [name, v] of ordered) {
    if (v.epoch !== tier) {
      tier = v.epoch;
      out.push(`# tier: last executed in epoch ${tier}`);
    }
    out.push(name);
  }
  return out.join("\n") + "\n";
}
