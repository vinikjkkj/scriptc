// `new Array<T>(n)` allocates HOLES, and a hole has no honest value for a
// scalar element (it would read 0 where Node reads undefined) nor for a union
// without an undefined arm. So the constructor fences by name unless something
// proves no slot is readable before it is written -- `.fill(v)`, or the
// counting loop right after the declaration.
//
// The counting-loop proof used to demand exactly ONE top-level `a[i] = ...`
// and no jump at all, which cannot see the shape any "look it up or record a
// miss" batch takes -- zapo's message-secret.store.ts:82:
//
//   for (let i = 0; i < ids.length; i += 1) {
//     const hit = cache.get(ids[i])
//     if (!hit) { out[i] = null; continue }
//     if (hit.expiresAt <= now) { cache.delete(ids[i]); out[i] = null; continue }
//     out[i] = { secret: hit.secret, jid: hit.jid }
//   }
//
// Three writes on three paths, and the union of the paths is still every
// index. The proof now walks the body for definite assignment: a `continue` is
// admitted only where the slot is already written, and a `break`/`return`
// still declines because it leaves the TAIL unwritten with the array still
// reachable.
//
// Rows: the guarded fill over a union element (r01..r04, the zapo shape), the
// same over a SCALAR element where a hole would read 0 (r05..r07), an
// if/else where BOTH sides write and neither continues (r08), an else-branch
// that continues while the then-branch falls through (r09), a nested block
// (r10), and the one-write shape the old rule already admitted, unchanged
// (r11). Every slot of every array is read back, so a hole would be visible.

type Entry = { readonly secret: string; readonly jid: string };
type Cached = { readonly secret: string; readonly jid: string; readonly expiresAtMs: number };

function getBatch(
  ids: readonly string[],
  cache: Map<string, Cached>,
  nowMs: number,
): (Entry | null)[] {
  const result = new Array<Entry | null>(ids.length);
  for (let i = 0; i < ids.length; i += 1) {
    const cached = cache.get(ids[i]);
    if (!cached) {
      result[i] = null;
      continue;
    }
    if (cached.expiresAtMs <= nowMs) {
      cache.delete(ids[i]);
      result[i] = null;
      continue;
    }
    result[i] = { secret: cached.secret, jid: cached.jid };
  }
  return result;
}

// O mesmo formato, mas com elemento ESCALAR: um buraco leria 0.
function scores(ids: readonly string[], table: Map<string, number>): number[] {
  const out = new Array<number>(ids.length);
  for (let i = 0; i < ids.length; i += 1) {
    const hit = table.get(ids[i]);
    if (hit === undefined) {
      out[i] = -1;
      continue;
    }
    if (hit < 0) {
      out[i] = 0;
      continue;
    }
    out[i] = hit * 10;
  }
  return out;
}

// if/else, os dois lados escrevem, nenhum continua.
function parity(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    if (i % 2 === 0) {
      out[i] = i;
    } else {
      out[i] = -i;
    }
  }
  return out;
}

// O ELSE e' que continua; o then cai para o fim e reescreve o slot. A
// reescrita nao pode LER o slot de volta (`out[i] = out[i] + 1` continua
// recusado, e com razao: e' a leitura que a prova existe para impedir), entao
// ela escreve um valor novo.
function elseContinues(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    if (i % 3 === 0) {
      out[i] = 100;
    } else {
      out[i] = i;
      continue;
    }
    out[i] = 101;
  }
  return out;
}

// Bloco aninhado com a escrita dentro dele.
function nested(n: number): string[] {
  const out = new Array<string>(n);
  for (let i = 0; i < n; i += 1) {
    {
      const tag = i % 2 === 0 ? "e" : "o";
      out[i] = tag + i;
    }
  }
  return out;
}

// A forma que a regra antiga ja admitia: uma escrita, sem saltos.
function plain(n: number): string[] {
  const out = new Array<string>(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = "v" + i;
  }
  return out;
}

function showEntries(rows: readonly (Entry | null)[]): string {
  const parts: string[] = [];
  for (const r of rows) parts.push(r === null ? "-" : r.jid + ":" + r.secret);
  return parts.join(",");
}

function main(): void {
  const cache = new Map<string, Cached>();
  cache.set("a", { secret: "sa", jid: "ja", expiresAtMs: 100 });
  cache.set("b", { secret: "sb", jid: "jb", expiresAtMs: 10 });
  cache.set("d", { secret: "sd", jid: "jd", expiresAtMs: 900 });

  // r01: 'a' vivo, 'b' expirado, 'c' ausente, 'd' vivo.
  const got = getBatch(["a", "b", "c", "d"], cache, 50);
  console.log("r01", got.length, showEntries(got));
  // r02: o expirado saiu do cache.
  console.log("r02", cache.has("b"), cache.has("a"));
  // r03: lista vazia -- o laco nao roda e nada e' legivel.
  console.log("r03", getBatch([], cache, 50).length);
  // r04: tudo ausente.
  console.log("r04", showEntries(getBatch(["x", "y"], cache, 50)));

  const table = new Map<string, number>();
  table.set("p", 3);
  table.set("q", -5);
  // r05: presente positivo, presente negativo, ausente.
  console.log("r05", scores(["p", "q", "r"], table).join(","));
  // r06: um buraco leria 0 -- todas as posicoes sao escritas, entao nenhuma le 0
  // por acidente. A posicao 1 vale 0 porque o programa a escreveu com 0.
  const sc = scores(["q"], table);
  console.log("r06", sc.length, sc[0]);
  // r07: vazio.
  console.log("r07", scores([], table).length);

  console.log("r08", parity(5).join(","));
  console.log("r09", elseContinues(6).join(","));
  console.log("r10", nested(4).join(","));
  console.log("r11", plain(3).join(","));
}

main();
