import * as net from "net";
import * as Tls from "tls";
// DEBUG PROBE (tlsdbg branch only): every own field of a refused connect's error
// and of each attempt, per path: plain net to 127.0.0.1, plain net to localhost,
// and tls to localhost. Ports are normalized.
const fields = (tag: string, e: any, port: number) => {
  const norm = (v: unknown) => String(v).split(String(port)).join("PORT");
  console.log(tag, "instanceof Error", e instanceof Error);
  console.log(tag, "code", e.code);
  console.log(tag, "errno", e.errno);
  console.log(tag, "syscall", e.syscall);
  console.log(tag, "address", e.address);
  console.log(tag, "port", e.port === port ? "PORT-MATCH" : String(e.port));
  console.log(tag, "message", norm(e.message));
};
const report = (tag: string, e: any, port: number) => {
  fields(tag, e, port);
  if (e.errors !== undefined) {
    console.log(tag, "errors length", e.errors.length);
    for (let i = 0; i < e.errors.length; i++) fields(tag + ".errors[" + i + "]", e.errors[i], port);
  }
};
const probe = net.createServer(() => {});
probe.listen(0, "127.0.0.1", () => {
  const port = (probe.address() as { port: number }).port;
  probe.close(() => {
    const s1 = net.connect(port, "127.0.0.1");
    s1.on("error", (e: unknown) => {
      report("v4", e, port);
      const s2 = net.connect(port, "localhost");
      s2.on("error", (e2: unknown) => {
        report("lh", e2, port);
        const s3 = Tls.connect({ port, host: "localhost" });
        s3.on("error", (e3: unknown) => {
          report("tls", e3, port);
        });
      });
    });
  });
});
