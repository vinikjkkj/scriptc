// A REJECTION payload flowing into an `unknown` slot.
//
// `try { … } catch (e)` gives the payload as `unknown`, and an un-narrowed
// use of it already converted to a dyn value. The lib types
// `.catch(onrejected)` as `(reason: any) => …`, so the very same payload
// arrives as `any` through the rejection handler -- not narrowed either,
// and needing the very same conversion. Only the `try` half compiled, so
// the idiom worked in statement form and fenced in promise form.
//
// Both halves are here, over each payload flavor, because the conversion
// is where Error payloads keep their observability (instanceof Error,
// .message, String()) while other object payloads type-erase to the
// "[object Object]" approximation.
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function describe(value: unknown): string {
  if (value instanceof Error) return `E(${value.message})`;
  if (typeof value === "string") return `S(${value})`;
  if (typeof value === "number") return `N(${value})`;
  return `O(${String(value)})`;
}

async function throwing(which: string): Promise<number> {
  if (which === "error") throw new Error("boom");
  if (which === "string") throw "plain";
  if (which === "number") throw 42;
  if (which === "object") throw { code: 7 };
  return 1;
}

async function viaTry(which: string): Promise<void> {
  try {
    await throwing(which);
    console.log("try", which, "no throw");
  } catch (e) {
    console.log("try", which, describe(e), toError(e).message);
  }
}

async function viaCatch(which: string): Promise<void> {
  await throwing(which)
    .then((n) => {
      console.log("cb", which, "resolved", n);
    })
    .catch((e) => {
      console.log("cb", which, describe(e), toError(e).message);
    });
}

async function main(): Promise<void> {
  for (const which of ["error", "string", "number", "object", "none"]) {
    await viaTry(which);
    await viaCatch(which);
  }

  // The payload reaching a slot typed `unknown` directly, not through a
  // parameter -- the other spelling of the same conversion.
  await throwing("error").catch((e) => {
    const held: unknown = e;
    console.log("held:", describe(held));
  });

  // Narrowing still wins where it applies: an instanceof test inside the
  // rejection handler reads .message off the class, no conversion needed.
  await throwing("error").catch((e) => {
    if (e instanceof Error) console.log("narrowed:", e.message);
  });
}

void main();
