// A closure that CAPTURES a catch binding.
//
// `catch (e)` binds a `caught` local — a snapshot box, deliberately narrower
// than dyn — and the IR validator forbids one in a capture (`capture "e" is
// caught-typed`), so any nested function reading the binding was
//   SC1090 closures capturing catch bindings (narrow into a typed local first)
// The fence names its own workaround, and the compiler now performs it:
// a catch whose block hands the binding to a nested function gets ONE hidden
// dyn local, initialized at catch entry with exactly the conversion an
// un-narrowed read already produced, and every un-narrowed read — inside the
// closure and outside it — goes through that one local.
//
// protobufjs's rpc/service.js is the shape that made this matter:
//     catch (e) { return s.emit("error", e, t), void setTimeout(function () { a(e) }, 0) }
// — the binding read once directly and once from inside a callback.
//
// Every expectation below is Node's, enumerated from the language: what a
// closure sees, that ONE value is shared with the reads outside it, that each
// iteration of a loop has its own, that a shadowing inner binding is a
// different variable, that rethrow still throws the original, and that the
// payload kinds JS admits (Error, string, number, object, null, undefined)
// all survive the round trip.

// --- the protobufjs shape: read directly AND from inside a callback ---------
function rpcish(fail: boolean): string[] {
  const out: string[] = [];
  const later: (() => void)[] = [];
  try {
    if (fail) throw new Error("boom");
    out.push("ok");
  } catch (e) {
    out.push("direct:" + String(e));
    later.push(function () {
      out.push("deferred:" + String(e));
    });
  }
  for (const f of later) f();
  return out;
}
console.log("rpcish:", JSON.stringify(rpcish(true)));
console.log("rpcish-ok:", JSON.stringify(rpcish(false)));

// --- IDENTITY: the closure's value and the direct read are the SAME value ---
// Both reads narrow through `instanceof Error` first, because `unknown ===
// unknown` is its own (unrelated) fence; what is compared is the object.
function identity(): string {
  const payload = new Error("the one");
  let outside: Error | null = null;
  let inside: Error | null = null;
  try {
    throw payload;
  } catch (e) {
    if (e instanceof Error) outside = e;
    const grab = (): void => {
      if (e instanceof Error) inside = e;
    };
    grab();
  }
  return String(outside === inside) + "," + String(outside === payload);
}
console.log("identity:", identity());

// --- every payload kind JS admits -------------------------------------------
function roundTrip(thrown: unknown): string {
  let seen = "<never ran>";
  try {
    throw thrown;
  } catch (e) {
    const capture = (): void => {
      seen = String(e);
    };
    capture();
  }
  return seen;
}
console.log("payloads:",
  roundTrip(new Error("an error")),
  "|", roundTrip("a string"),
  "|", roundTrip(42),
  "|", roundTrip(true),
  "|", roundTrip(null),
  "|", roundTrip(undefined));

// --- .message through the closure, for an Error payload ----------------------
function messageOf(): string {
  let m = "";
  try {
    throw new TypeError("wrong type");
  } catch (e) {
    const read = (): void => {
      m = e instanceof Error ? e.message : "not-an-error";
    };
    read();
  }
  return m;
}
console.log("message:", messageOf());

// --- TWO closures over ONE binding see one value -----------------------------
function twoClosures(): string {
  const shared = new Error("shared");
  let a1: Error | null = null;
  let b1: Error | null = null;
  try {
    throw shared;
  } catch (e) {
    const a = (): void => {
      if (e instanceof Error) a1 = e;
    };
    const b = (): void => {
      if (e instanceof Error) b1 = e;
    };
    a();
    b();
  }
  return String(a1 === b1) + "," + String(a1 === shared);
}
console.log("two-closures:", twoClosures());

// --- a closure INSIDE a closure (the nested capture) --------------------------
function nested(): string {
  let out = "";
  try {
    throw new Error("deep");
  } catch (e) {
    const outer = (): void => {
      const inner = (): void => {
        out = String(e);
      };
      inner();
    };
    outer();
  }
  return out;
}
console.log("nested:", nested());

// --- a loop: each iteration's binding is its OWN -----------------------------
function perIteration(): string[] {
  const thunks: (() => string)[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      throw new Error("iter" + String(i));
    } catch (e) {
      thunks.push((): string => String(e));
    }
  }
  return thunks.map((t) => t());
}
console.log("per-iteration:", JSON.stringify(perIteration()));

// --- TWO catch clauses in ONE function, both spelled `e` ---------------------
function twoCatches(): string {
  let first = "";
  let second = "";
  try {
    throw new Error("one");
  } catch (e) {
    const f = (): void => {
      first = String(e);
    };
    f();
  }
  try {
    throw new Error("two");
  } catch (e) {
    const f = (): void => {
      second = String(e);
    };
    f();
  }
  return first + "/" + second;
}
console.log("two-catches:", twoCatches());

// --- SHADOWING: an inner binding named `e` is a different variable -----------
function shadowed(): string {
  try {
    throw new Error("outer");
  } catch (e) {
    const inner = (e: string): string => e.toUpperCase();
    return inner("inner") + "|" + String(e);
  }
}
console.log("shadowed:", shadowed());

// --- CONTROL: rethrow still throws the ORIGINAL value ------------------------
// The rethrow reads the SNAPSHOT, not the lifted twin, and the outer catch
// must receive the very object that was thrown.
function rethrows(): string {
  const original = new Error("original");
  let noted = "";
  let again: Error | null = null;
  try {
    try {
      throw original;
    } catch (e) {
      const note = (): void => {
        noted = String(e);
      };
      note();
      throw e;
    }
  } catch (outer) {
    if (outer instanceof Error) again = outer;
  }
  return String(again === original) + "," + noted;
}
console.log("rethrow:", rethrows());

// --- CONTROL: a catch with NO nested function is unchanged -------------------
function plain(): string {
  try {
    throw new Error("plain");
  } catch (e) {
    return String(e);
  }
}
console.log("plain:", plain());

// --- CONTROL: a narrowing test still narrows, alongside a capture ------------
function narrowedAndCaptured(): string {
  let captured = "";
  try {
    throw new RangeError("range");
  } catch (e) {
    const grab = (): void => {
      captured = String(e);
    };
    grab();
    if (e instanceof RangeError) return "RangeError:" + e.message + "|" + captured;
    return "other|" + captured;
  }
}
console.log("narrowed:", narrowedAndCaptured());

// --- the value flows OUT of the catch through the closure --------------------
// The thunk is called AFTER the catch block has been left, which is the whole
// point of a capture: the snapshot cell is gone and the lifted dyn is what the
// closure holds.
function escapes(): string {
  let hold: (() => string) | null = null;
  try {
    throw new Error("E_ESCAPE");
  } catch (e) {
    hold = (): string => String(e);
  }
  return hold === null ? "<none>" : hold();
}
console.log("escapes:", escapes());

// --- a PLAIN-OBJECT payload through the closure ------------------------------
// String() of a non-Error object payload is "[object Object]" in Node, and it
// is what the conversion answers too. The object's FIELDS do not survive an
// un-narrowed read — caughtToDyn type-erases a non-Error payload (SEMANTICS.md
// 67) — but that is the shipped behaviour of the DIRECT read as well, measured
// on base with no closure in the program at all, so the lift adds no
// divergence of its own; it routes the closure's read through the same
// conversion the direct read already used.
function objectPayload(): string {
  let hold: (() => string) | null = null;
  try {
    throw { code: "E_OBJ", n: 7 };
  } catch (e) {
    hold = (): string => String(e);
  }
  return hold === null ? "<none>" : hold();
}
console.log("object-payload:", objectPayload());
