// The connection_config shape: a static method of a program class tests an untyped
// parameter against its own class, and a subclass instance passed in must answer true.
class ConnectionConfig {
  host = "localhost";
  static queryOptions(config: unknown, overrides: Record<string, unknown>): Record<string, unknown> {
    if (!(config instanceof ConnectionConfig)) {
      return Object.assign({}, config as object, overrides);
    }
    return { host: config.host, ...overrides };
  }
}
class SubConfig extends ConnectionConfig {
  port = 3306;
}
console.log(JSON.stringify(ConnectionConfig.queryOptions(new ConnectionConfig(), { x: 1 })));
console.log(JSON.stringify(ConnectionConfig.queryOptions(new SubConfig(), { x: 2 })));
console.log(JSON.stringify(ConnectionConfig.queryOptions({ host: "h", y: 3 }, { x: 4 })));
console.log(JSON.stringify(ConnectionConfig.queryOptions(null, {})));
