// The pool.js shape: the class instance is read through a destructured
// field of another object, then cloned in a method.
class ConnectionConfig {
  host: string;
  user: string | undefined;
  timeout: number;
  ssl: { reject: boolean } | false;
  attrs: { [k: string]: string };
  constructor(options: { host?: string; user?: string; timeout?: number; ssl?: boolean }) {
    this.host = options.host || "localhost";
    this.user = options.user || undefined;
    this.timeout = options.timeout === undefined ? 10000 : options.timeout;
    this.ssl = options.ssl ? { reject: true } : false;
    this.attrs = { _client_name: "Node-MySQL-2" };
  }
}

class Pool {
  config: { connectionConfig: ConnectionConfig; limit: number };
  constructor(options: { host?: string; user?: string }) {
    this.config = { connectionConfig: new ConnectionConfig(options), limit: 10 };
  }
  createConnectionConfig(): ConnectionConfig {
    const { connectionConfig } = this.config;
    return Object.create(
      Object.getPrototypeOf(connectionConfig),
      Object.getOwnPropertyDescriptors(connectionConfig)
    );
  }
}

const pool = new Pool({ host: "db.local", user: "app" });
const a = pool.createConnectionConfig();
const b = pool.createConnectionConfig();
console.log(a instanceof ConnectionConfig, a.host, a.user, a.timeout, a.ssl);
a.timeout = 5;
a.attrs["x"] = "1";
console.log(pool.config.connectionConfig.timeout, b.timeout, b.attrs["x"], a.attrs === b.attrs);
console.log(Object.keys(a).join(","));
console.log(Object.keys(a).join(",") === Object.keys(pool.config.connectionConfig).join(","));
console.log(b.host === pool.config.connectionConfig.host, a !== b);
