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
  const named: { epoch: number; name: string }[] = [];
  for (const e of entries) {
    const name = symbolAt(syms, e.off + shift);
    if (name !== undefined) named.push({ epoch: e.epoch, name });
  }
  return layoutOrderText(named, Number(head[3]));
}

/** The order file text for a run's named first-entries (in log order), `epochs` epochs long.
 *
 * Up to two epochs (startup, steady): last epoch highest first. From three on, the LAST epoch is the END phase (what the program does after the
 * steady state: shutdown, the final requests) and the epochs between are the steady state, so the tiers are
 *     steady        executed in any epoch from 1 to epochs-2 (placed first)
 *     end           executed in the last epoch and in no steady epoch (placed after it)
 *     startup-only  executed in epoch 0 only
 * Ordering "last epoch first" there would put every steady function that also runs at shutdown ahead of the steady-only ones and tell nothing about what is
 * shutdown-only. Inside a tier: the order the functions were first reached (in the epoch range of the tier). */
export function layoutOrderText(named: readonly { epoch: number; name: string }[], epochs: number): string {
  if (epochs >= 3) {
    const last = epochs - 1;
    const info = new Map<string, { steady: number; end: number; any0: boolean }>();
    named.forEach((e, idx) => {
      const cur = info.get(e.name) ?? { steady: -1, end: -1, any0: false };
      if (e.epoch >= 1 && e.epoch <= last - 1) { if (cur.steady < 0) cur.steady = idx; }
      else if (e.epoch === last) { if (cur.end < 0) cur.end = idx; }
      else cur.any0 = true;
      info.set(e.name, cur);
    });
    const steady = [...info.entries()].filter(([, v]) => v.steady >= 0).sort((a, b) => a[1].steady - b[1].steady).map(([n]) => n);
    const end = [...info.entries()].filter(([, v]) => v.steady < 0 && v.end >= 0).sort((a, b) => a[1].end - b[1].end).map(([n]) => n);
    const startup = [...info.entries()].filter(([, v]) => v.steady < 0 && v.end < 0).map(([n]) => n);
    const out = [`# scriptc layout order: ${info.size} functions, tiers: steady (epochs 1..${last - 1}), end (epoch ${last} only), startup-only (epoch 0 only)`];
    for (const [title, names] of [["steady", steady], ["end", end], ["startup-only", startup]] as const) {
      out.push(`# tier: ${title}`);
      out.push(...names);
    }
    return out.join("\n") + "\n";
  }
  const last = new Map<string, { epoch: number; first: number }>();
  named.forEach((e, idx) => {
    const cur = last.get(e.name);
    if (cur === undefined || e.epoch > cur.epoch) last.set(e.name, { epoch: e.epoch, first: idx });
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
