// Rethrowing a caught error that crossed into `unknown`.
//
// `function rethrow(e: unknown): never { throw e }` is the everyday helper,
// and the value arrives at the next `catch` through the checked-dynamic
// tier rather than as the runtime error object it started as. Every
// question the catch body asks has to answer about the ERROR, not about
// the box: `instanceof` down to the SUBCLASS, `.message`, `.name`, and
// `String(e)`.
//
// The subclass line is what makes this a test rather than a coincidence:
// flattening every rethrown error to `Error` would satisfy the first
// column and get the second wrong, and `typeof e` is "object" either way.
class Tagged extends Error {
  constructor(tag: string) {
    super(`tagged:${tag}`);
    this.name = "Tagged";
  }
}

function rethrow(e: unknown): never {
  throw e;
}
function rethrowLater(e: unknown): never {
  // A read THROUGH the box before the rethrow: the dyn must still be the
  // error afterwards.
  if (e instanceof Error) console.log("  seen:", e.name, e.message);
  throw e;
}

// 1. A plain Error through the helper.
try {
  try {
    throw new Error("plain");
  } catch (c) {
    rethrow(c);
  }
} catch (e) {
  console.log("1:", e instanceof Error, e instanceof TypeError, String(e), e instanceof Error ? e.message : "-");
}

// 2. A SUBCLASS of the built-in hierarchy: the narrower test must still
//    answer, so the unwrap cannot flatten everything to Error.
try {
  try {
    throw new TypeError("narrow");
  } catch (c) {
    rethrow(c);
  }
} catch (e) {
  console.log("2:", e instanceof Error, e instanceof TypeError, String(e), e instanceof Error ? e.name : "-");
}

// 3. A user subclass, read through the box before the rethrow.
try {
  try {
    throw new Tagged("t1");
  } catch (c) {
    rethrowLater(c);
  }
} catch (e) {
  console.log("3:", e instanceof Error, String(e), e instanceof Error ? e.name : "-");
}

// 4. TWO crossings: caught, rethrown, caught, rethrown again.
try {
  try {
    try {
      throw new RangeError("twice");
    } catch (c) {
      rethrow(c);
    }
  } catch (c2) {
    rethrow(c2);
  }
} catch (e) {
  console.log("4:", e instanceof Error, e instanceof RangeError, String(e));
}

// 5. A non-error value through the same helper keeps its own kind.
try {
  try {
    throw "a string";
  } catch (c) {
    rethrow(c);
  }
} catch (e) {
  console.log("5:", typeof e, e instanceof Error, String(e));
}

// 6. A plain object stays the erased arm it always was.
try {
  try {
    throw { code: 6 };
  } catch (c) {
    rethrow(c);
  }
} catch (e) {
  console.log("6:", typeof e, e instanceof Error);
}

// 7. The same crossing through a REJECTION rather than a throw: the
//    handler value takes the caught value as an argument and rethrows it.
async function bad(): Promise<void> {
  throw new TypeError("rejected");
}
async function main(): Promise<void> {
  try {
    await bad().catch(rethrow);
    console.log("7: no throw");
  } catch (e) {
    console.log("7:", e instanceof Error, e instanceof TypeError, String(e));
  }
}
void main();
