// `Promise<null> | Promise<T>` and `Promise<T | null>` are ONE type, and the
// all-promise collapse used to map them to two different IR types.
//
// The collapse itself is old news: a ternary whose two arms are promises
// (`cond ? Promise.resolve(null) : requirePreKey(id)`) types as
// `Promise<null> | Promise<T>`, and since no operation can observe WHICH arm a
// promise value came from, it collapses to one `Promise<null | T>`. What was
// wrong was the PAYLOAD. It was built by splicing each arm's STANDALONE
// mapping, and standalone `null` maps to the unit-only union (`null |
// undefined`) because a lone unit arm has no home. So this spelling got the
// payload `T | null | undefined` while `Promise<T | null>` got `T | null`.
//
// One arm apart is enough to break the consumer that compares payloads
// against the checker's own answer: `Promise.all`'s heterogeneous path checks
// each entry's payload against the result-tuple position tsc typed, and
// zapo's SignalProtocol.ts:441 --
//
//   const [local, signed, oneTime] = await Promise.all([
//     requireLocalIdentity(s), requireSignedPreKey(s, id),
//     id === null ? Promise.resolve(null) : requirePreKey(store, id)])
//
// -- had an entry one arm wider than its own position and reported
// 'Promise.all over this argument shape'. The payload now takes the same
// part-wise unit rule the ordinary union mapping uses (a `null` PART is the
// null arm, an `undefined` PART the undefined arm), so both spellings intern
// to one type.
//
// Rows here: the two spellings side by side (r01/r02), both arms of the
// ternary taken (r03/r04), the `undefined` half of the rule (r05/r06), the
// three-entry heterogeneous Promise.all that is zapo's site (r07..r10),
// identity of the promise the ternary chose (r11), and the rejection still
// winning by TIME rather than by position (r12).

type Ident = { readonly kind: string };
type Signed = { readonly id: number };
type PreKey = { readonly id: number; readonly pub: string };

async function tick(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

async function requireIdent(): Promise<Ident> {
  await tick(1);
  return { kind: "x25519" };
}
async function requireSigned(id: number): Promise<Signed> {
  await tick(2);
  return { id };
}
async function requirePreKey(id: number): Promise<PreKey> {
  await tick(3);
  return { id, pub: "pk-" + id };
}
async function boom(): Promise<PreKey> {
  await tick(1);
  throw new Error("prekey-gone");
}

// A tomada de decisao que produz `Promise<null> | Promise<PreKey>`.
function maybePreKey(id: number | null): Promise<null> | Promise<PreKey> {
  return id === null ? Promise.resolve(null) : requirePreKey(id);
}
// A MESMA coisa, escrita como um unico Promise.
function maybePreKeyOne(id: number | null): Promise<PreKey | null> {
  return id === null ? Promise.resolve(null) : requirePreKey(id);
}
// A metade `undefined` da regra. (`Promise.resolve(undefined)` tem uma cerca
// propria -- 'Promise.resolve with an argument at a void-promise type' -- que
// nada aqui mexe, entao o braco ausente e' uma async que devolve undefined.)
async function noSigned(): Promise<undefined> {
  await tick(1);
  return undefined;
}
function maybeSignedU(id: number | null): Promise<undefined> | Promise<Signed> {
  return id === null ? noSigned() : requireSigned(id);
}

function showPreKey(p: PreKey | null): string {
  return p === null ? "-" : p.id + "/" + p.pub;
}

async function main(): Promise<void> {
  // r01/r02: as duas grafias, o mesmo valor.
  const a1 = await maybePreKey(7);
  const a2 = await maybePreKeyOne(7);
  console.log("r01", showPreKey(a1));
  console.log("r02", showPreKey(a2));

  // r03/r04: os dois bracos do ternario.
  console.log("r03", showPreKey(await maybePreKey(null)));
  console.log("r04", showPreKey(await maybePreKey(11)));

  // r05/r06: a metade `undefined`. `undefined` e `null` sao bracos
  // DIFERENTES -- o payload de `Promise<undefined> | Promise<Signed>` nao
  // carrega null, e o teste distingue os dois.
  const u1 = await maybeSignedU(null);
  const u2 = await maybeSignedU(4);
  console.log("r05", u1 === undefined, u1 === null);
  console.log("r06", u2 === undefined ? "-" : String(u2.id));

  // r07..r10: o sitio do zapo, com a terceira entrada nos dois estados.
  const [i1, s1, k1] = await Promise.all([requireIdent(), requireSigned(1), maybePreKey(9)]);
  console.log("r07", i1.kind, s1.id, showPreKey(k1));
  const [i2, s2, k2] = await Promise.all([requireIdent(), requireSigned(2), maybePreKey(null)]);
  console.log("r08", i2.kind, s2.id, showPreKey(k2));
  // Buraco no padrao, e a posicao do meio sozinha.
  const [, s3] = await Promise.all([requireIdent(), requireSigned(3), maybePreKey(null)]);
  console.log("r09", s3.id);
  // A entrada `undefined` na mesma tupla heterogenea.
  const [i4, u4] = await Promise.all([requireIdent(), maybeSignedU(null)]);
  console.log("r10", i4.kind, u4 === undefined);

  // r11: `Promise.resolve` sobre um promise devolve o MESMO promise, entao o
  // braco escolhido preserva identidade atraves do colapso.
  const chosen = requirePreKey(5);
  const same = Promise.resolve(chosen);
  console.log("r11", same === chosen, showPreKey(await same));

  // r12: a rejeicao ganha por TEMPO. A entrada que rejeita e' a mais rapida.
  try {
    const [x, y, z] = await Promise.all([requireIdent(), requireSigned(6), boom()]);
    console.log("r12 nao devia chegar", x.kind, y.id, showPreKey(z));
  } catch (e) {
    console.log("r12", e instanceof Error ? e.message : "?");
  }
}

void main();
