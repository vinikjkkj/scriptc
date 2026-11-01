import * as dgram from "dgram";
const r1 = dgram.createSocket("udp4");
const r2 = dgram.createSocket("udp4");
let n = 0;
const onMsg = (name: string) => (m: Buffer) => {
  console.log(name, String(m));
  process.nextTick(() => console.log(name, "tick"));
  Promise.resolve().then(() => console.log(name, "job"));
  if (++n === 2) { r1.close(); r2.close(); }
};
r1.on("message", onMsg("R1")); r2.on("message", onMsg("R2"));
r1.bind(0, "127.0.0.1", () => {
  r2.bind(0, "127.0.0.1", () => {
    const s = dgram.createSocket("udp4");
    const p1 = (r1.address() as any).port, p2 = (r2.address() as any).port;
    s.send("one", p1, "127.0.0.1");
    s.send("two", p2, "127.0.0.1");
    setTimeout(() => s.close(), 50);
  });
});
