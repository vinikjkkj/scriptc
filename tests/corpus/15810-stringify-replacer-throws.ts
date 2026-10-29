// A replacer that throws propagates its own error out of JSON.stringify.
const data: unknown = { a: 1, b: [2] };
try {
  JSON.stringify(data, (k: string, v: unknown): unknown => {
    if (k === "b") throw new Error("boom at " + k);
    return v;
  });
} catch (e) {
  console.log((e as Error).message);
}
