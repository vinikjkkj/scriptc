import { format } from "node:util";

function decl(a: number, b?: string): number {
  return a;
}
const arrow = (x: number): number => x * 2;
const named = function inner(x: number) {
  return x;
};
async function later(x: number): Promise<number> {
  return x;
}
function* gen(n: number) {
  yield n;
}
function bindee(a: number) {
  return a;
}
const bound = bindee.bind(null);

console.log(format("%s", decl));
console.log(String(arrow));
console.log(`${named}`);
console.log(later.toString());
console.log(format("%s", gen));
console.log(format("%s", bound));
console.log(String(decl) + "|" + `${arrow}`);
