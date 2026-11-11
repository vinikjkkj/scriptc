// Promise.all / allSettled / race over promises of DIFFERENT result types give tuples. Reading them by fixed position always compiled; looping
// over the settled results (for-of) and indexing them with a variable were refused (SC2020 "for-of over tuples", SC1090 "tuple indexing with a
// non-literal index").
async function num(): Promise<number> { return 41; }
async function str(): Promise<string> { return "text"; }
async function flag(): Promise<boolean> { return true; }
async function failText(): Promise<string> { throw new Error("no text"); }
async function failFlag(): Promise<boolean> { throw "plain reason"; }
async function failNum(): Promise<number> { throw 7; }

async function main(): Promise<void> {
  const [n, s, f] = await Promise.all([num(), str(), flag()]);
  console.log(n + 1, s.toUpperCase(), !f);
  const raced = await Promise.race([num(), str()]);
  console.log(typeof raced, raced);

  const settled = await Promise.allSettled([num(), failText(), flag(), failFlag(), failNum()]);
  console.log(settled.length, settled[0].status, settled[1].status);
  for (const r of settled) {
    if (r.status === "fulfilled") console.log("fulfilled", typeof r.value, r.value);
    else console.log("rejected", typeof r.reason, String(r.reason));
  }
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]!;
    console.log(i, r.status, r.status === "fulfilled" ? String(r.value) : String(r.reason));
  }
  let okCount = 0;
  let index = 0;
  while (index < settled.length) {
    if (settled[index]!.status === "fulfilled") okCount++;
    index += 1;
  }
  console.log("fulfilled count", okCount);

  const two = await Promise.allSettled([str(), failNum()]);
  for (const r of two) {
    switch (r.status) {
      case "fulfilled": console.log("value", r.value); break;
      case "rejected": console.log("reason", r.reason); break;
    }
  }
  const first = two[0];
  if (first.status === "fulfilled") console.log("first", first.value);
  const k = 1;
  const second = two[k]!;
  console.log("second", second.status);
}
main().then(() => console.log("done"));
