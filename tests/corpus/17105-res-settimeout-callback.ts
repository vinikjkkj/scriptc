import * as http from "http";
const srv = http.createServer((q, s) => {
  try { const x = s.setTimeout(-1); console.log("res neg ret", x === s); }
  catch (e: any) { console.log("res neg THROW", e.name, e.code, JSON.stringify(e.message)); }
  const y = s.setTimeout(20, () => console.log("res cb fired"));
  console.log("res chain same", y === s);
  setTimeout(() => {
    s.end("late");
  }, 150);
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const r = http.request({ host: "127.0.0.1", port, path: "/" }, (res) => {
    console.log("status", res.statusCode); res.resume(); res.on("end", () => { console.log("end"); srv.close(); });
  });
  r.end();
});
