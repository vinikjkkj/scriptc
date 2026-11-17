// A Map<string, X> and a Map<string, X | undefined> (likewise sets and arrays) are one runtime object each: === and !== are the pointer compare.
class Cache {
  readonly a = new Map<string, { n: number }>();
  readonly b = new Map<string, { n: number } | undefined>();
  readonly c = new Map<string, { n: number } | undefined>();
  readonly s1 = new Set<number>();
  readonly s2 = new Set<number | string>();
  readonly r1: number[] = [1, 2];
  readonly r2: (number | string)[] = [1, 2];
  which(m: Map<string, { n: number } | undefined>): string {
    return m === this.a ? "a" : m === this.b ? "b" : "other";
  }
}
const k = new Cache();
console.log(k.which(k.b), k.which(k.c), k.a === k.b, k.b !== k.c, k.s1 === k.s2, k.r1 === k.r2, k.r1 !== k.r2);
const same: Map<string, { n: number } | undefined> = k.b;
console.log(same === k.b, same === k.c);
