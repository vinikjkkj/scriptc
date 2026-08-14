// A Readable piped INTO a ClientRequest — the streaming-upload idiom.
//
// scr_stream_pipe takes two ScrStreams and a ClientRequest is not one: it
// is its own handle with its own listener lists. The runtime wraps it in a
// native Writable adapter (_write forwards the bytes, _final ends the
// request, _destroy forwards only a real error) so the pipe keeps the
// stream machinery's backpressure, end-propagation and error semantics
// rather than a second copy of them.
//
// What is pinned here:
//   * the bytes ARRIVE, in order, across several chunks and several
//     sources (a PassThrough written by hand, Readable.from over an
//     array, and a single end(chunk));
//   * the pipe ENDS the request — a body that finishes must produce a
//     response, which is the autoDestroy trap: a Writable is destroyed
//     once it finishes, and forwarding that destroy to the request turned
//     every completed upload into 'socket hang up';
//   * pipe() ANSWERS the destination, so the idiom chains;
//   * the zapo bridge — the body errors, its handler destroys the request
//     with that error, and the request's own listener sees the same object.
//
// NOT pinned, and deliberately: Node emits 'pipe' on the destination, and
// here the destination the stream layer sees is the ADAPTER, so a
// `req.on('pipe')` would never fire. It is a fence rather than a silent
// no-op — 'pipe' is not among the events ClientRequest declares — and a
// loud one is the right answer until something asks for it.
import * as http from "node:http";
import { PassThrough, Readable } from "node:stream";

const server = http.createServer((req, res) => {
  let seen = "";
  req.on("data", (c) => { seen += c.toString(); });
  req.on("end", () => { res.end("got:" + seen); });
});

server.listen(0, () => {
  const port = server.address().port;

  // A. a PassThrough written by hand, three chunks then end()
  const body = new PassThrough();
  const reqA = http.request(
    { port, host: "127.0.0.1", method: "POST", path: "/", agent: false },
    (res) => {
      let b = "";
      res.on("data", (c) => { b += c.toString(); });
      res.on("end", () => {
        console.log("A status=" + res.statusCode + " " + b);

        // B. Readable.from over an array of Buffers
        const body2 = Readable.from([Buffer.from("aa"), Buffer.from("bb"), Buffer.from("cc")]);
        const reqB = http.request(
          { port, host: "127.0.0.1", method: "POST", path: "/", agent: false },
          (res2) => {
            let b2 = "";
            res2.on("data", (c) => { b2 += c.toString(); });
            res2.on("end", () => {
              console.log("B status=" + res2.statusCode + " " + b2);

              // C. a single end(chunk), and pipe()'s ANSWER is the request
              const body3 = new PassThrough();
              const reqC = http.request(
                { port, host: "127.0.0.1", method: "POST", path: "/", agent: false },
                (res3) => {
                  let b3 = "";
                  res3.on("data", (c) => { b3 += c.toString(); });
                  res3.on("end", () => {
                    console.log("C status=" + res3.statusCode + " " + b3);

                    // D. the zapo bridge: the body errors mid-pipe
                    const body4 = new PassThrough();
                    const boom = new Error("body blew up");
                    const reqD = http.request(
                      { port, host: "127.0.0.1", method: "POST", path: "/", agent: false },
                      () => { console.log("D response (unexpected)"); },
                    );
                    reqD.on("error", (e) => {
                      console.log("D error same=" + (e === boom) + " msg=" + e.message);
                    });
                    reqD.on("close", () => {
                      console.log("D close");
                      server.close();
                    });
                    body4.on("error", (err) => { reqD.destroy(err); });
                    body4.pipe(reqD);
                    body4.write("some data");
                    body4.destroy(boom);
                  });
                },
              );
              const answer = body3.pipe(reqC);
              console.log("C pipe answers the request: " + (answer === reqC));
              body3.end("only-chunk");
            });
          },
        );
        body2.pipe(reqB);
      });
    },
  );
  body.pipe(reqA);
  body.write("hello ");
  body.write("brave ");
  body.write("world");
  body.end();
});
