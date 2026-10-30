// Http2ServerResponse.setTimeout is the h2 STREAM's idle timer (Node: this.stream.setTimeout).
// The compiler refuses it by static receiver type; the socket path it would otherwise take
// is a silent no-op on an h2 stream.
import * as http2 from "http2";
const server = http2.createServer((req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => {
  res.setTimeout(20, () => console.log("fired"));
  res.end("ok");
});
server.close();
