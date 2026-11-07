// A reference the checker narrows to `never` (typeof x === "string" over a type with no string arm) is a DEAD branch: the local still
// holds its declared type. In a program that also calls Object.entries on an `object` (where tsc's `never` element is a dyn value), that
// dead reference must not become a dyn operand it is not: `ArrayBuffer.isView` over it lowered to nothing (SC2020).
function f(buffer?: Uint8Array | number[]): string {
  if (!(buffer == null) && typeof buffer === "string" && !ArrayBuffer.isView(buffer) && !Array.isArray(buffer)) return "dead";
  return buffer === undefined ? "none" : ArrayBuffer.isView(buffer) ? "view" : "arr";
}
function g(x: number | string[]): string {
  if (typeof x === "boolean" && Array.isArray(x)) return "dead";
  return typeof x === "number" ? "num" : "strs";
}
const d = JSON.parse('{"a":1,"b":"two"}') as Record<string, unknown>;
const o: object = d;
console.log(Object.entries(o).length, Object.values(o).length);
console.log(f(new Uint8Array(2)), f([1]), f(), g(3), g(["x"]));

// ArrayBuffer.isView over an untyped operand: true for typed arrays and views, false for everything else
function isV(v: unknown): boolean { return ArrayBuffer.isView(v); }
console.log(isV(new Uint8Array(3)), isV(new Uint8Array(4).subarray(1)), isV(new DataView(new ArrayBuffer(4))), isV(o), isV(null), isV(undefined), isV(1), isV("s"), isV([1]));
