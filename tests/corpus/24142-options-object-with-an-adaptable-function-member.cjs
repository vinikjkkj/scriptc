// An options object whose callable member has another signature than the declared one, handed to a function whose
// parameter is `Options | undefined`: the callable adapts and the call goes through (pg-protocol serialize.bind).
"use strict";
/** @typedef {{portal?: string, binary?: boolean, statement?: string, values?: any[], valueMapper?: (param: any, index: number) => any}} BindOpts */
const serialize = {
  /** @param {BindOpts} [config] */
  bind: (config = {}) => {
    const portal = config.portal || "";
    const values = config.values || [];
    const m = config.valueMapper ? String(config.valueMapper("x", 0)) : "nomap";
    return portal + "|" + (config.statement || "") + "|" + String(config.binary || false) + "|" + values.length + "|" + m;
  },
};
function prep(val, seen) { return val === undefined ? null : String(val) + (seen === undefined ? "" : "s"); }
class Q {
  constructor() { this.portal = undefined; this.name = undefined; this.values = ["a", 1]; this.binary = undefined; }
  go(conn) { return conn.bind({ portal: this.portal, statement: this.name, values: this.values, binary: this.binary, valueMapper: prep }); }
}
class Conn { bind(config) { return serialize.bind(config); } }
console.log(new Q().go(new Conn()));
console.log(new Q().go(new Conn()));
const q2 = new Q();
q2.values = ["x"];
q2.portal = "p9";
q2.name = "stmt";
console.log(q2.go(new Conn()));
console.log(new Conn().bind(undefined));
