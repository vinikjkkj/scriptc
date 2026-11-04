const sleep = (ms: number): Promise<number> => new Promise((r) => setTimeout(() => r(ms), ms));
const boom = (): Promise<number> => Promise.reject(new Error("boom"));
async function viaDone(): Promise<number> { return Promise.resolve(7); }
async function viaTimer(): Promise<number> { return sleep(5); }
async function viaRejected(): Promise<number> { return boom(); }
async function viaTryAwait(): Promise<string> {
  try {
    return await boom().then(() => "ok");
  } catch (e) {
    return "caught-inside-await";
  }
}
async function depth3(): Promise<number> { return viaDone(); }
async function depth4(): Promise<number> { return depth3(); }
const arrow = async (): Promise<number> => viaDone();
const log: string[] = [];
const num = (name: string) => (v: number): void => { log.push(name + ":" + v); };
const str = (name: string) => (v: string): void => { log.push(name + ":" + v); };
const bad = (name: string) => (e: Error): void => { log.push(name + ":" + e.message); };
viaDone().then(num("done"));
viaTimer().then(num("timer"));
viaRejected().catch(bad("rej"));
viaTryAwait().then(str("tryawait"));
depth4().then(num("d4"));
arrow().then(num("arrow"));
(async () => {
  for (let i = 1; i <= 8; i++) { await null; log.push("t" + i); }
  await sleep(20);
  console.log(log.join("\n"));
})();
