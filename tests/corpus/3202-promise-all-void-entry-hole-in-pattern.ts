// The same void entry, but FIRST, and the destructuring skips it with a
// HOLE -- the WaRetryCoordinator shape: `const [, currentSession] =
// await Promise.all([markRetryRequesterSenderKeyAsStale(...),
// sessionStore.getSession(address)])`.
//
// The hole is what makes this worth its own case. A pattern with an
// elision still reads position 1 out of the tuple, so the record the
// combinator builds must have position 0 present and position 1 at the
// right offset -- an off-by-one here reads the void slot as the session
// and answers wrong rather than failing.

type Session = { readonly regId: number; readonly stale: boolean };

const log: string[] = [];

async function markStale(who: string): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 10));
  log[log.length] = "stale:" + who;
}

async function getSession(present: boolean): Promise<Session | null> {
  await new Promise<void>((r) => setTimeout(r, 2));
  return present ? { regId: 42, stale: false } : null;
}

async function main(): Promise<void> {
  // Buraco no padrao: a posicao 0 (void) e' PULADA.
  const [, current] = await Promise.all([markStale("alice"), getSession(true)]);
  console.log(current === null ? "null" : current.regId, log.join(","));

  const [, absent] = await Promise.all([markStale("bob"), getSession(false)]);
  console.log(absent === null ? "null" : absent.regId, log.join(","));

  // Tres posicoes, buraco no MEIO, void nas pontas.
  const [first, , third] = await Promise.all([
    getSession(true),
    markStale("carol"),
    (async (): Promise<string> => "tail")(),
  ]);
  console.log(first === null ? "null" : first.regId, third, log.join(","));

  // Ler a posicao void explicitamente pelo buraco preenchido.
  const trio = await Promise.all([markStale("dave"), getSession(true), markStale("erin")]);
  console.log(trio[0] === undefined, trio[1] === null ? "null" : trio[1].regId, trio[2] === undefined);
}

void main();
