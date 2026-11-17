// @types/node 26 declares a socket's data payload as `string | Buffer` (a Buffer, or a string once setEncoding ran). A listener written that way adapts through the
// dynamic boundary and sees the Buffer a plain socket delivers and the string a utf8 socket delivers.
import * as net from "node:net";
const seen: string[] = [];
const server = net.createServer((s) => {
  s.write("hello");
  s.end();
});
server.listen(0, "127.0.0.1", () => {
  const addr = server.address() as { port: number };
  const plain = net.connect(addr.port, "127.0.0.1");
  plain.on("data", (chunk: string | Buffer) => {
    seen.push(typeof chunk === "string" ? "str:" + chunk : "buf:" + chunk.length + ":" + chunk.toString());
  });
  plain.on("close", () => {
    const enc = net.connect(addr.port, "127.0.0.1");
    enc.setEncoding("utf8");
    enc.on("data", (chunk: string | Buffer) => {
      seen.push(typeof chunk === "string" ? "str:" + chunk : "buf:" + chunk.length);
    });
    enc.on("close", () => {
      console.log(seen.join("|"));
      server.close();
    });
  });
});
