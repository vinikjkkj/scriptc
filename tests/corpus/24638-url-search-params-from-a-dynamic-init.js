// new URLSearchParams(x) with x an untyped value (ioredis parseURL: rawUrl.slice(qIdx + 1) over an untyped parameter): the run-time kind picks the
// WHATWG form: string/number text, null and undefined the empty list, an array of pairs, a plain object, and ERR_INVALID_TUPLE for a bad row.
function isInt(v) { return typeof v === "string" && /^\d+$/.test(v) || typeof v === "number"; }
function parseURL(url) {
  if (isInt(url)) return { port: url };
  const rawUrl = url;
  const qIdx = rawUrl.indexOf("?");
  const options = {};
  if (qIdx !== -1) {
    const params = new URLSearchParams(rawUrl.slice(qIdx + 1));
    params.forEach((value, key) => { options[key] = value; });
  }
  return options;
}
console.log(JSON.stringify(parseURL("/tmp/redis.sock?db=2&x=y")), JSON.stringify(parseURL("/p")), JSON.stringify(parseURL(6379)));
function mk(x) { const p = new URLSearchParams(x); const out = []; p.forEach((v, k) => out.push(k + "=" + v)); return out.join("&"); }
console.log(mk("?a=1&b=2"), mk(5), mk(undefined), mk(null), mk([["k", "v"], ["k2", 3]]), mk({ x: 1, y: "z" }), mk("ab=c"), mk(function f() {}));
try { mk([["only"]]); } catch (e) { console.log(e.code, e.constructor.name); }
try { mk([5]); } catch (e) { console.log(e.code); }
