// The append accumulator, which is the ONE shape scr_str_concat's geometric
// growth arms exist for and the one shape a growth THRESHOLD could hurt.
//
// Above the threshold both arms still apply and nothing changes. Below it a
// result grows by SCR_STR_CHAIN_SLACK instead, so a string built from empty
// pays a bounded number of extra reallocations on its way up and nothing
// after. This program walks an accumulator through that boundary from both
// sides and checks the BYTES, because the hazard of a capacity policy is
// never the speed - it is a copy sized from the wrong field.
//
// It also builds the same content by every route that reaches a different
// arm of the policy: a sole-reference chain (`a + b + c`), a shared left
// side (an array element), an accumulator, and a template literal.

function unit(i: number): string {
  // 8 bytes, so the accumulator crosses every 8-byte slack step exactly.
  return "u" + String(1000000 + (i % 9000)).slice(0, 6) + "|";
}

function digest(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

// ── 1. one accumulator from 0 to well past any plausible threshold ────────
{
  let s = "";
  const marks: number[] = [];
  for (let i = 0; i < 400; i++) {
    s += unit(i);
    // Sample densely around 512 and sparsely elsewhere.
    if (s.length < 40 || (s.length > 480 && s.length < 560) || i % 97 === 0) {
      marks.push(s.length);
      console.log("acc", i, s.length, digest(s), s.slice(0, 8), s.slice(-8));
    }
  }
  console.log("acc final", s.length, digest(s), marks.length);
}

// ── 2. the same content by four different routes ──────────────────────────
{
  const parts: string[] = [];
  for (let i = 0; i < 80; i++) parts.push(unit(i));

  let byAccum = "";
  for (const p of parts) byAccum += p;

  const byJoin = parts.join("");

  let byChain = "";
  for (let i = 0; i < parts.length; i += 4) {
    byChain = byChain + parts[i] + parts[i + 1] + parts[i + 2] + parts[i + 3];
  }

  let byTemplate = "";
  for (const p of parts) byTemplate = `${byTemplate}${p}`;

  // A SHARED left side: parts[0] is an array element, so the first concat of
  // each round cannot mutate in place and takes the constant-slack arm.
  let byShared = "";
  for (let i = 0; i < parts.length; i++) byShared = parts[i] + byShared.slice(0, 0) + byShared;

  console.log("routes", byAccum.length, digest(byAccum));
  console.log("join   ", byJoin === byAccum, byChain === byAccum, byTemplate === byAccum);
  console.log("shared ", byShared.length, digest(byShared), byShared.endsWith(parts[0]));
}

// ── 3. growth THROUGH the threshold and back down by slicing ──────────────
// A slice of a grown string is a fresh allocation whose capacity comes from
// the exact-size path, so this crosses the boundary downward too.
{
  let s = "";
  for (let i = 0; i < 200; i++) s += unit(i);
  const cuts = [0, 1, 7, 8, 9, 63, 64, 65, 127, 255, 256, 300, 400, 500, 511, 512, 513, 600, 1000, s.length];
  for (const c of cuts) {
    const t = s.slice(0, c);
    const u = t + "#";
    console.log("cut", c, t.length, digest(t), u.length, digest(u), u.slice(0, 4));
  }
}

// ── 4. many accumulators alive at once, so the blocks are recycled between
// them rather than ping-ponged between two.
{
  const accs: string[] = ["", "", "", "", "", "", "", ""];
  for (let round = 0; round < 120; round++) {
    for (let k = 0; k < accs.length; k++) {
      // Not `accs[k] += ...`: compound assignment through a string array
      // element has no lowering (SC1090). The read-concat-store is the same
      // three operations the compound form would have lowered to.
      const prev = accs[k];
      accs[k] = prev + unit(round * accs.length + k);
    }
  }
  let total = 0;
  for (let k = 0; k < accs.length; k++) {
    total = (total + digest(accs[k]) + accs[k].length) & 0x7fffffff;
  }
  console.log("multi", total, accs[0].length, accs[7].length, accs[0] === accs[7]);
}
