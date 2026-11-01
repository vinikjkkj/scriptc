// Non-constructor function values: Node's TypeError names each one by its own
// source text (a builtin prints its native form, a function value its own
// type-stripped text).
const enc: any = encodeURI;
try {
  Reflect.construct(enc, ["a b"]);
  console.log("constructed");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}

const plain: any = (y: number) => y + 1;
try {
  Reflect.construct(plain, [1]);
  console.log("constructed");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}

const typed: any = (a: string, b: number): string => a + b;
try {
  Reflect.construct(typed, ["x", 2]);
  console.log("constructed");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
