#!/usr/bin/env node
// dyncensus.mjs — read a tests/perf/dyncensus report and render the map of
// what the live ScrDyn population actually holds.
//
//   node dyncensus.mjs <report.txt> [--json]
//   node dyncensus.mjs --self-test
//
// It REFUSES rather than summarises when any control failed. The controls
// are not decoration: this lane exists to price a representation change, and
// a per-object figure that is quietly 20% short would be an argument for the
// wrong change. Every refusal below corresponds to a way the instrument can
// be wrong that produces a plausible number rather than an obvious one.

import { readFileSync } from "node:fs";

const KIND_NAMES = [
  "NULL", "BOOL", "NUM", "STR", "ARR", "OBJ", "BYTES", "ARRBUF", "FUNC",
  "HANDLE", "PROMISE", "JSVAL", "OBJINST", "BIG", "MAP",
];
const ARM_ROW = 31; // the synthetic kind the arm plants; no ScrDynKind can be it
const BUCKET_LABELS = ["0", "1", "2", "3", "4", "5-8", "9-16", "17-32", "33-64", "65+"];

export function parse(text) {
  const r = {
    layout: null, arm: new Map(), counts: new Map(),
    peak: new Map(), exit: new Map(), curve: [], total: null,
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sp = line.split(/\s+/);
    const tag = sp[0];
    if (tag === "DYNCEN-LAYOUT") { r.layout = kv(sp.slice(1)); continue; }
    if (tag === "DYNCEN-ARM") { r.arm.set(+sp[1], +sp[2]); continue; }
    if (tag === "DYNCEN-COUNT") {
      r.counts.set(+sp[1], { alloc: +sp[2], dead: +sp[3], live: +sp[4] });
      continue;
    }
    if (tag === "DYNCEN-PEAK" || tag === "DYNCEN-EXIT") {
      const into = tag === "DYNCEN-PEAK" ? r.peak : r.exit;
      const row = kv(sp.slice(2));
      row.lenHist = null; row.strHist = null;
      into.set(+sp[1], row);
      continue;
    }
    if (tag === "DYNCEN-PEAK-LEN" || tag === "DYNCEN-EXIT-LEN") {
      const into = tag === "DYNCEN-PEAK-LEN" ? r.peak : r.exit;
      const row = into.get(+sp[1]);
      if (row) row.lenHist = sp.slice(2).map(Number);
      continue;
    }
    if (tag === "DYNCEN-PEAK-STRLEN" || tag === "DYNCEN-EXIT-STRLEN") {
      const into = tag === "DYNCEN-PEAK-STRLEN" ? r.peak : r.exit;
      const row = into.get(+sp[1]);
      if (row) row.strHist = sp.slice(2).map(Number);
      continue;
    }
    if (tag === "DYNCEN-CURVE") {
      r.curve.push({ i: +sp[1], ord: +sp[2], live: +sp[3], t: +sp[4] });
      continue;
    }
    if (tag === "DYNCEN-TOTAL") { r.total = kv(sp.slice(1)); continue; }
  }
  return r;
}

function kv(parts) {
  const o = {};
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i)] = Number(p.slice(i + 1));
  }
  return o;
}

/** Every control. Returns a list of REFUSAL strings; empty means believed. */
export function check(r) {
  const bad = [];
  const T = r.total, L = r.layout;
  if (!T) return ["no DYNCEN-TOTAL line: the report is truncated or the run did not reach its exit hook"];
  if (!L) return ["no DYNCEN-LAYOUT line"];

  // 1. the instrument did not overflow or lose anything
  if (T.lost > 0) bad.push(`lost=${T.lost}: a kind index at or beyond the row table — the enum grew past SCR_DYNCEN_KINDS`);
  if (T.ptrLost > 0) bad.push(`ptrLost=${T.ptrLost}: the live-pointer table overflowed, so the walk saw fewer objects than the program held`);
  if (T.deadUnknown > 0) bad.push(`deadUnknown=${T.deadUnknown}: a dyn reached a death hook the alloc hooks never saw — the hook set is incomplete`);

  // 2. the layout came from the BUILD, not from this reader
  for (const k of ["sizeofDyn", "sizeofHdr", "sizeofEntry", "sizeofStr", "offUnion", "sizeofUnion", "kindCount"])
    if (!(L[k] > 0)) bad.push(`layout.${k} is ${L[k]}: the constructor that stamps the build's own sizes did not run`);
  if (L.offUnion + L.sizeofUnion !== L.sizeofDyn)
    bad.push(`offUnion(${L.offUnion}) + sizeofUnion(${L.sizeofUnion}) != sizeofDyn(${L.sizeofDyn}): the union is not the last member, or one of the three is stale`);
  if (L.kindCount > 31)
    bad.push(`kindCount=${L.kindCount} collides with the arm row ${ARM_ROW}`);

  // 3. the arm: a planted population must come back exactly, and the frees
  //    must have gone through the POINTER TABLE rather than been counted.
  const armCount = r.counts.get(ARM_ROW);
  if (!armCount || armCount.alloc === 0) {
    bad.push(`no arm: build with -DSCR_DYNCEN_ARM=N. Without it nothing here has been shown to work.`);
  } else {
    const n = armCount.alloc;
    if (armCount.dead !== Math.floor(n / 2))
      bad.push(`arm deaths ${armCount.dead} != ${Math.floor(n / 2)}`);
    if (armCount.live !== n - Math.floor(n / 2))
      bad.push(`arm live ${armCount.live} != ${n - Math.floor(n / 2)}`);
    if (T.armN !== n - Math.floor(n / 2))
      bad.push(`armN ${T.armN} != ${n - Math.floor(n / 2)}`);
    const armExit = r.exit.get(ARM_ROW);
    if (!armExit) bad.push(`the exit WALK found no arm row: the counters and the walk disagree`);
    else {
      if (armExit.n !== armCount.live)
        bad.push(`arm walk n=${armExit.n} != counter live=${armCount.live}: the walk and the alloc/dead path disagree`);
      if (armExit.rcMax !== 3) bad.push(`arm rcMax=${armExit.rcMax} != 3: the walk is not reading the objects it counted`);
      if (armExit.rcSum !== 3 * armCount.live) bad.push(`arm rcSum=${armExit.rcSum} != ${3 * armCount.live}`);
      if (armExit.fBuf !== armCount.live) bad.push(`arm fBuf=${armExit.fBuf} != ${armCount.live}: the flag byte the arm set did not come back`);
    }
  }

  // 4. the walk agrees with the counters, per kind, at exit. This is the
  //    control that catches a table that silently dropped entries: the
  //    cheap counters never touch it and the walk is nothing but it.
  for (const [k, c] of r.counts) {
    if (c.alloc === 0) continue;
    if (c.alloc - c.dead !== c.live)
      bad.push(`kind ${name(k)}: alloc(${c.alloc}) - dead(${c.dead}) != live(${c.live})`);
    const w = r.exit.get(k);
    const wn = w ? w.n : 0;
    if (wn !== c.live)
      bad.push(`kind ${name(k)}: exit walk n=${wn} != counter live=${c.live}`);
  }
  let liveSum = 0, allocSum = 0, deadSum = 0;
  for (const c of r.counts.values()) { liveSum += c.live; allocSum += c.alloc; deadSum += c.dead; }
  if (allocSum !== T.allocs) bad.push(`per-kind allocs ${allocSum} != total ${T.allocs}`);
  if (deadSum !== T.deaths) bad.push(`per-kind deaths ${deadSum} != total ${T.deaths}`);
  if (liveSum !== T.liveN) bad.push(`per-kind live ${liveSum} != total liveN ${T.liveN}`);
  if (T.allocs - T.deaths !== T.liveN) bad.push(`allocs - deaths != liveN`);

  // 5. the snapshot really is at the peak, within the band it printed
  if (!(T.snaps > 0)) bad.push(`snaps=0: no per-kind snapshot was ever taken`);
  const band = Math.max(T.snapBand, Math.floor(T.snapN / 256));
  if (T.livePeak - T.snapN > band)
    bad.push(`the snapshot is ${T.livePeak - T.snapN} objects below the peak ${T.livePeak}, outside its own band ${band}`);
  let peakSum = 0;
  for (const row of r.peak.values()) peakSum += row.n;
  if (peakSum !== T.snapN)
    bad.push(`the PEAK rows sum to ${peakSum} but the snapshot was taken at liveN=${T.snapN}`);

  // 6. a row with objects but no arm width is a kind the stamp forgot
  for (const [k, row] of r.peak) {
    if (k === ARM_ROW || row.n === 0) continue;
    if (!r.arm.has(k)) bad.push(`kind ${name(k)} has ${row.n} live objects and no recorded union-arm width`);
  }

  // 7. per-row internal consistency: a length sum cannot exceed a capacity
  //    sum, and a histogram must sum to the row's own n.
  for (const [tag, rows] of [["PEAK", r.peak], ["EXIT", r.exit]]) {
    for (const [k, row] of rows) {
      if (k === ARM_ROW) continue;
      if (row.lenSum > row.capSum)
        bad.push(`${tag} ${name(k)}: lenSum ${row.lenSum} > capSum ${row.capSum}`);
      if (row.lenMax > row.capMax)
        bad.push(`${tag} ${name(k)}: lenMax ${row.lenMax} > capMax ${row.capMax}`);
      if (row.lenHist) {
        const s = row.lenHist.reduce((a, b) => a + b, 0);
        if (s !== 0 && s !== row.n)
          bad.push(`${tag} ${name(k)}: length histogram sums to ${s}, row n is ${row.n}`);
      }
      if (row.strHist) {
        const s = row.strHist.reduce((a, b) => a + b, 0);
        if (s !== 0 && s + row.emptyBuf !== row.n)
          bad.push(`${tag} ${name(k)}: string histogram sums to ${s} (+${row.emptyBuf} empty), row n is ${row.n}`);
      }
    }
  }
  return bad;
}

function name(k) { return k === ARM_ROW ? "ARM" : (KIND_NAMES[k] ?? `kind${k}`); }
const n = (x) => Number(x).toLocaleString("en-US");
const pct = (a, b) => (b === 0 ? "—" : (100 * a / b).toFixed(2) + "%");

export function render(r) {
  const L = r.layout, T = r.total;
  const phys = L.sizeofDyn + L.sizeofHdr;
  const armN = T.armN || 0;
  const out = [];
  out.push(`LAYOUT  sizeof(ScrDyn)=${L.sizeofDyn}  +ScrCycHdr ${L.sizeofHdr} = ${phys} physical`);
  out.push(`        union at +${L.offUnion}, ${L.sizeofUnion} wide; head ${L.offUnion} B; ScrDynEntry ${L.sizeofEntry} B; ScrStr ${L.sizeofStr} B`);
  out.push(`RUN     allocs=${n(T.allocs)} deaths=${n(T.deaths)} liveAtExit=${n(T.liveN)} livePeak=${n(T.livePeak)}`);
  out.push(`        snapshot at liveN=${n(T.snapN)} (alloc #${n(T.snapOrd)}, t=${T.snapT}s), band ${T.snapBand}, ${T.snaps} snapshots, ${n(T.walkReads)} object reads`);
  out.push(`        arm=${armN} objects (subtracted from every figure below); instrument tables ${n(T.tableBytes)} B of BSS`);
  out.push("");

  for (const [tag, rows] of [["AT THE PEAK", r.peak], ["AT EXIT", r.exit]]) {
    const live = [...rows.entries()].filter(([k, v]) => k !== ARM_ROW && v.n > 0);
    const tot = live.reduce((a, [, v]) => a + v.n, 0);
    out.push(`── ${tag}: ${n(tot)} live ScrDyn, ${n(tot * phys)} B of ScrDyn blocks`);
    out.push(`kind      objects      %   armB  deadUnion    sideB   keyB    strB   total B      %`);
    const ranked = live.map(([k, v]) => {
      const arm = r.arm.get(k) ?? 0;
      const dead = (L.sizeofUnion - arm) * v.n;      // union bytes this kind never reads
      const side = v.side;                            // entries/items buffers
      const key = v.keyBytes;                         // pooled key bytes
      const str = v.strPhys;                          // ScrStr blocks, per reference
      return { k, v, arm, dead, side, key, str, total: v.n * phys + side + key + str };
    }).sort((a, b) => b.total - a.total);
    const grand = ranked.reduce((a, x) => a + x.total, 0);
    for (const x of ranked) {
      out.push(
        `${name(x.k).padEnd(8)} ${n(x.v.n).padStart(8)} ${pct(x.v.n, tot).padStart(7)} ` +
        `${String(x.arm).padStart(5)} ${n(x.dead).padStart(10)} ${n(x.side).padStart(8)} ` +
        `${n(x.key).padStart(6)} ${n(x.str).padStart(7)} ${n(x.total).padStart(9)} ${pct(x.total, grand).padStart(7)}`);
    }
    out.push(`${"TOTAL".padEnd(8)} ${n(tot).padStart(8)} ${"".padStart(7)} ${"".padStart(5)} ` +
      `${n(ranked.reduce((a, x) => a + x.dead, 0)).padStart(10)} ` +
      `${n(ranked.reduce((a, x) => a + x.side, 0)).padStart(8)} ` +
      `${n(ranked.reduce((a, x) => a + x.key, 0)).padStart(6)} ` +
      `${n(ranked.reduce((a, x) => a + x.str, 0)).padStart(7)} ${n(grand).padStart(9)}`);
    out.push("");
  }

  const peakObj = r.peak.get(5), peakArr = r.peak.get(4), peakStr = r.peak.get(3), peakFn = r.peak.get(8);
  if (peakObj) {
    out.push(`OBJ at the peak: ${n(peakObj.n)} objects, ${n(peakObj.lenSum)} members (${(peakObj.lenSum / peakObj.n).toFixed(2)} avg, max ${peakObj.lenMax}), ` +
      `cap sum ${n(peakObj.capSum)} (max ${peakObj.capMax}), entries buffers ${n(peakObj.side)} B, ${n(peakObj.emptyBuf)} with no buffer at all`);
    out.push(`   extras non-NULL: proto ${n(peakObj.proto)} (${pct(peakObj.proto, peakObj.n)})  cname ${n(peakObj.cname)} (${pct(peakObj.cname, peakObj.n)})  ` +
      `hidden ${n(peakObj.hidden)} (${pct(peakObj.hidden, peakObj.n)})  slots ${n(peakObj.slots)} (${pct(peakObj.slots, peakObj.n)})  ANY ${n(peakObj.anyExtra)} (${pct(peakObj.anyExtra, peakObj.n)})`);
    out.push(`   keys: ${n(peakObj.keyN)} keys, ${n(peakObj.keyBytes)} pooled B, max ${peakObj.keyMax}; <=7 ${pct(peakObj.keyLe7, peakObj.keyN)}  <=15 ${pct(peakObj.keyLe15, peakObj.keyN)}  <=23 ${pct(peakObj.keyLe23, peakObj.keyN)}  <=31 ${pct(peakObj.keyLe31, peakObj.keyN)}`);
    if (peakObj.lenHist) out.push(`   member counts: ` + peakObj.lenHist.map((c, i) => `${BUCKET_LABELS[i]}:${n(c)}`).join("  "));
    out.push(`   flags: buffer ${n(peakObj.fBuf)}  nullProto ${n(peakObj.fNullProto)}  staticCopy ${n(peakObj.fStaticCopy)};  rcMax ${peakObj.rcMax}, rc avg ${(peakObj.rcSum / peakObj.n).toFixed(2)}`);
  }
  if (peakArr && peakArr.n) {
    out.push(`ARR at the peak: ${n(peakArr.n)} arrays, ${n(peakArr.lenSum)} elements (${(peakArr.lenSum / peakArr.n).toFixed(2)} avg, max ${peakArr.lenMax}), cap max ${peakArr.capMax}, items buffers ${n(peakArr.side)} B`);
    if (peakArr.lenHist) out.push(`   element counts: ` + peakArr.lenHist.map((c, i) => `${BUCKET_LABELS[i]}:${n(c)}`).join("  "));
  }
  if (peakStr && peakStr.n) {
    out.push(`STR at the peak: ${n(peakStr.n)} boxes, ${n(peakStr.strPhys)} B of ScrStr blocks counted per REFERENCE (shared strings are counted once per box, which is what an inline representation would have to replace), max len ${peakStr.strLenMax}`);
    out.push(`   len <=7 ${pct(peakStr.strLe7, peakStr.n)}  <=15 ${pct(peakStr.strLe15, peakStr.n)}  <=23 ${pct(peakStr.strLe23, peakStr.n)}  <=31 ${pct(peakStr.strLe31, peakStr.n)}`);
    if (peakStr.strHist) out.push(`   lengths: ` + peakStr.strHist.map((c, i) => `${BUCKET_LABELS[i]}:${n(c)}`).join("  "));
  }
  if (peakFn && peakFn.n) {
    out.push(`FUNC at the peak: ${n(peakFn.n)} boxes; sig ${n(peakFn.fnSig)}  name ${n(peakFn.fnName)}  src ${n(peakFn.fnSrc)}  arityMax ${peakFn.fnArityMax}`);
  }
  out.push("");
  out.push(`MAXIMA a narrowing would have to survive (this run only — a bound, not a proof):`);
  const maxima = { rc: 0, objLen: 0, objCap: 0, arrLen: 0, arrCap: 0, keyLen: 0, strLen: 0, arity: 0 };
  for (const rows of [r.peak, r.exit]) for (const [k, v] of rows) {
    if (k === ARM_ROW) continue;
    maxima.rc = Math.max(maxima.rc, v.rcMax);
    if (k === 5) { maxima.objLen = Math.max(maxima.objLen, v.lenMax); maxima.objCap = Math.max(maxima.objCap, v.capMax); maxima.keyLen = Math.max(maxima.keyLen, v.keyMax); }
    if (k === 4) { maxima.arrLen = Math.max(maxima.arrLen, v.lenMax); maxima.arrCap = Math.max(maxima.arrCap, v.capMax); }
    if (k === 3) maxima.strLen = Math.max(maxima.strLen, v.strLenMax);
    if (k === 8) maxima.arity = Math.max(maxima.arity, v.fnArityMax);
  }
  out.push(`   ` + Object.entries(maxima).map(([k, v]) => `${k}=${n(v)}`).join("  "));
  if (r.curve.length) {
    out.push("");
    out.push(`CURVE (live ScrDyn by allocation ordinal):`);
    const seen = new Map();
    for (const c of r.curve) if (!seen.has(c.t) || seen.get(c.t).live < c.live) seen.set(c.t, c);
    for (const [t, c] of [...seen].slice(0, 12))
      out.push(`   t=${String(t).padStart(3)}s  ord=${n(c.ord).padStart(8)}  live=${n(c.live).padStart(8)}  ${pct(c.live, T.livePeak)} of peak`);
  }
  return out.join("\n");
}

/* ── self-test ─────────────────────────────────────────────────────────
 * Seven negative controls and one positive. Each negative is a way this
 * instrument can be WRONG while still printing a plausible table, and the
 * reader must refuse rather than render it. */
function base() {
  const lines = [
    "DYNCEN-LAYOUT sizeofDyn=72 sizeofHdr=16 sizeofEntry=24 sizeofStr=24 offUnion=16 sizeofUnion=56 kindCount=15",
    "DYNCEN-ARM 3 8", "DYNCEN-ARM 4 24", "DYNCEN-ARM 5 56",
    "DYNCEN-COUNT 3 30 10 20", "DYNCEN-COUNT 5 60 10 50", `DYNCEN-COUNT ${ARM_ROW} 64 32 32`,
  ];
  const row = (tag, k, o) => {
    const d = {
      n: 0, rcSum: 0, rcMax: 0, fBuf: 0, fNullProto: 0, fStaticCopy: 0, lenSum: 0, capSum: 0,
      lenMax: 0, capMax: 0, side: 0, emptyBuf: 0, proto: 0, cname: 0, hidden: 0, slots: 0,
      anyExtra: 0, keyN: 0, keyBytes: 0, keyMax: 0, keyLe7: 0, keyLe15: 0, keyLe23: 0,
      keyLe31: 0, strLenSum: 0, strLenMax: 0, strPhys: 0, strLe7: 0, strLe15: 0, strLe23: 0,
      strLe31: 0, fnSig: 0, fnName: 0, fnSrc: 0, fnArityMax: 0, aux: 0, ...o,
    };
    return `DYNCEN-${tag} ${k} ` + Object.entries(d).map(([a, b]) => `${a}=${b}`).join(" ");
  };
  const hist = (tag, k, arr) => `DYNCEN-${tag}-LEN ${k} ` + arr.join(" ");
  const shist = (tag, k, arr) => `DYNCEN-${tag}-STRLEN ${k} ` + arr.join(" ");
  // peak: 20 STR + 52 OBJ + 32 arm = 104 = snapN
  lines.push(row("PEAK", 3, { n: 20, rcSum: 20, rcMax: 1, strPhys: 640, strLenMax: 9, aux: 20 }));
  lines.push(hist("PEAK", 3, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(shist("PEAK", 3, [0, 5, 5, 5, 5, 0, 0, 0, 0, 0]));
  lines.push(row("PEAK", 5, { n: 52, rcSum: 52, rcMax: 1, lenSum: 104, capSum: 208, lenMax: 4, capMax: 8, side: 4992, keyN: 104, keyBytes: 832, keyMax: 6, keyLe7: 104, keyLe15: 104, keyLe23: 104, keyLe31: 104 }));
  lines.push(hist("PEAK", 5, [0, 0, 52, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(shist("PEAK", 5, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(row("PEAK", ARM_ROW, { n: 32, rcSum: 96, rcMax: 3, fBuf: 32 }));
  lines.push(hist("PEAK", ARM_ROW, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(shist("PEAK", ARM_ROW, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(row("EXIT", 3, { n: 20, rcSum: 20, rcMax: 1, strPhys: 640, strLenMax: 9, aux: 20 }));
  lines.push(hist("EXIT", 3, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(shist("EXIT", 3, [0, 5, 5, 5, 5, 0, 0, 0, 0, 0]));
  lines.push(row("EXIT", 5, { n: 50, rcSum: 50, rcMax: 1, lenSum: 100, capSum: 200, lenMax: 4, capMax: 8, side: 4800, keyN: 100, keyBytes: 800, keyMax: 6, keyLe7: 100, keyLe15: 100, keyLe23: 100, keyLe31: 100 }));
  lines.push(hist("EXIT", 5, [0, 0, 50, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(shist("EXIT", 5, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(row("EXIT", ARM_ROW, { n: 32, rcSum: 96, rcMax: 3, fBuf: 32 }));
  lines.push(hist("EXIT", ARM_ROW, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  lines.push(shist("EXIT", ARM_ROW, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  lines.push("DYNCEN-CURVE 0 500 60 0");
  lines.push("DYNCEN-TOTAL allocs=154 deaths=52 liveN=102 livePeak=104 snapN=104 snapOrd=140 snapT=1 snaps=3 snapBand=256 walks=3 walkReads=300 lost=0 ptrLost=0 deadUnknown=0 armN=32 pslots=262144 tableBytes=2097152");
  return lines.join("\n");
}

function selfTest() {
  let pass = 0, fail = 0;
  const ok = (cond, what) => { if (cond) { pass++; } else { fail++; console.log("FAIL " + what); } };
  const good = base();
  const g = parse(good);
  ok(check(g).length === 0, "the well-formed fixture is BELIEVED: " + JSON.stringify(check(g)));
  ok(g.layout.sizeofDyn === 72, "layout parsed");
  ok(g.peak.get(5).n === 52, "peak OBJ row parsed");
  ok(g.peak.get(5).lenHist[2] === 52, "peak OBJ histogram parsed");
  ok(render(g).includes("OBJ"), "render names OBJ");
  ok(render(g).includes("MAXIMA"), "render prints the maxima block");

  const neg = [
    ["a kind past the row table reads as a missing kind, not a zero",
      (s) => s.replace("lost=0", "lost=7"), /lost=7/],
    ["a pointer table that overflowed makes the walk short",
      (s) => s.replace("ptrLost=0", "ptrLost=3"), /ptrLost=3/],
    ["a death the alloc hooks never saw means the hook set is incomplete",
      (s) => s.replace("deadUnknown=0", "deadUnknown=11"), /deadUnknown=11/],
    ["a missing arm is a lane nobody has shown to work",
      (s) => s.replace(`DYNCEN-COUNT ${ARM_ROW} 64 32 32\n`, ""), /no arm/],
    ["an arm whose WALK disagrees with its COUNTERS",
      (s) => s.replace("DYNCEN-EXIT 31 n=32", "DYNCEN-EXIT 31 n=30"), /walk n=30/],
    ["a walk that lost objects the cheap counters still have",
      (s) => s.replace("DYNCEN-EXIT 5 n=50", "DYNCEN-EXIT 5 n=44"), /exit walk n=44/],
    ["a snapshot that is not at the peak",
      (s) => s.replace("livePeak=104", "livePeak=9000"), /below the peak/],
    ["a snapshot whose rows do not sum to the population it claims",
      (s) => s.replace("DYNCEN-PEAK 5 n=52", "DYNCEN-PEAK 5 n=40"), /rows sum to/],
    ["a layout the build never stamped",
      (s) => s.replace("sizeofDyn=72", "sizeofDyn=0"), /layout.sizeofDyn/],
    ["a layout whose union does not close the struct",
      (s) => s.replace("sizeofUnion=56", "sizeofUnion=48"), /!= sizeofDyn/],
    ["a length that exceeds its own capacity",
      (s) => s.replace("DYNCEN-PEAK 5 n=52 rcSum=52 rcMax=1 fBuf=0 fNullProto=0 fStaticCopy=0 lenSum=104 capSum=208",
        "DYNCEN-PEAK 5 n=52 rcSum=52 rcMax=1 fBuf=0 fNullProto=0 fStaticCopy=0 lenSum=900 capSum=208"), /lenSum 900/],
    ["a histogram that does not sum to its own row",
      (s) => s.replace("DYNCEN-PEAK-LEN 5 0 0 52 0 0 0 0 0 0 0", "DYNCEN-PEAK-LEN 5 0 0 40 0 0 0 0 0 0 0"), /histogram sums to 40/],
    ["a kind with live objects and no recorded arm width",
      (s) => s.replace("DYNCEN-ARM 5 56\n", ""), /no recorded union-arm width/],
    ["books that do not balance",
      (s) => s.replace("allocs=154", "allocs=155"), /allocs/],
  ];
  for (const [what, mutate, want] of neg) {
    const bad = check(parse(mutate(good)));
    ok(bad.length > 0 && bad.some((b) => want.test(b)),
      `REFUSED: ${what} — got ${JSON.stringify(bad)}`);
  }
  console.log(`SELFTEST ${fail === 0 ? "OK" : "FAILED"}: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) {
  process.exit(selfTest());
} else if (argv.length && !argv[0].startsWith("--")) {
  const r = parse(readFileSync(argv[0], "utf8"));
  const bad = check(r);
  if (bad.length) {
    console.log("REFUSED — this report is not believed:");
    for (const b of bad) console.log("  * " + b);
    process.exit(2);
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify({
      layout: r.layout, total: r.total,
      arm: Object.fromEntries(r.arm), counts: Object.fromEntries(r.counts),
      peak: Object.fromEntries(r.peak), exit: Object.fromEntries(r.exit),
    }, null, 1));
  } else {
    console.log(render(r));
  }
} else {
  console.log("usage: dyncensus.mjs <report.txt> [--json] | --self-test");
  process.exit(1);
}
