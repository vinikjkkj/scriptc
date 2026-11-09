// A client wraps one method on one instance (zapo traces ioredis' sendCommand this way): the original is bound first, the wrapper is stored on the instance
// through an assertion over unknown, and every later call, the class's own methods included, runs the wrapper, which calls the original. Another instance of
// the class is untouched. The plain spelling (no assertion) does the same.
class Client {
  log: string[] = [];
  sendCommand(cmd: { name: string }): Promise<unknown> {
    this.log.push("raw:" + cmd.name);
    return Promise.resolve("ok:" + cmd.name);
  }
  get(k: string): Promise<unknown> {
    return this.sendCommand({ name: "get " + k });
  }
  send(n: number): number {
    this.log.push("raw" + n);
    return n;
  }
  twice(n: number): number {
    return this.send(n) + this.send(n);
  }
}
async function main(): Promise<void> {
  const c = new Client();
  const orig = (c as unknown as { sendCommand: (cmd: { name: string }) => Promise<unknown> }).sendCommand.bind(c);
  (c as unknown as { sendCommand: (cmd: { name: string }) => Promise<unknown> }).sendCommand = (cmd) => {
    const out = orig(cmd);
    return out.finally(() => c.log.push("traced:" + cmd.name));
  };
  console.log(await c.get("a"));
  console.log(await c.sendCommand({ name: "direct" }));
  console.log(c.log.join(","));
  const other = new Client();
  console.log(await other.get("b"), other.log.join(","));

  const d = new Client();
  const origSend = d.send.bind(d);
  d.send = (n) => {
    const r = origSend(n);
    d.log.push("t" + n);
    return r * 10;
  };
  console.log(d.twice(1), d.send(5), d.log.join(","));
}
main();
