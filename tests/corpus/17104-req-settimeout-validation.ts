import * as http from "http";
const srv = http.createServer((q, s) => { s.end("ok"); });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const r = http.request({ host: "127.0.0.1", port, path: "/" }, (res) => {
    console.log("status", res.statusCode);
    res.resume();
    res.on("end", () => {
      console.log("end");
      try { const x = r.setTimeout(-1); console.log("late neg ret same", x === r); }
      catch (e: any) { console.log("late neg THROW", e.code); }
      srv.close();
    });
  });
  try { const x = r.setTimeout(-1); console.log("neg ret same", x === r); }
  catch (e: any) { console.log("neg THROW", e.name, e.code, JSON.stringify(e.message)); }
  try { const x = r.setTimeout(NaN); console.log("nan ret same", x === r); }
  catch (e: any) { console.log("nan THROW", e.name, e.code, JSON.stringify(e.message)); }
  const z = r.setTimeout(0);
  console.log("zero ret same", z === r);
  const c = r.setTimeout(30, () => console.log("req timeout cb"));
  console.log("cb ret same", c === r);
  r.on("timeout", () => console.log("req timeout event"));
  r.end();
});
