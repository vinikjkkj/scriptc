// `Promise.all` entries that are `Promise<T> | null` rather than promises
// -- the shape a guarded task takes: `const [thumb, probe] =
// await Promise.all([thumbTask, probeTask])` in zapo's media pipeline, and
// `const [senderIcdc, recipientIcdc] = await Promise.all([meUserJid ?
// resolveUserIcdc(meUserJid) : null, !isGroup ? resolveUserIcdc(to) : null])`
// in the dispatch coordinator.
//
// Promise.all resolves a NON-promise entry as itself, so the two arms of
// each entry settle differently and the branch is the semantics: the null
// arm fulfills immediately, the promise arm is awaited. The checker awaits
// each position (`Awaited<Promise<T> | null>` is `T | null`), so the
// entry's own null arm joins the promise's payload arms in the position's
// type.
//
// The last pair is UNIFORM -- both positions `Icdc | null`. It still lands
// here rather than on the array path, because the array path needs entries
// that are promises and these are not. Promise.all's result tuple is
// mutable (the overload strips readonly), so it keeps the positional
// record representation.

type Thumb = { readonly w: number; readonly h: number };
type Probe = { readonly ms: number };
type Icdc = { readonly jid: string };

async function makeThumb(w: number): Promise<Thumb> {
  await new Promise<void>((r) => setTimeout(r, 8));
  return { w, h: w * 2 };
}
async function makeProbe(): Promise<Probe> {
  await new Promise<void>((r) => setTimeout(r, 3));
  return { ms: 1250 };
}
async function resolveIcdc(jid: string): Promise<Icdc | null> {
  await new Promise<void>((r) => setTimeout(r, 4));
  return jid.length === 0 ? null : { jid };
}
async function boomThumb(): Promise<Thumb> {
  await new Promise<void>((r) => setTimeout(r, 6));
  throw new Error("thumb-failed");
}

// As tarefas guardadas: a anotacao de RETORNO e' que mantem o tipo
// `Promise<T> | null` (um const inicializado com `null` estreita).
function thumbTask(on: boolean, w: number): Promise<Thumb> | null {
  return on ? makeThumb(w) : null;
}
function probeTask(on: boolean): Promise<Probe> | null {
  return on ? makeProbe() : null;
}
function icdcTask(on: boolean, jid: string): Promise<Icdc | null> | null {
  return on ? resolveIcdc(jid) : null;
}
function boomTask(on: boolean): Promise<Thumb> | null {
  return on ? boomThumb() : null;
}

async function main(): Promise<void> {
  // Os dois lados presentes.
  const [thumb, probe] = await Promise.all([thumbTask(true, 90), probeTask(true)]);
  console.log(thumb === null ? "no-thumb" : thumb.w + "x" + thumb.h, probe === null ? "no-probe" : probe.ms);

  // Um lado ausente: o braco null resolve como ele mesmo.
  const [t2, p2] = await Promise.all([thumbTask(false, 1), probeTask(true)]);
  console.log(t2 === null ? "no-thumb" : t2.w, p2 === null ? "no-probe" : p2.ms);

  // Os dois ausentes.
  const [t3, p3] = await Promise.all([thumbTask(false, 1), probeTask(false)]);
  console.log(t3 === null, p3 === null);

  // Buraco no padrao sobre uma entrada condicional.
  const [, onlyProbe] = await Promise.all([thumbTask(true, 4), probeTask(true)]);
  console.log(onlyProbe === null ? "-" : onlyProbe.ms);

  // Posicoes UNIFORMES vindas de ternarios: continua sendo tupla.
  const [senderIcdc, recipientIcdc] = await Promise.all([
    icdcTask(true, "me@s.whatsapp.net"),
    icdcTask(true, "peer@s.whatsapp.net"),
  ]);
  console.log(senderIcdc === null ? "-" : senderIcdc.jid, recipientIcdc === null ? "-" : recipientIcdc.jid);

  // Uniformes com um lado desligado e o outro resolvendo null por dentro.
  const [s2, r2] = await Promise.all([icdcTask(false, "x"), icdcTask(true, "")]);
  console.log(s2 === null, r2 === null);

  // O braco promise carrega a rejeicao; o braco null nunca rejeita.
  try {
    const [x, y] = await Promise.all([boomTask(true), probeTask(false)]);
    console.log("nao devia chegar", x, y);
  } catch (e) {
    console.log("rejeitou com:", e instanceof Error ? e.message : "?");
  }

  // Entrada condicional DESLIGADA ao lado de uma que rejeita mais tarde:
  // a rejeicao ainda ganha, mesmo com a outra posicao ja resolvida.
  try {
    const [x, y] = await Promise.all([boomTask(true), thumbTask(false, 0)]);
    console.log("nao devia chegar", x, y);
  } catch (e) {
    console.log("rejeitou com:", e instanceof Error ? e.message : "?");
  }
}

void main();
