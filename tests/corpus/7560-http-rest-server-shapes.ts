// The REST-server shapes a JSON API is built out of, end to end over a
// real listening socket: method dispatch (GET/POST/DELETE) off req.method,
// a query string split off req.url, a shared-secret header check answering
// 401 before the route runs, POST body accumulation to a JSON.parse round
// trip, JSON.stringify bodies under an explicit content-type, and a 404
// tail. Strict ping-pong — one exchange in flight at a time — so every
// line is causally ordered; the server closes itself from the last route.
import { createServer, request } from "node:http";
import type { IncomingMessage } from "node:http";

const SECRET = "s3cr3t";

interface Item {
  id: number;
  name: string;
}

const items: Item[] = [{ id: 1, name: "alpha" }];

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

const server = createServer((req, res) => {
  const raw = req.url !== undefined ? req.url : "/";
  const qIdx = raw.indexOf("?");
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const query = qIdx === -1 ? "" : raw.slice(qIdx + 1);
  const method = req.method !== undefined ? req.method : "GET";

  // The shared-secret gate runs before every route but /health.
  if (path !== "/health") {
    const auth = req.headers["x-api-key"];
    if (auth !== SECRET) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
  }

  if (method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true, items: items.length });
    return;
  }

  if (method === "GET" && path === "/items") {
    sendJson(res, 200, { query: query, items: items });
    return;
  }

  if (method === "POST" && path === "/items") {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      const parsed = JSON.parse(body) as { name: string };
      const item: Item = { id: items.length + 1, name: parsed.name };
      items.push(item);
      console.log(`srv created id=${item.id} name=${item.name}`);
      sendJson(res, 201, { created: item });
    });
    return;
  }

  if (method === "DELETE" && path === "/items") {
    const removed = items.length;
    items.length = 0;
    sendJson(res, 200, { removed: removed });
    return;
  }

  sendJson(res, 404, { error: "not_found", path: path });
});

/** One exchange: send `body` (or nothing), read the whole response, log a
 * single line, then hand control to `next`. */
function exchange(
  tag: string,
  port: number,
  method: string,
  path: string,
  key: string | undefined,
  body: string | undefined,
  next: () => void,
): void {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers["x-api-key"] = key;
  if (body !== undefined) headers["content-type"] = "application/json";
  const req = request({ port: port, method: method, path: path, headers: headers }, (res: IncomingMessage) => {
    let text = "";
    res.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    res.on("end", () => {
      const status = res.statusCode !== undefined ? res.statusCode : -1;
      const ctype = res.headers["content-type"];
      console.log(
        `${tag} status=${status} ctype=${ctype !== undefined ? ctype : "-"} body=${text}`,
      );
      next();
    });
  });
  if (body !== undefined) req.write(body);
  req.end();
}

const listening = server.listen(0, "127.0.0.1", () => {
  const port = listening.address().port;
  console.log(`listening: ${port === server.address().port ? "ports agree" : "ports differ"}`);
  exchange("health", port, "GET", "/health", undefined, undefined, () => {
    exchange("noauth", port, "GET", "/items", undefined, undefined, () => {
      exchange("badauth", port, "GET", "/items", "wrong", undefined, () => {
        exchange("list", port, "GET", "/items?limit=10", SECRET, undefined, () => {
          exchange("create", port, "POST", "/items", SECRET, '{"name":"beta"}', () => {
            exchange("list2", port, "GET", "/items", SECRET, undefined, () => {
              exchange("missing", port, "GET", "/nope", SECRET, undefined, () => {
                exchange("delete", port, "DELETE", "/items", SECRET, undefined, () => {
                  exchange("list3", port, "GET", "/items", SECRET, undefined, () => {
                    server.close(() => console.log("closed"));
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
