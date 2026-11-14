// The zapo-js client constructed the way an application constructs it, run (not just compiled): a MySQL-backed store bundle, then one WaClient per session over
// that bundle with the REST app's option shape, event handlers wired, and the per-session store view taken. Nothing connects: the pool opens no socket and the
// clients never call connect. The line it prints is deterministic and the run compares it with Node's, so a startup crash (a binary that dies in the
// WaClientImpl constructor) fails this entry where the compile-only zapo-core entry stays green.
import { WaClient, createStore } from "zapo-js";
import { createMysqlPool, createMysqlStore } from "@zapo-js/store-mysql";

interface Session {
  readonly id: string;
  readonly client: WaClient;
  readonly createdMs: number;
  qr: string | null;
  events: number;
}

async function main(): Promise<void> {
  const pool = createMysqlPool({
    host: "127.0.0.1",
    port: 3306,
    user: "u",
    password: "p",
    database: "d",
    connectionLimit: 2,
    waitForConnections: true,
  });
  const mysql = createMysqlStore({ pool, tablePrefix: "t_" });
  const rootStore = createStore({
    backends: { mysql },
    providers: {
      auth: "mysql",
      signal: "mysql",
      preKey: "mysql",
      session: "mysql",
      identity: "mysql",
      senderKey: "mysql",
      appState: "mysql",
      privacyToken: "mysql",
      messages: "mysql",
      threads: "mysql",
      contacts: "mysql",
    },
  });

  const newClient = (id: string): WaClient =>
    new WaClient({
      store: rootStore,
      sessionId: id,
      connectTimeoutMs: 30000,
      deviceBrowser: "Chrome",
      deviceOsDisplayName: "Windows",
      chatSocketUrls: undefined,
      testHooks: undefined,
    });

  const sessions: Session[] = [];
  for (const id of ["drive", "second"]) {
    const sess: Session = { id, client: newClient(id), createdMs: 0, qr: null, events: 0 };
    sess.client.on("auth_qr", (e) => {
      sess.qr = e.qr;
      sess.events++;
    });
    sess.client.on("auth_paired", () => {
      sess.events++;
    });
    sess.client.on("message", () => {
      sess.events++;
    });
    sessions.push(sess);
    void rootStore.session(id);
  }
  // a function-typed member read as a value off a record that holds a closure over class instances (the shape a session table has)
  const table = sessions.map((s) => ({ id: s.id, describe: () => s.id + ":" + s.events + ":" + (s.qr === null ? "no-qr" : "qr") }));
  const describe = table[0]!.describe;
  console.log("zapo startup", sessions.length, typeof sessions[0]!.client.message.send, typeof sessions[0]!.client.connect, describe(), table[1]!.describe());
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.log("failed", (e as Error).message);
  process.exit(1);
});
