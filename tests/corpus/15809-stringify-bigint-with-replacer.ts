// A BigInt reached through a replacer walk is a TypeError, as Node.
const bi: unknown = { n: 5n };
try {
  console.log(JSON.stringify(bi, (k: string, v: unknown) => v));
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
const ok: unknown = { n: 5 };
console.log(JSON.stringify(ok, (k: string, v: unknown) => v, 1));
