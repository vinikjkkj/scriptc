// The heterogeneous `Promise.all` whose result is NOT destructured at the
// call: `const settled = Promise.all([...])` held as a value, awaited
// later, passed to a helper, read by index.
//
// Worth its own case because every other spelling awaits and destructures
// in one statement, which lets the tuple record be born and consumed
// inside one expression. Here the record has to survive in a local of the
// checker's own tuple type, cross a function boundary, and be indexed --
// so the lowered result type has to BE that tuple, not something the
// destructuring happened to accept.

type Reg = { readonly id: number };

async function getReg(ok: boolean): Promise<Reg | null> {
  await new Promise<void>((r) => setTimeout(r, 4));
  return ok ? { id: 11 } : null;
}
async function getFlag(): Promise<boolean> {
  await new Promise<void>((r) => setTimeout(r, 2));
  return true;
}
async function touch(tag: string): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 1));
  seen[seen.length] = tag;
}

const seen: string[] = [];

function describe(t: [Reg | null, boolean]): string {
  return (t[0] === null ? "-" : String(t[0].id)) + "/" + String(t[1]);
}

async function main(): Promise<void> {
  // Nao desestruturado: o combinador ja esta' CORRENDO enquanto a linha
  // seguinte executa, e so' depois e' que esperamos.
  const pending = Promise.all([getReg(true), getFlag()]);
  console.log("issued");
  const pair = await pending;
  console.log(describe(pair), pair.length);

  // Indexado direto, sem padrao nenhum.
  const other = await Promise.all([getReg(false), getFlag()]);
  console.log(other[0] === null ? "-" : other[0].id, other[1]);

  // Com uma entrada void no meio, tambem sem desestruturar.
  const withVoid = await Promise.all([getReg(true), touch("a"), getFlag()]);
  console.log(withVoid[0] === null ? "-" : withVoid[0].id, withVoid[1] === undefined, withVoid[2], seen.join(","));

  // Guardado, so' entao esperado, com a rejeicao chegando pelo valor guardado.
  const boom = Promise.all([
    (async (): Promise<Reg> => {
      await new Promise<void>((r) => setTimeout(r, 3));
      throw new Error("held-and-rejected");
    })(),
    getFlag(),
  ]);
  console.log("held");
  try {
    const got = await boom;
    console.log("nao devia chegar", got.length);
  } catch (e) {
    console.log("rejeitou com:", e instanceof Error ? e.message : "?");
  }
}

void main();
