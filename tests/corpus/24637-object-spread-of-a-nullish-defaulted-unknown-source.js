// { ...(options.redisOptions ?? {}) } over a member whose type has no static record (ioredis Cluster): the copy is a dynamic object, so the
// later delete of a key and the added key land in it as in Node. Spreads with a plain default, no default and a || default included.
/** @typedef {{ redisOptions?: unknown }} Opts */
/** @param {Opts} options */
function make(options) {
  const redisOptions = { ...(options.redisOptions ?? {}) };
  delete redisOptions.himportFieldsets;
  redisOptions.extra = 1;
  console.log(JSON.stringify(redisOptions), Object.keys(redisOptions).join());
}
make({ redisOptions: { a: 1, himportFieldsets: ["x"], b: "two" } });
make({});
function viaOr(o) { const c = { ...(o.sub || {}), tag: "t" }; delete c.drop; c.more = [1]; console.log(JSON.stringify(c)); }
viaOr({ sub: { drop: 1, keep: 2 } });
viaOr({});
function sink(x) { return Object.keys(x).join(); }
function viaSink(options) { const c = { ...(options.redisOptions ?? {}) }; delete c.a; return sink(c); }
console.log(viaSink({ redisOptions: { a: 1, b: 2 } }), viaSink({}));
