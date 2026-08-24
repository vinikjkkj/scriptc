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
    keytab: new Map(), keytop: new Map(), grow: new Map(),
    shrinks: null, poolMismatch: null, korigin: null,
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
    if (tag === "DYNCEN-PEAK-PHYS" || tag === "DYNCEN-EXIT-PHYS") {
      const into = tag === "DYNCEN-PEAK-PHYS" ? r.peak : r.exit;
      const row = into.get(+sp[1]);
      if (row) Object.assign(row, kvPrefixed(sp.slice(2), "phys"));
      continue;
    }
    if (tag === "DYNCEN-PEAK-CAP" || tag === "DYNCEN-EXIT-CAP") {
      const into = tag === "DYNCEN-PEAK-CAP" ? r.peak : r.exit;
      const row = into.get(+sp[1]);
      // n/capSum/lenSum per capacity class, as three parallel arrays
      if (row) {
        row.capHist = sp.slice(2).map((t) => Number(t.split("/")[0]));
        row.capCapSum = sp.slice(2).map((t) => Number(t.split("/")[1]));
        row.capLenSum = sp.slice(2).map((t) => Number(t.split("/")[2]));
      }
      continue;
    }
    if (tag === "DYNCEN-KEYTAB") { r.keytab.set(sp[1], kv(sp.slice(2))); continue; }
    if (tag === "DYNCEN-KEYTOP") {
      const list = r.keytop.get(sp[1]) ?? [];
      list.push({ n: +sp[2], len: +sp[3], trunc: +sp[4], key: sp.slice(5).join(" ") });
      r.keytop.set(sp[1], list);
      continue;
    }
    if (tag === "DYNCEN-GROW") {
      const kvs = kv(sp.slice(2 + CAPS));
      r.grow.set(sp[1], { hist: sp.slice(2, 2 + CAPS).map(Number), ...kvs });
      continue;
    }
    if (tag === "DYNCEN-KORIGIN") { r.korigin = sp.slice(1).map(Number); continue; }
    if (tag === "DYNCEN-SHRINK") {
      r.shrinks = +sp[1];
      r.poolMismatch = Number((sp[2] ?? "poolMismatch=0").split("=")[1]);
      continue;
    }
    if (tag === "DYNCEN-TOTAL") { r.total = kv(sp.slice(1)); continue; }
  }
  return r;
}

/* Capacity classes, mirroring scr_dyncen_capclass: 0,1,2,3,4 exactly, then
 * a class per doubling. The upper bound of each class is what a spare-
 * capacity figure is charged against. */
const CAPS = 14;
const CAP_LABELS = ["0", "1", "2", "3", "4", "5-8", "9-16", "17-32", "33-64",
  "65-128", "129-256", "257-512", "513-1024", "1025+"];

function kvPrefixed(parts, prefix) {
  const o = {};
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i > 0) o[prefix + p[0].toUpperCase() + p.slice(1, i)] = Number(p.slice(i + 1));
  }
  return o;
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
      // 7b. the capacity cross-tab is the SAME population, resliced: every
      //     object must appear in exactly one class and the two sums it
      //     carries must reproduce the row's own totals. A cross-tab that
      //     merely looked plausible is the whole failure mode here.
      if (row.capHist) {
        const cn = row.capHist.reduce((a, b) => a + b, 0);
        const cc = row.capCapSum.reduce((a, b) => a + b, 0);
        const cl = row.capLenSum.reduce((a, b) => a + b, 0);
        if (cn !== 0 || row.capSum !== 0) {
          if (cn !== row.n)
            bad.push(`${tag} ${name(k)}: cap cross-tab counts ${cn} objects, row n is ${row.n}`);
          if (cc !== row.capSum)
            bad.push(`${tag} ${name(k)}: cap cross-tab cap sum ${cc} != row capSum ${row.capSum}`);
          if (cl !== row.lenSum)
            bad.push(`${tag} ${name(k)}: cap cross-tab len sum ${cl} != row lenSum ${row.lenSum}`);
        }
      }
      // 7c. physical bytes are what the allocator charges, so they can
      //     never be BELOW what the caller asked for. Below means the
      //     model or the walk is wrong, and both produce a smaller and
      //     more flattering number.
      if (row.physSide !== undefined && row.physSide < row.side)
        bad.push(`${tag} ${name(k)}: physSide ${row.physSide} < requested side ${row.side}`);
      if (row.physKey !== undefined && row.physKey < row.keyBytes)
        bad.push(`${tag} ${name(k)}: physKey ${row.physKey} < pooled keyBytes ${row.keyBytes}`);
      // 7d. a literal key costs no block, so it must be excluded from the
      //     byte columns AND it can never outnumber the keys themselves.
      if (row.keyStatic > row.keyN)
        bad.push(`${tag} ${name(k)}: keyStatic ${row.keyStatic} > keyN ${row.keyN}`);
    }
  }

  // 8. the mirrored pool rounding in the -include'd half agrees with the
  //    real scr_pool_bytes. A stale mirror moves every key figure by a
  //    whole size class and nothing else would show it.
  if (r.poolMismatch > 0)
    bad.push(`poolMismatch=${r.poolMismatch}: the census's mirrored scr_pool_bytes disagrees with the runtime's`);

  // 9. the key tables. `full` means the table saturated and stopped
  //    inserting, so `distinct` is a FLOOR and the dedup figure computed
  //    from it is an understatement presented as a measurement.
  for (const [tag, t] of r.keytab) {
    if (t.full > 0)
      bad.push(`key table ${tag}: full=${t.full} — the table saturated, so distinct=${t.distinct} is a lower bound, not a count`);
    if (t.distinct > t.total)
      bad.push(`key table ${tag}: distinct ${t.distinct} > total ${t.total}`);
    if (t.distPhys > t.occPhys)
      bad.push(`key table ${tag}: distinct blocks ${t.distPhys} cost more than all occurrences ${t.occPhys}`);
  }
  // and the walk-fed tables must hold exactly the keys the rows counted
  for (const [tag, rows] of [["PEAK", r.peak], ["EXIT", r.exit]]) {
    const t = r.keytab.get(tag);
    if (!t) continue;
    let keyN = 0;
    for (const [k, row] of rows) { if (k !== ARM_ROW) keyN += row.keyN ?? 0; }
    if (t.total !== keyN)
      bad.push(`key table ${tag}: fed ${t.total} keys but the ${tag} rows counted ${keyN}`);
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
  out.push(`        union at +${L.offUnion}, ${L.sizeofUnion} wide; head ${L.offUnion} B; ScrDynEntry ${L.sizeofEntry} B; ScrStr ${L.sizeofStr} B` +
    (L.sizeofExt ? `; ScrDynObjExt ${L.sizeofExt} B (the OBJ arm's rare members, behind one pointer)` : ""));
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

  // ── rank 2: the buffers, and how much of them is capacity nobody filled
  for (const [tag, rows] of [["AT THE PEAK", r.peak], ["AT EXIT", r.exit]]) {
    for (const [k, label] of [[5, "OBJ entries"], [4, "ARR items"]]) {
      const row = rows.get(k);
      if (!row || !row.capHist) continue;
      const elem = k === 5 ? L.sizeofEntry : 8;
      out.push(`SPARE CAPACITY ${label} ${tag}: cap ${n(row.capSum)} holding ${n(row.lenSum)} — ` +
        `${n(row.capSum - row.lenSum)} unfilled slots = ${n((row.capSum - row.lenSum) * elem)} B requested, ` +
        `and the buffers cost ${n(row.physSide ?? 0)} B physical against ${n(row.side)} B requested`);
      out.push(`  class       objects       cap       len    unfilled   B unfilled   waste%`);
      for (let c = 0; c < CAPS; c++) {
        if (!row.capHist[c]) continue;
        const un = row.capCapSum[c] - row.capLenSum[c];
        out.push(`  ${CAP_LABELS[c].padEnd(9)} ${n(row.capHist[c]).padStart(9)} ${n(row.capCapSum[c]).padStart(9)} ` +
          `${n(row.capLenSum[c]).padStart(9)} ${n(un).padStart(11)} ${n(un * elem).padStart(12)} ` +
          `${pct(un, row.capCapSum[c]).padStart(8)}`);
      }
      out.push("");
    }
  }

  // ── the growth policy as it ran, not as the source reads
  if (r.grow.size) {
    out.push(`GROWTH REQUESTS over the whole run (every realloc at the two growth sites):`);
    for (const [what, g] of r.grow) {
      const tot = g.hist.reduce((a, b) => a + b, 0);
      out.push(`  ${what.padEnd(4)} ${n(tot).padStart(9)} growths, ${n(g.bytes)} B asked for, ${n(g.phys)} B charged ` +
        `(+${pct(g.phys - g.bytes, g.bytes)} allocator tax)`);
      out.push(`       to cap: ` + g.hist.map((c, i) => (c ? `${CAP_LABELS[i]}:${n(c)}` : null)).filter(Boolean).join("  "));
    }
    out.push(`  capacities that ever went DOWN: ${n(r.shrinks ?? 0)}` +
      (r.shrinks === 0 ? "  — nothing in this runtime shrinks a dyn buffer, ever" : ""));
    out.push("");
  }

  // ── rank 3: the keys, and how many of them are the same name again
  for (const tag of ["PEAK", "EXIT", "RUN"]) {
    const t = r.keytab.get(tag);
    if (!t || !t.total) continue;
    const what = tag === "RUN" ? "every key ever stored" : `the keys live objects hold ${tag === "PEAK" ? "at the peak" : "at exit"}`;
    out.push(`KEYS ${tag} — ${what}: ${n(t.total)} keys, ${n(t.distinct)} DISTINCT names ` +
      `(${pct(t.distinct, t.total)}), so ${pct(t.total - t.distinct, t.total)} of them are a name already stored`);
    out.push(`   blocks: ${n(t.occPhys)} B as stored, ${n(t.distPhys)} B if one block per distinct name — ` +
      `${n(t.occPhys - t.distPhys)} B (${pct(t.occPhys - t.distPhys, t.occPhys)}) is duplication` +
      (t.trunc ? `; ${n(t.trunc)} names stored TRUNCATED past ${48} bytes` : ""));
    if (tag !== "RUN") {
      let kn = 0, ks = 0;
      const rows = tag === "PEAK" ? r.peak : r.exit;
      for (const [k, row] of rows) { if (k === ARM_ROW) continue; kn += row.keyN ?? 0; ks += row.keyStatic ?? 0; }
      if (ks) out.push(`   ${n(ks)} of the ${n(kn)} (${pct(ks, kn)}) are compiler LITERALS stored by pointer: no block at all`);
    }
    const top = r.keytop.get(tag);
    if (top) out.push(`   commonest: ` + top.slice(0, 12).map((x) => `${x.key}:${n(x.n)}`).join("  "));
    out.push("");
  }

  if (r.korigin) {
    const [set, keyset, parse, hidden, copy] = r.korigin;
    const lit = set - keyset - copy;
    out.push(`KEY ORIGIN over the run: scr_dyn_obj_set ${n(set)} (of which key_set ${n(keyset)} and copy ${n(copy)} carry a RUN-TIME key, ` +
      `so ${n(lit)} could be a literal), JSON.parse ${n(parse)}, hidden table ${n(hidden)}`);
    out.push("");
  }

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
      anyExtra: 0, keyN: 0, keyBytes: 0, keyMax: 0, keyStatic: 0, keyLe7: 0, keyLe15: 0, keyLe23: 0,
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
  // the capacity cross-tab, the physical-byte columns and the three key
  // tables, all consistent with the rows above: 52 OBJ at cap 4 holding 2
  // members each, 104 keys of which 4 are distinct names.
  const capRow = (tag, k, arr) => `DYNCEN-${tag}-CAP ${k} ` + arr.join(" ");
  const zeroCaps = () => Array.from({ length: CAPS }, () => "0/0/0");
  const objCaps = (nObj, capSum, lenSum) => {
    const a = zeroCaps();
    a[4] = `${nObj}/${capSum}/${lenSum}`; // class "4"
    return a;
  };
  lines.push(`DYNCEN-PEAK-PHYS 3 side=0 key=0`);
  lines.push(capRow("PEAK", 3, zeroCaps()));
  lines.push(`DYNCEN-PEAK-PHYS 5 side=5824 key=1664`);
  lines.push(capRow("PEAK", 5, objCaps(52, 208, 104)));
  lines.push(`DYNCEN-EXIT-PHYS 3 side=0 key=0`);
  lines.push(capRow("EXIT", 3, zeroCaps()));
  lines.push(`DYNCEN-EXIT-PHYS 5 side=5600 key=1600`);
  lines.push(capRow("EXIT", 5, objCaps(50, 200, 100)));
  lines.push("DYNCEN-KEYTAB PEAK distinct=4 total=104 full=0 trunc=0 lenSum=416 distLenSum=16 distPhys=64 occPhys=1664 slots=16384");
  lines.push("DYNCEN-KEYTOP PEAK 26 4 0 aaaa");
  lines.push("DYNCEN-KEYTAB EXIT distinct=4 total=100 full=0 trunc=0 lenSum=400 distLenSum=16 distPhys=64 occPhys=1600 slots=16384");
  lines.push("DYNCEN-KEYTOP EXIT 25 4 0 aaaa");
  lines.push("DYNCEN-KEYTAB RUN distinct=4 total=300 full=0 trunc=0 lenSum=1200 distLenSum=16 distPhys=64 occPhys=4800 slots=16384");
  lines.push("DYNCEN-KEYTOP RUN 75 4 0 aaaa");
  lines.push("DYNCEN-GROW obj 0 0 0 0 52 0 0 0 0 0 0 0 0 0 bytes=4992 phys=5824");
  lines.push("DYNCEN-GROW arr 0 0 0 0 0 0 0 0 0 0 0 0 0 0 bytes=0 phys=0");
  lines.push("DYNCEN-SHRINK 0 poolMismatch=0");
  lines.push("DYNCEN-KORIGIN 104 4 0 0 0 0 0 0");
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
  ok(render(g).includes("SPARE CAPACITY"), "render prices the unfilled capacity");
  ok(render(g).includes("GROWTH REQUESTS"), "render prints the growth histogram");
  ok(render(g).includes("KEYS RUN"), "render prints the run-long key duplication");
  ok(render(g).includes("KEY ORIGIN"), "render prints where the keys came from");
  ok(/96\.15%|96\.2/.test(render(g)) || render(g).includes("a name already stored"),
    "render states the duplication rate");

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
    // the terms this block added, each with the way it can be wrong while
    // still printing a plausible number
    ["a mirrored scr_pool_bytes that has drifted from the runtime's",
      (s) => s.replace("poolMismatch=0", "poolMismatch=6"), /poolMismatch=6/],
    ["a key table that saturated, so `distinct` is a floor and not a count",
      (s) => s.replace("DYNCEN-KEYTAB RUN distinct=4 total=300 full=0", "DYNCEN-KEYTAB RUN distinct=4 total=300 full=9"), /saturated/],
    ["a key table fed fewer keys than the rows counted",
      (s) => s.replace("DYNCEN-KEYTAB PEAK distinct=4 total=104", "DYNCEN-KEYTAB PEAK distinct=4 total=90"), /fed 90 keys/],
    ["a dedup figure that claims the distinct blocks cost more than all of them",
      (s) => s.replace("distPhys=64 occPhys=1664", "distPhys=9000 occPhys=1664"), /cost more than all occurrences/],
    ["a cap cross-tab that counts a different population from its own row",
      (s) => s.replace("0/0/0 52/208/104", "0/0/0 40/208/104"), /cross-tab counts 40 objects/],
    ["a cap cross-tab whose capacities do not reproduce the row's capSum",
      (s) => s.replace("52/208/104", "52/900/104"), /cross-tab cap sum 900/],
    ["a cap cross-tab whose lengths do not reproduce the row's lenSum",
      (s) => s.replace("52/208/104", "52/208/77"), /cross-tab len sum 77/],
    ["physical bytes BELOW the bytes actually requested",
      (s) => s.replace("DYNCEN-PEAK-PHYS 5 side=5824", "DYNCEN-PEAK-PHYS 5 side=10"), /physSide 10 </],
    ["more literal keys than keys",
      (s) => s.replace("keyMax=6 keyStatic=0 keyLe7=104", "keyMax=6 keyStatic=999 keyLe7=104"), /keyStatic 999 > keyN/],
    ["a key block figure below the pooled figure it is charged on top of",
      (s) => s.replace("DYNCEN-PEAK-PHYS 5 side=5824 key=1664", "DYNCEN-PEAK-PHYS 5 side=5824 key=3"), /physKey 3 </],
  ];
  for (const [what, mutate, want] of neg) {
    const bad = check(parse(mutate(good)));
    ok(bad.length > 0 && bad.some((b) => want.test(b)),
      `REFUSED: ${what} — got ${JSON.stringify(bad)}`);
  }
  console.log(`SELFTEST ${fail === 0 ? "OK" : "FAILED"}: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── the STRING census ────────────────────────────────────────────────────
//
// tests/perf/dyncensus/scr_str_census.h is the ScrStr half of this lane. It
// exists because the ScrDyn half comes back with livePeak=0 on the messaging
// bench's two SEND scenarios: that workload allocates no ScrDyn at all, so
// the instrument built to price a representation change could not see the
// representation the workload is actually made of. Same directory, same
// reader, same refusals; a report is dispatched here when it carries STRCEN
// tags, so neither half can ever render the other's report.
//
// Rows 0..exactRows-1 are EXACT capacities. Row exactRows+b is the band
// [2^b, 2^(b+1)) and is priced at its LOWER bound, which UNDERSTATES the
// population's cost; the checker's cross-account test is therefore only an
// equality when every populated row is exact, and an inequality otherwise.

const RC_LABELS = ["1", "2", "3", "4", "5-8", "9-16", "17+"];

export function strParse(text) {
  const r = { layout: null, rows: new Map(), walk: [], rc: [], total: null };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sp = line.split(/\s+/);
    if (sp[0] === "STRCEN-LAYOUT") { r.layout = kv(sp.slice(1)); continue; }
    if (sp[0] === "STRCEN-ROW") { r.rows.set(+sp[1], { peak: +sp[2], exit: +sp[3] }); continue; }
    if (sp[0] === "STRCEN-RC") { r.rc[+sp[1]] = sp.slice(2).map(Number); continue; }
    if (sp[0] === "STRCEN-WALK") { r.walk[+sp[1]] = kv(sp.slice(2)); continue; }
    if (sp[0] === "STRCEN-TOTAL") { r.total = kv(sp.slice(1)); continue; }
  }
  return r;
}

/** The capacity a row index stands for, and whether that is exact. */
function rowCap(i, exactRows) {
  if (i < exactRows) return { cap: i, exact: true };
  return { cap: 2 ** (i - exactRows), exact: false };
}

/**
 * Physical bytes one string of capacity `cap` costs with a header of `hdr`.
 * TWO roundings, and both were measured rather than assumed: scr_str_alloc
 * asks for `poolGrain`-rounded bytes so a recycled block is a whole size
 * class wide, and the CRT then rounds THAT to its own bucket.
 */
export function strPhys(hdr, cap, poolGrain, mallocHdr, mallocGrain) {
  const req = Math.ceil((hdr + cap + 1) / poolGrain) * poolGrain;
  return Math.ceil((req + mallocHdr) / mallocGrain) * mallocGrain;
}

export function strCheck(r) {
  const bad = [];
  const T = r.total, L = r.layout;
  if (!T) return ["no STRCEN-TOTAL line: the report is truncated or the run did not reach its exit hook"];
  if (!L) return ["no STRCEN-LAYOUT line"];

  // 1. the instrument lost nothing
  if (T.ptrLost > 0) bad.push(`ptrLost=${T.ptrLost}: the live-pointer table overflowed, so the walk saw fewer strings than the program held`);
  if (T.hashLost > 0) bad.push(`hashLost=${T.hashLost}: the content table filled, so duplication is a floor and not a count`);
  if (T.deadUnknown > 0) bad.push(`deadUnknown=${T.deadUnknown}: a string reached the free hook the alloc hooks never saw - the hook set is incomplete`);

  // 2. the layout came from the BUILD, not from this reader
  for (const k of ["sizeofStr", "offData", "poolGrain", "mallocGrain", "exactRows"])
    if (!(L[k] > 0)) bad.push(`layout.${k} is ${L[k]}: the constructor that stamps the build's own sizes did not run`);
  if (L.offData !== L.sizeofStr)
    bad.push(`offData=${L.offData} != sizeofStr=${L.sizeofStr}: data[] is not at the end of the header, so every size below is wrong`);

  // 3. the arm: a planted population, alive at the peak AND at exit
  if (!(T.armN > 0)) bad.push(`no arm: build with -DSCR_STRCEN_ARM=N. Without it nothing here has been shown to work.`);
  else {
    const row = r.rows.get(T.armCap);
    if (!row) bad.push(`the arm planted ${T.armN} strings at cap ${T.armCap} and that row is empty: the histogram is not this population`);
    else {
      if (row.peak !== T.armN) bad.push(`the arm row at the peak is ${row.peak}, the arm is ${T.armN}: the peak snapshot is not a snapshot of this population`);
      if (row.exit !== T.armN) bad.push(`the arm row at exit is ${row.exit}, the arm is ${T.armN}: the arm was freed, so the two hooks are not paired`);
    }
    if (T.liveN < T.armN) bad.push(`liveN=${T.liveN} is below the arm's ${T.armN}: strings were freed twice`);
  }

  // 4. books balance
  if (T.allocs - T.deaths !== T.liveN) bad.push(`allocs(${T.allocs}) - deaths(${T.deaths}) != liveN(${T.liveN})`);

  // 5. the ROW TABLE and the running byte counter are INDEPENDENT accounts of
  //    the same population and must agree. This is the control that catches a
  //    histogram which silently dropped a row - the figure a header-width
  //    projection is computed from is the row table, not the counter.
  let sumN = 0, histPhys = 0, allExact = true;
  for (const [i, row] of r.rows) {
    if (row.peak === 0) continue;
    const { cap, exact } = rowCap(i, L.exactRows);
    if (!exact) allExact = false;
    sumN += row.peak;
    histPhys += row.peak * strPhys(L.sizeofStr, cap, L.poolGrain, L.mallocHdr, L.mallocGrain);
  }
  if (sumN !== T.peakN)
    bad.push(`the peak rows sum to ${sumN} strings but peakN is ${T.peakN}`);
  if (allExact && histPhys !== T.peakPhys)
    bad.push(`the row table prices the peak at ${histPhys} B, the running counter says ${T.peakPhys} B: the two accounts disagree`);
  if (histPhys > T.peakPhys)
    bad.push(`the row table prices the peak ABOVE the running counter (${histPhys} > ${T.peakPhys}), which lower-bound banding makes impossible`);

  // 6. the PEAK walk ran. Set 1 is the EXIT walk, and on a bench that frees
  //    everything before returning it sees only the arm; a reader that quoted
  //    it would report the arm as the population and look plausible doing it.
  const w0 = r.walk[0];
  if (!w0) bad.push(`no STRCEN-WALK 0 line`);
  else if (T.peakN > T.armN && !(w0.n > T.armN))
    bad.push(`the peak walk saw ${w0.n} strings against a peak of ${T.peakN}: it never ran, so rc and duplication are the arm's`);
  if (w0 && w0.distinct > w0.n) bad.push(`distinct(${w0.distinct}) > n(${w0.n})`);
  if (w0 && w0.rcSum < w0.n) bad.push(`rcSum(${w0.rcSum}) < n(${w0.n}): a live string with no reference`);
  if (w0 && w0.lenSum > T.peakCap) bad.push(`the walk's lenSum(${w0.lenSum}) exceeds the peak capSum(${T.peakCap})`);
  return bad;
}

export function strRender(r) {
  const L = r.layout, T = r.total, w0 = r.walk[0] || {}, o = [];
  const arm = T.armN || 0;
  o.push(`LAYOUT  sizeof(ScrStr)=${L.sizeofStr}  data[] at +${L.offData}  pool grain ${L.poolGrain}  concat slack ${L.chainSlack}`);
  o.push(`        one string of capacity c costs roundup(roundup(${L.sizeofStr}+c+1, ${L.poolGrain}) + ${L.mallocHdr}, ${L.mallocGrain})`);
  o.push(`        the CRT's ${L.mallocHdr}-byte header and ${L.mallocGrain}-byte grain are MEASURED on this target, not assumed`);
  o.push(`RUN     allocs=${n(T.allocs)} deaths=${n(T.deaths)} liveAtExit=${n(T.liveN)}`);
  o.push(`PEAK    ${n(T.peakN)} live heap strings at allocation #${n(T.peakOrd)}, holding ${n(T.peakPhys)} B`);
  o.push(`        arm=${arm} strings planted at cap ${T.armCap}; instrument tables ${n(T.tableBytes)} B of BSS`);
  o.push(`        mean capacity ${(T.peakCap / T.peakN).toFixed(1)} B, mean physical ${(T.peakPhys / T.peakN).toFixed(1)} B` +
    (w0.n ? `, mean length ${(w0.lenSum / w0.n).toFixed(1)} B (max ${w0.lenMax})` : ""));
  o.push(`        immortal interned literals are static and never allocate, so they are NOT in this population`);
  o.push("");

  if (w0.n) {
    o.push(`── THE PEAK WALK: ${n(w0.n)} strings read, ${pct(w0.n, T.peakN)} of the peak population`);
    o.push(`   references   rcSum=${n(w0.rcSum)} over ${n(w0.n)} values = ${(w0.rcSum / w0.n).toFixed(4)} references per value (max ${w0.rcMax})`);
    o.push(`                ` + RC_LABELS.map((l, i) => `rc ${l}: ${n((r.rc[0] || [])[i] ?? 0)}`).join("  "));
    o.push(`   duplication  ${n(w0.distinct)} distinct of ${n(w0.n)} = ${pct(w0.n - w0.distinct, w0.n)} duplicated, holding ${n(w0.dupBytes)} B`);
    o.push(`                that is the CEILING on what interning could ever recover here`);
    o.push(`   encoding     ${n(w0.ascii)} of ${n(w0.n)} = ${pct(w0.ascii, w0.n)} pure ASCII`);
    o.push("");
  }

  const live = [...r.rows.entries()].filter(([, v]) => v.peak > 0)
    .sort((a, b) => b[1].peak - a[1].peak);
  o.push(`── CAPACITY DISTRIBUTION AT THE PEAK (top rows; exact below cap ${L.exactRows})`);
  o.push(`   cap      strings        %   phys/str      total B        %`);
  for (const [i, row] of live.slice(0, 14)) {
    const { cap, exact } = rowCap(i, L.exactRows);
    const p = strPhys(L.sizeofStr, cap, L.poolGrain, L.mallocHdr, L.mallocGrain);
    o.push(`${(exact ? String(cap) : ">=" + cap).padStart(6)} ${n(row.peak).padStart(12)} ${pct(row.peak, T.peakN).padStart(8)}` +
      `${String(p).padStart(11)} ${n(row.peak * p).padStart(12)} ${pct(row.peak * p, T.peakPhys).padStart(8)}`);
  }
  o.push("");

  o.push(`── WHAT A DIFFERENT HEADER WOULD COST, over THIS distribution`);
  o.push(`   Not "24 minus 16 is 8 bytes a string": the CRT's grain is ${L.mallocGrain}, so a`);
  o.push(`   narrower header saves a WHOLE BUCKET on some capacities and NOTHING on`);
  o.push(`   others. Priced per row against the measured population and summed.`);
  o.push(`   hdr      total B        delta         %   strings that move`);
  for (const hdr of [24, 20, 16, 12, 8]) {
    let tot = 0, moved = 0;
    for (const [i, row] of r.rows) {
      if (row.peak === 0) continue;
      const { cap } = rowCap(i, L.exactRows);
      const a = strPhys(L.sizeofStr, cap, L.poolGrain, L.mallocHdr, L.mallocGrain);
      const b = strPhys(hdr, cap, L.poolGrain, L.mallocHdr, L.mallocGrain);
      tot += row.peak * b;
      if (b !== a) moved += row.peak;
    }
    const d = tot - T.peakPhys;
    o.push(`${String(hdr).padStart(6)} ${n(tot).padStart(12)} ${n(d).padStart(12)} ${(100 * d / T.peakPhys).toFixed(2).padStart(9)}%   ${n(moved)}`);
  }
  return o.join("\n");
}

function strSelfTestFixture() {
  // 100 strings of cap 64, 40 of cap 18, and an arm of 8 at cap 251.
  const phys = (cap) => strPhys(24, cap, 8, 8, 16);
  const peakPhys = 100 * phys(64) + 40 * phys(18) + 8 * phys(251);
  return [
    "STRCEN-LAYOUT sizeofStr=24 offData=24 poolGrain=8 chainSlack=8 mallocHdr=8 mallocGrain=16 exactRows=256",
    "STRCEN-ROW 18 40 0",
    "STRCEN-ROW 64 100 0",
    "STRCEN-ROW 251 8 8",
    "STRCEN-RC 0 140 8 0 0 0 0 0",
    `STRCEN-WALK 0 walks=2 n=148 atLiveN=148 rcSum=156 rcMax=2 distinct=140 dupBytes=1024 ascii=148 phys=${peakPhys} lenSum=5000 lenMax=64`,
    "STRCEN-RC 1 8 0 0 0 0 0 0",
    "STRCEN-WALK 1 walks=2 n=8 atLiveN=8 rcSum=8 rcMax=1 distinct=1 dupBytes=896 ascii=8 phys=2304 lenSum=0 lenMax=0",
    `STRCEN-TOTAL allocs=1148 deaths=1140 liveN=8 peakN=148 peakPhys=${peakPhys} peakCap=7148 peakOrd=1100 exitPhys=2304 capMax=251 lenMax=64 ptrLost=0 hashLost=0 deadUnknown=0 armN=8 armCap=251 pslots=4194304 tableBytes=33554432`,
  ].join("\n");
}

function strSelfTest() {
  let pass = 0, fail = 0;
  const ok = (cond, what) => { if (cond) { pass++; } else { fail++; console.log("FAIL " + what); } };
  const good = strSelfTestFixture();
  const g = strParse(good);
  ok(strCheck(g).length === 0, "the well-formed STRCEN fixture is BELIEVED: " + JSON.stringify(strCheck(g)));
  ok(g.layout.sizeofStr === 24, "STRCEN layout parsed");
  ok(g.rows.get(64).peak === 100, "STRCEN row parsed");
  ok(strRender(g).includes("CAPACITY DISTRIBUTION"), "STRCEN render prints the distribution");
  // The arithmetic itself, on paper. cap 64 costs 112 with a 24-byte header
  // and 96 with a 16-byte one; cap 18 costs 64 and 48. Both move by one
  // 16-byte bucket. cap 251 costs 288 either way and must NOT move - that is
  // the case a naive "8 bytes off every string" would get wrong.
  ok(strPhys(24, 64, 8, 8, 16) === 112 && strPhys(16, 64, 8, 8, 16) === 96, "cap 64: 112 -> 96");
  ok(strPhys(24, 18, 8, 8, 16) === 64 && strPhys(16, 18, 8, 8, 16) === 48, "cap 18: 64 -> 48");
  ok(strPhys(24, 251, 8, 8, 16) === 288 && strPhys(16, 251, 8, 8, 16) === 288, "cap 251 does not move");
  ok(strRender(g).includes("-2,240"), "the 16-byte row prices this fixture at 140 x 16 = 2,240 B saved");

  const neg = [
    ["a pointer table that overflowed", (s) => s.replace("ptrLost=0", "ptrLost=3"), /ptrLost=3/],
    ["a content table that filled", (s) => s.replace("hashLost=0", "hashLost=9"), /hashLost=9/],
    ["a free the alloc hooks never saw", (s) => s.replace("deadUnknown=0", "deadUnknown=4"), /deadUnknown=4/],
    ["a missing arm is a lane nobody has shown to work", (s) => s.replace("armN=8", "armN=0"), /no arm/],
    ["an arm that was freed means the hooks are not paired", (s) => s.replace("STRCEN-ROW 251 8 8", "STRCEN-ROW 251 8 0"), /arm was freed/],
    ["an arm missing from the peak snapshot", (s) => s.replace("STRCEN-ROW 251 8 8", "STRCEN-ROW 251 4 8"), /not a snapshot of this population/],
    ["rows that do not sum to the population they claim", (s) => s.replace("STRCEN-ROW 64 100 0", "STRCEN-ROW 64 90 0"), /rows sum to/],
    ["a row table that prices the peak differently from the byte counter",
      (s) => s.replace(/peakPhys=(\d+) peakCap/, (m, v) => `peakPhys=${+v + 4096} peakCap`), /two accounts disagree/],
    ["a layout the build never stamped", (s) => s.replace("sizeofStr=24", "sizeofStr=0"), /layout.sizeofStr/],
    ["a header whose data\\[\\] is not at its end", (s) => s.replace("offData=24", "offData=16"), /is not at the end/],
    ["books that do not balance", (s) => s.replace("allocs=1148", "allocs=1149"), /!= liveN/],
    ["a peak walk that never ran, so rc and duplication are the arm's",
      (s) => s.replace("STRCEN-WALK 0 walks=2 n=148", "STRCEN-WALK 0 walks=2 n=8"), /it never ran/],
    ["more distinct strings than strings", (s) => s.replace("distinct=140", "distinct=900"), /distinct\(900\)/],
    ["a live string with no reference", (s) => s.replace("rcSum=156", "rcSum=4"), /rcSum\(4\)/],
  ];
  for (const [what, mutate, want] of neg) {
    const bad = strCheck(strParse(mutate(good)));
    ok(bad.length > 0 && bad.some((s) => want.test(s)),
      `REFUSED: ${what} - got ${JSON.stringify(bad)}`);
  }
  console.log(`STRCEN SELFTEST ${fail === 0 ? "OK" : "FAILED"}: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) {
  process.exit(selfTest() || strSelfTest());
} else if (argv.length && !argv[0].startsWith("--")) {
  const text = readFileSync(argv[0], "utf8");
  // One reader, two lanes. A STRCEN report is the ScrStr half of this
  // instrument and is dispatched by its own tag rather than by a flag, so a
  // report can never be rendered by the wrong half.
  if (/^STRCEN-/m.test(text)) {
    const sr = strParse(text);
    const sbad = strCheck(sr);
    if (sbad.length) {
      console.log("REFUSED - this report is not believed:");
      for (const s of sbad) console.log("  * " + s);
      process.exit(2);
    }
    console.log(argv.includes("--json")
      ? JSON.stringify(sr, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 1)
      : strRender(sr));
    process.exit(0);
  }
  const r = parse(text);
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
