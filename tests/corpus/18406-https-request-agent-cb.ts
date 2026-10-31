// https.request through an explicit Agent WITH a response callback (the
// https.requestAgentCb row): the response body arrives through the callback.
import { readFileSync } from "node:fs";
import * as https from "node:https";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");
const srv = https.createServer({ key, cert }, (req, res) => { res.end("agent " + req.method); });
srv.listen(0, () => {
  const port = (srv.address() as any).port;
  const agent = new https.Agent({ keepAlive: false });
  const r = https.request({ host: "localhost", port, path: "/", method: "GET", agent, rejectUnauthorized: false }, (res) => {
    res.setEncoding("utf8");
    let body = "";
    res.on("data", (c: Buffer) => { body += c.toString(); });
    res.on("end", () => {
      console.log("body", body);
      srv.close();
      agent.destroy();
    });
  });
  r.end();
});
