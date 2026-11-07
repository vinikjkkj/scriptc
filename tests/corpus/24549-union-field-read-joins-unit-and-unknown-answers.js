// A union of two JavaScript-inferred records whose field answers differ in kind: `port` is the unit-only `null | undefined` on the
// path arm and checked-dynamic `unknown` on the other (ioredis' _getServerAddress). Destructuring and a plain `.port` read both
// join to a dyn answer, each arm boxing its own value, undefined and null included.
/** @param {Record<string, unknown>} options */
function addr(options) {
  if ("path" in options && options.path) {
    return { address: options.path, port: undefined };
  }
  return {
    address: ("host" in options && options.host) || "localhost",
    port: ("port" in options && options.port) || 6379,
  };
}
function ctx(options) {
  const { address, port } = addr(options);
  return { serverAddress: address, serverPort: port };
}
function ctx2(options) {
  const a = addr(options);
  return [a.address, a.port];
}
console.log(JSON.stringify(ctx({ path: "/tmp/s" })), JSON.stringify(ctx({ host: "h", port: 7 })), JSON.stringify(ctx({})));
console.log(JSON.stringify(ctx2({ path: "/tmp/s" })), JSON.stringify(ctx2({ host: "h", port: 7 })));
