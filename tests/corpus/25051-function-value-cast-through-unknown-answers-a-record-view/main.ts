import { mkp, mkk, mki } from "./lib.cjs";
interface R { n: number; name: string; exec(): number; getName(): string; readonly g: string; }
const makers: (() => R)[] = [mkp as unknown as () => R, mki as unknown as () => R];
let j = 0;
for (const f of makers) {
  j++;
  const r = f();
  console.log(j, "fn", r.exec(), r.getName(), r.g);
  r.n = 50;
  console.log(j, "fn write", r.exec(), r.n);
}
void mkk;
