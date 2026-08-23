// The http-proxy-pipe driver: a GET and a bodied POST through the proxy
// (the pipe legs both ways), then /quit. Connection: close per request so
// the sockets drain.
import { request } from "node:http";

const port = Number(process.argv[2]);

function go(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers: { connection: "close" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          console.log(
            `${method} ${path} -> ${res.statusCode} xp=${res.headers["x-proxied"] ?? "-"} body=${Buffer.concat(chunks).toString("utf8")}`,
          );
          resolve();
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

await go("GET", "/hello");
await go("POST", "/echo", "The quick brown fox");
await go("GET", "/quit");
console.log("driver done");
