const sleep = (ms: number): Promise<number> => new Promise((r) => setTimeout(() => r(ms), ms));
const boom = (): Promise<number> => Promise.reject(new Error("boom"));
const log: string[] = [];
const L = (s: string): void => { log.push(s); };
const num = (name: string) => (v: number): void => L(name + ":" + v);
const bad = (name: string) => (e: Error): void => L(name + ":" + e.message);

async function resolvedCatch(): Promise<number> {
  try { return Promise.resolve(1); } catch (e) { return -1; }
}
async function rejectedCatch(): Promise<number> {
  try { return boom(); } catch (e) { L("rejectedCatch: handler ran"); return -1; }
}
async function resolvedFinally(): Promise<number> {
  try { return Promise.resolve(2); } finally { L("resolvedFinally: finally"); }
}
async function rejectedFinally(): Promise<number> {
  try { return boom(); } finally { L("rejectedFinally: finally"); }
}
async function rejectedBoth(): Promise<number> {
  try { return boom(); } catch (e) { L("rejectedBoth: handler ran"); return -1; } finally { L("rejectedBoth: finally"); }
}
async function resolvedBoth(): Promise<number> {
  try { return sleep(3); } catch (e) { return -1; } finally { L("resolvedBoth: finally"); }
}
async function fromCatch(): Promise<number> {
  try { throw new Error("x"); } catch (e) { return Promise.resolve(5); } finally { L("fromCatch: finally"); }
}
async function nested(): Promise<number> {
  try {
    try { return boom(); } catch (e) { L("nested: inner handler ran"); return -1; } finally { L("nested: inner finally"); }
  } catch (e) { L("nested: outer handler ran"); return -2; } finally { L("nested: outer finally"); }
}
async function nestedResolved(): Promise<number> {
  try {
    try { return Promise.resolve(8); } finally { L("nestedResolved: inner finally"); }
  } finally { L("nestedResolved: outer finally"); }
}
async function inLoop(): Promise<number> {
  for (let i = 0; i < 3; i++) {
    try { if (i === 1) return Promise.resolve(i * 10); } finally { L("inLoop: finally " + i); }
  }
  return 99;
}
async function plainValue(): Promise<number> {
  try { return 4; } finally { L("plainValue: finally"); }
}
async function awaitedInside(): Promise<number> {
  try { return await boom(); } catch (e) { L("awaitedInside: handler ran"); return -3; }
}
resolvedCatch().then(num("resolvedCatch"));
rejectedCatch().then(num("rejectedCatch")).catch(bad("rejectedCatch-rej"));
resolvedFinally().then(num("resolvedFinally"));
rejectedFinally().then(num("rejectedFinally")).catch(bad("rejectedFinally-rej"));
rejectedBoth().then(num("rejectedBoth")).catch(bad("rejectedBoth-rej"));
resolvedBoth().then(num("resolvedBoth"));
fromCatch().then(num("fromCatch"));
nested().then(num("nested")).catch(bad("nested-rej"));
nestedResolved().then(num("nestedResolved"));
inLoop().then(num("inLoop"));
plainValue().then(num("plainValue"));
awaitedInside().then(num("awaitedInside"));
(async () => {
  for (let i = 1; i <= 8; i++) { await null; L("t" + i); }
  await sleep(30);
  console.log(log.join("\n"));
})();
