import * as http from "http";
const srv = http.createServer((q, s) => {
  try { const x = q.setTimeout(-1); console.log("ireq neg ret", x === q); }
  catch (e: any) { console.log("ireq neg THROW", e.code); }
  const y = q.setTimeout(20, () => console.log("ireq cb fired"));
  console.log("ireq chain same", y === q);
  setTimeout(() => s.end("late"), 120);
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const r = http.request({ host: "127.0.0.1", port, path: "/" }, (res) => {
    res.resume(); res.on("end", () => { console.log("end"); srv.close(); });
  });
  r.on("error", (e: any) => { console.log("client error", e.code); srv.close(); });
  r.end();
});
