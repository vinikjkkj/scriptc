// `instanceof` of the Error classes, Buffer and Uint8Array over dyn (unknown) operands holding:
// an Error subclass instance, an Error, a TypeError, a RangeError, a plain object with name and
// message, a Buffer, a Uint8Array, a DataView, a string, a number and null.
// Node: Error answers true for every Error (any subclass); TypeError/RangeError/SyntaxError answer
// only for their own class; Buffer is a Uint8Array subclass; a DataView is neither Buffer nor Uint8Array.
class AppError extends Error {}

function pick(i: number): unknown {
  switch (i) {
    case 0: return new AppError("app");
    case 1: return new Error("plain");
    case 2: return new TypeError("type");
    case 3: return new RangeError("range");
    case 4: return new SyntaxError("syntax");
    case 5: return { name: "TypeError", message: "fake" };
    case 6: return Buffer.from("ab");
    case 7: return new Uint8Array(3);
    case 8: return new DataView(new ArrayBuffer(4));
    case 9: return "text";
    case 10: return 7;
    default: return null;
  }
}
for (let i = 0; i < 12; i++) {
  const v = pick(i);
  console.log(
    i,
    v instanceof Error,
    v instanceof TypeError,
    v instanceof RangeError,
    v instanceof SyntaxError,
    v instanceof Buffer,
    v instanceof Uint8Array,
  );
}
