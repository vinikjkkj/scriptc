// `Promise.all([value(), sideEffect()])` where one entry is Promise<void>
// and the destructuring pattern is SHORTER than the tuple -- the
// WaMessageDispatchCoordinator shape: `const [paddedPlaintext] =
// await Promise.all([writeRandomPadMax16(plaintext),
// ensureSession(address, jid)])`.
//
// The void entry carries no value but it carries the WORK: the session it
// ensures is what the next line depends on. Awaiting the entries in
// sequence would run them in the wrong order relative to each other and
// get the rejection wrong; the combinator has to wait for both.
//
// `void` is a statement kind, not a value kind, so the void entry cannot
// widen into the combinator's shared union through the ordinary payload
// adapter. It rides `async (p) => { await p; return undefined; }` instead,
// and the position's payload is the unit-only union the checker already
// spells for a `void` tuple FIELD.

const order: string[] = [];

async function pad(x: number): Promise<Uint8Array> {
  await new Promise<void>((r) => setTimeout(r, 20));
  order[order.length] = "pad";
  return new Uint8Array([x, x + 1]);
}

async function ensure(tag: string): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 5));
  order[order.length] = "ensure:" + tag;
}

async function main(): Promise<void> {
  // O padrao e' MAIS CURTO que a tupla: a posicao void nunca e' ligada.
  const [padded] = await Promise.all([pad(7), ensure("a")]);
  console.log(padded[0], padded[1], padded.length);
  // A entrada void JA RODOU quando o combinador resolveu.
  console.log(order.join(","));

  // A entrada void tambem REJEITA -- e a primeira NO TEMPO ganha.
  const slowValue = async (): Promise<number> => {
    await new Promise<void>((r) => setTimeout(r, 40));
    throw new Error("slow-value");
  };
  const fastVoid = async (): Promise<void> => {
    await new Promise<void>((r) => setTimeout(r, 5));
    throw new Error("fast-void");
  };
  try {
    const [n] = await Promise.all([slowValue(), fastVoid()]);
    console.log("nao devia chegar", n);
  } catch (e) {
    console.log("rejeitou com:", e instanceof Error ? e.message : "?");
  }

  // E o valor da posicao void, quando alguem a LE, e' undefined.
  const both = await Promise.all([pad(1), ensure("b")]);
  console.log(both[0][0], both[1] === undefined, both.length);
}

void main();
