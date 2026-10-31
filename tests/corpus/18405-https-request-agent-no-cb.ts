// https.request through an explicit Agent with NO response callback (the
// https.requestAgent row): the request is sent, the server answers, and the
// client discards the response. The server's 'request' listener reports it.
import { readFileSync } from "node:fs";
import * as https from "node:https";

const key = readFileSync("tests/fixtures/server/certs/localhost-key.pem", "utf8");
const cert = readFileSync("tests/fixtures/server/certs/localhost.pem", "utf8");
const agent = new https.Agent({ keepAlive: false });
const srv = https.createServer({ key, cert }, (req, res) => {
  console.log("served", req.method);
  res.end("discarded");
  srv.close();
  agent.destroy();
});
srv.listen(0, () => {
  const port = (srv.address() as any).port;
  const r = https.request({ host: "localhost", port, path: "/", method: "GET", agent, rejectUnauthorized: false });
  r.on("error", () => {});
  r.end();
});
