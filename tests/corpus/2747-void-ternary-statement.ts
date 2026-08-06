// `cond ? f() : g();` as a STATEMENT, where both arms are void. The value is
// discarded, so this is a branch spelled as an expression — protobufjs's
// util/float.js picks its endianness helpers exactly this way. Before, the
// void conditional reached the IR validator and became an internal error.
function a(): void {
  console.log("a");
}
function b(): void {
  console.log("b");
}

const n = 7;
n > 5 ? a() : b();
n < 5 ? a() : b();

// order and laziness: the condition runs first, then EXACTLY one arm
let log = "";
function cond(tag: string, v: boolean): boolean {
  log += "c" + tag;
  return v;
}
function arm(tag: string): void {
  log += tag;
}
cond("1", true) ? arm("T") : arm("F");
cond("2", false) ? arm("T") : arm("F");
console.log(log);

// nested in both positions, and inside a function body
function pick(x: number): void {
  x > 0 ? (x > 10 ? a() : b()) : b();
}
pick(20);
pick(5);
pick(-1);

// as a for-loop update clause (the other expression-statement position)
let hits = 0;
let misses = 0;
for (let i = 0; i < 4; i++) {
  i % 2 === 0 ? hits++ : misses++;
}
console.log(hits, misses);

// void arms that are assignments to a captured binding
let acc = 0;
const inc = (): void => {
  acc += 1;
};
const dec = (): void => {
  acc -= 1;
};
for (let i = 0; i < 5; i++) {
  i < 3 ? inc() : dec();
}
console.log(acc);
