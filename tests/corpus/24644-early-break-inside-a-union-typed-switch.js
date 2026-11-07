// An early `break` (inside an if) of a switch whose discriminant is a union or an untyped value (ioredis DataHandler.handleSubscriberReply:
// `if (this.handleUnsolicitedUnsubscribe(replyType)) { break; }`): the desugared chain exits to the end of the switch from the middle of a case body.
/** @param {unknown} v @param {string[]} log */
function handle(v, log) {
  switch (typeof v) {
    case "string": {
      if (v === "stop") break;
      log.push("s:" + v);
      break;
    }
    case "number": {
      for (let i = 0; i < 3; i++) { if (i === 1) break; log.push("n" + i); }
      if (v > 5) { log.push("big"); break; }
      log.push("small");
      break;
    }
    default: {
      if (v === null) { log.push("null"); break; }
      log.push("other");
    }
  }
  log.push("end");
  return log.length;
}
const log = [];
for (const v of ["a", "stop", 1, 9, null, undefined, true]) handle(v, log);
console.log(log.join());
function disc(reply) {
  const t = reply[0];
  switch (t) {
    case "m": { if (reply.length > 5) break; return "m1"; }
    case "u": case "p": { if (reply[1]) { break; } return "u1"; }
    default: { return "d"; }
  }
  return "broke";
}
console.log(disc(["m"]), disc(["m", 1, 2, 3, 4, 5]), disc(["u", 0]), disc(["p", 1]), disc(["q"]));
/** @param {string | number} k @param {string[]} out */
function byUnion(k, out) {
  switch (k) {
    case "a": { if (out.length > 1) break; out.push("a-first"); break; }
    case 2: { if (out.length > 1) { break; } out.push("two"); break; }
    default: { out.push("d" + k); }
  }
  out.push("|");
}
const o = [];
for (const k of ["a", "a", "a", 2, 2, 5]) byUnion(k, o);
console.log(o.join(" "));
