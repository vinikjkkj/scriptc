import * as net from "node:net";

// pg-protocol's parse(stream: NodeJS.ReadableStream, callback): a net.Socket (a Duplex, so a Readable in Node's class hierarchy) is
// passed to a ReadableStream-typed parameter as itself, and the same socket is still the socket when it comes back out.
const chunks: string[] = [];
function parse(stream: NodeJS.ReadableStream, callback: (text: string) => void): Promise<void> {
  stream.on("data", (buffer: Buffer) => callback(buffer.toString()));
  return new Promise((resolve) => stream.on("end", () => resolve()));
}
function keep(stream: NodeJS.ReadableStream): NodeJS.ReadableStream {
  return stream;
}
function make(port: number, host: string): any {
  return net.connect(port, host);
}
const server = net.createServer((sock) => {
  sock.write("one,");
  sock.write("two");
  sock.end();
});
server.listen(0, "127.0.0.1", () => {
  const address: any = server.address();
  const socket = make(address.port, "127.0.0.1");
  const same = keep(socket) === socket;
  parse(socket, (t) => chunks.push(t)).then(() => {
    console.log("identity", same, "parsed", chunks.join(""));
    server.close();
    const refused = make(1, "127.0.0.1");
    refused.on("error", (e: NodeJS.ErrnoException) => console.log("refused", e.code, e.errno, e.syscall));
    parse(refused, () => {});
  });
});
