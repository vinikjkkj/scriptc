import { createPool } from "mysql2/promise";

// The pool's first round trip against a port nobody listens on, as the REST app's readiness check does it: pool.execute rejects, the
// application's own handler reports it, and the process keeps running. The error is raised on the socket's connection-error path
// (a pooled connection with no handshake yet); an uncaught throw there kills the process, a rejection is the answer. Server independent:
// port 1 is closed whether or not the workflow's mysql service is up.
async function main(): Promise<void> {
  const pool = createPool({ host: "127.0.0.1", port: 1, user: "u", password: "p", database: "d", connectionLimit: 2, waitForConnections: true, disableEval: true });
  pool.on("connection", () => console.log("connection (must not)"));
  const outcome = await pool.execute("SELECT 1 AS n", []).then(
    () => "reached",
    (err: unknown) => {
      const e = err as NodeJS.ErrnoException;
      return `FAILED to reach: ${e.code} ${e.errno} ${e.syscall} ${e.message}`;
    },
  );
  console.log(outcome);
  const second = await pool.query("SELECT 2 AS n").then(
    () => "reached",
    (err: unknown) => `second FAILED: ${(err as NodeJS.ErrnoException).code}`,
  );
  console.log(second);
  await pool.end();
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  console.log("alive");
}
main().catch((e) => console.log("failed", (e as Error).message));
