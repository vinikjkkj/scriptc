import * as http from "http";
const srv = http.createServer((q, s) => {
  s.end("ok");
  try { const x = s.setTimeout(-1); console.log("sync after end ret", x === s); }
  catch (e: any) { console.log("sync after end THROW", e.code); }
  setTimeout(() => {
    try { const x = s.setTimeout(-1); console.log("late ret", x === s); }
    catch (e: any) { console.log("late THROW", e.code); }
    try { s.setTimeout(20, () => console.log("late cb")); console.log("late cb set"); }
    catch (e: any) { console.log("late cb THROW", e.code); }
  }, 50);
});
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const r = http.request({ host: "127.0.0.1", port, path: "/" }, (res) => {
    res.resume(); res.on("end", () => { console.log("client end"); setTimeout(() => srv.close(), 200); });
  });
  r.end();
});
