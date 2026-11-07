// `"sentinels" in options && options.sentinels` over a typed options object (ioredis Redis.connect): the `in` test narrows the receiver to
// `Opts & Record<"sentinels", unknown>`, and the guarded read answers the key the caller's object owns (or undefined when it has none).
/** @typedef {{ tls?: boolean, noDelay?: boolean, enableTLSForSentinelMode?: boolean }} Opts */
/** @param {Opts} options */
function ev(options) {
  let e = options.tls ? "secureConnect" : "connect";
  if ("sentinels" in options && options.sentinels && !options.enableTLSForSentinelMode) {
    e = "connect";
  }
  return e;
}
console.log(ev({ tls: true }), ev({ tls: true, sentinels: [1] }), ev({ sentinels: [] }), ev({ tls: true, sentinels: [1], enableTLSForSentinelMode: true }));
/** @param {Opts} options */
function show(options) {
  return "extra" in options ? String(options.extra) + ":" + typeof options.extra : "none";
}
console.log(show({}), show({ extra: 7 }), show({ extra: "s", tls: false }), show({ extra: undefined }));
const own = { tls: true };
console.log(ev(own), show(own));
