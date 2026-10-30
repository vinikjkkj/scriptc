const BIG: string = "y".repeat(4000);
function mk(): string {
  const x: any = new TextDecoder("utf-8");
  return x as string;
}
const t: string = mk() + BIG;
console.log("chain", t.length > 4000, t.slice(-4000) === BIG);
const u: string = mk() + "a" + BIG;
console.log("chain2", u.length > 4001, u.slice(-4001) === "a" + BIG);
