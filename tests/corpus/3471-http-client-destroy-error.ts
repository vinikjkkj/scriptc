// request.destroy(error) — the error is the OBJECT, not its message.
//
// The 'error' listener ABI in the runtime is (closure, ScrStr *msg) and is
// shared by nine handle families; its adapter rebuilds an Error from the
// message text, recovering `code` by parsing an errno name back out of it.
// That is exact for the runtime's own errnoException-shaped messages and
// lossy for anything else, which is why destroy(err) stayed fenced: a
// version that rebuilt the error from `.message` would compile, look
// right, and silently answer `undefined` for `code` and `"Error"` for the
// name of every subclass.
//
// So the properties pinned here are the ones a rebuild would break:
//   * IDENTITY — `e === sent`, which no reconstruction can fake;
//   * `code`, carried on a real runtime-stamped error (an fs ENOENT: the
//     zapo shape, where the error arrives from elsewhere and is handed to
//     destroy() verbatim);
//   * `name`, on an Error SUBCLASS;
//   * the DEFERRAL — destroy() returns before its 'error' runs, so a
//     synchronous emission would reorder the program;
//   * one 'error' then 'close', and the FIRST destroy winning.
//
// Every request sets `agent: false` on purpose. Node's default agent keeps
// destroyed sockets pooled, and each previously destroyed request adds one
// EXTRA 'error' emission to the next one (measured: 1 + N destroyed
// predecessors). That is a property of the shared agent, not of destroy,
// and it is not modelled here — see the report's documented bound.
import * as http from "node:http";
import * as fs from "node:fs";

class BodyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BodyError";
  }
}

const server = http.createServer((req, res) => {
  req.on("data", () => {});
  req.on("end", () => { res.end("ok"); });
});

server.listen(0, () => {
  const port = server.address().port;

  // a REAL coded error, stamped by the runtime rather than by hand
  let coded: Error = new Error("unused");
  try {
    fs.readFileSync("no-such-file-in-the-corpus.txt");
  } catch (e) {
    coded = e as Error;
  }
  console.log("source code=" + (coded as NodeJS.ErrnoException).code);

  // A. the coded error survives destroy() whole
  const reqA = http.request(
    { port, host: "127.0.0.1", method: "POST", path: "/", agent: false },
    () => { console.log("A response (unexpected)"); },
  );
  reqA.on("error", (e) => {
    console.log(
      "A error same=" + (e === coded) +
      " name=" + e.name +
      " code=" + (e as NodeJS.ErrnoException).code +
      " isError=" + (e instanceof Error),
    );
  });
  reqA.on("close", () => {
    console.log("A close");

    // B. an Error SUBCLASS keeps its own name and message
    const sub = new BodyError("subclass boom");
    const reqB = http.request(
      { port, host: "127.0.0.1", method: "POST", path: "/", agent: false },
      () => { console.log("B response (unexpected)"); },
    );
    reqB.on("error", (e) => {
      console.log("B error same=" + (e === sub) + " name=" + e.name + " msg=" + e.message);
    });
    reqB.on("close", () => {
      console.log("B close");

      // C. the FIRST destroy wins; the second is a no-op
      const one = new BodyError("first");
      const two = new BodyError("second");
      const reqC = http.request(
        { port, host: "127.0.0.1", method: "POST", path: "/", agent: false },
        () => { console.log("C response (unexpected)"); },
      );
      let nC = 0;
      reqC.on("error", (e) => { nC++; console.log("C error#" + nC + " msg=" + e.message); });
      reqC.on("close", () => {
        console.log("C close errors=" + nC);
        console.log("C destroyed=" + reqC.destroyed);
        server.close();
      });
      reqC.destroy(one);
      reqC.destroy(two);
    });
    reqB.write("partial");
    reqB.destroy(sub);
    console.log("B destroy returned");
  });
  reqA.write("partial");
  reqA.destroy(coded);
  console.log("A destroy returned");
});
