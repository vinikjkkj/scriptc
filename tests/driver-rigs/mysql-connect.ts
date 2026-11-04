import { createConnection } from "mysql2/promise";

// The connection step: connect to a closed local port and report the error exactly as Node's mysql2 does.
async function main(): Promise<void> {
  try {
    const conn = await createConnection({ host: "127.0.0.1", port: 1, user: "u", password: "p", database: "d" });
    console.log("connected");
    await conn.end();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log(err.code, err.errno, err.syscall, err.message);
  }
}
main().catch((e) => console.log("failed", (e as Error).message));
