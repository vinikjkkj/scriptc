import * as http from "http";
const srv = http.createServer((q, s) => { /* never answers */ });
srv.listen(0, "127.0.0.1", () => {
  const port = srv.address().port;
  const agent = new http.Agent({ timeout: 50 });
  const r = http.request({ host: "127.0.0.1", port, path: "/", agent }, () => console.log("response"));
  r.on("timeout", () => { console.log("req timeout event"); r.destroy(); });
  r.on("error", (e: any) => console.log("req error", e.code));
  r.on("close", () => { console.log("req closed"); srv.close(); });
  r.end();
});
