"use strict";
// dns.lookup held as a value: `order` ("verbatim", "ipv4first", "ipv6first") and the older `verbatim` flag decide which family comes first,
// for the first answer and for `all`; `order` wins over `verbatim`, `verbatim: false` is ipv4first, and a bad value throws Node's errors.
// localhost resolves to both families on the hosts that run the corpus, and each run compares the two sides on the same host.
const dns = require("node:dns");
const lookup = dns.lookup;
const t = (label, options) => {
  try {
    lookup("127.0.0.1", options, () => {});
    console.log(label, "ok");
  } catch (e) {
    console.log(label, e.name, e.code, JSON.stringify(e.message), Object.keys(e).join(","));
  }
};
t("order unknown", { order: "x" });
t("order number", { order: 5 });
t("order null", { order: null });
t("order undefined", { order: undefined });
t("verbatim string", { verbatim: "yes" });
t("verbatim number", { verbatim: 0 });
t("verbatim null", { verbatim: null });
t("order and bad verbatim", { order: "verbatim", verbatim: "yes" });
const cases = [
  ["verbatim", (all) => ({ all, order: "verbatim" })],
  ["ipv4first", (all) => ({ all, order: "ipv4first" })],
  ["ipv6first", (all) => ({ all, order: "ipv6first" })],
  ["verbatim true", (all) => ({ all, verbatim: true })],
  ["verbatim false", (all) => ({ all, verbatim: false })],
  ["order wins over verbatim false", (all) => ({ all, order: "ipv6first", verbatim: false })],
  ["order wins over verbatim true", (all) => ({ all, order: "ipv4first", verbatim: true })],
  ["order null, verbatim false", (all) => ({ all, order: null, verbatim: false })],
];
let i = 0;
let label = "";
let make = null;
let text = "";
// the callbacks are plain values, so their parameters carry no declared type: `all` answers a list where the plain form answers a string
const onFirst = (err, address, family) => {
  console.log(label, "first", err, address, family, text.startsWith('[{"address":"' + address + '","family":' + family + "}"));
  next();
};
const onAll = (err, list) => {
  text = JSON.stringify(list);
  console.log(label, "all", err, text);
  lookup("localhost", make(false), onFirst);
};
const next = () => {
  if (i === cases.length) return;
  label = cases[i][0];
  make = cases[i][1];
  i++;
  lookup("localhost", make(true), onAll);
};
const onLiteral = (e, list) => console.log("literal", JSON.stringify(list));
// literals never reach the resolver: the order option does not touch them
lookup("::1", { all: true, order: "ipv4first" }, onLiteral);
lookup("127.0.0.1", { all: true, order: "ipv6first" }, onLiteral);
setTimeout(next, 50);
