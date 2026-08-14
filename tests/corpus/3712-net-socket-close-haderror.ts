// Node's socket 'close' carries one payload — `hadError`, true when the
// socket was destroyed by a transmission error — and it is the one fact a
// close listener has no other way to read: 'error' fires on a different
// list, so a program registering only 'close' could not tell a clean FIN
// from a refused connection.
//
//   error SC1090: close listeners with more than 0 parameters (use ())
//
// The runtime has tracked the flag since the transport-error path was
// written (ScrNetSocket.had_error); only the delivery was missing. Both
// spellings are pinned here: the zero-parameter listener (unchanged, and
// still called with no arguments) and the one-parameter one, on a clean
// close and on a refused connect.
//
// Every line prints from one causal chain, and the server-side socket's
// own 'close' is reported through a flag read at the END rather than
// where it fires: WHEN a listening server's accepted socket settles
// relative to an unrelated client's failed dial is not this fixture's
// question, and the two runtimes order it differently (measured on main
// too, with no one-parameter listener anywhere in the program).
import * as net from "node:net";

let serverSideClosed = false;

// ── a CLEAN close: the server ends, the client sees hadError false ────
const server = net.createServer((sock) => {
  sock.on("close", () => {
    serverSideClosed = true;
  });
  sock.end("bye");
});

server.listen(0, () => {
  const port = server.address().port;
  const c = net.connect(port, "127.0.0.1");
  let got = "";
  c.on("data", (chunk: Buffer) => {
    got += chunk.toString("utf8");
  });
  c.on("close", (hadError: boolean) => {
    console.log("clean close:", got, "hadError:", hadError, typeof hadError);
    server.close();
    refused(port);
  });
});

// ── a REFUSED connect: nothing listens on the port any more, so the
// socket dies from a transmission error and 'close' says so. The 'error'
// listener is mandatory (an unhandled 'error' is fatal in Node too); its
// message is deliberately not printed, because the errno text is the
// platform's, not the language's.
function refused(port: number): void {
  const bad = net.connect(port, "127.0.0.1");
  let sawError = false;
  bad.on("error", () => {
    sawError = true;
  });
  // `once` takes the same payload as `on`
  bad.once("close", (hadError: boolean) => {
    console.log("refused close: hadError:", hadError, "sawError:", sawError);
    zeroParam(port);
  });
}

// ── the zero-parameter spelling on the same failing shape: unchanged,
// and still reached.
function zeroParam(port: number): void {
  const bad = net.connect(port, "127.0.0.1");
  bad.on("error", () => {});
  bad.on("close", () => {
    console.log("zero-parameter close listener ran");
    console.log("server side saw its own close:", serverSideClosed);
  });
}
