// A bigint view reached through an any-typed name: a bigint store converts
// and writes the low 64 bits; a number store throws Node's TypeError (even
// out of range, because ToBigInt runs before the index check).
const s = new BigInt64Array(2);
const anyS: any = s;
anyS[0] = 5n;
console.log(s[0], anyS[0]);
try {
  anyS[0] = 1;
  console.log("no throw");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
console.log(anyS[0]);
anyS[1] = "7";
console.log(s[1]);
anyS[9] = 3n;
try {
  anyS[9] = 1;
  console.log("no throw");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
const u = new BigUint64Array(1);
const anyU: any = u;
anyU[0] = -1n;
console.log(u[0]);
