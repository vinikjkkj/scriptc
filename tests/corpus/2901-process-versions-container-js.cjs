// The runtime-detection sniff a bundled library opens with, verbatim:
// protobufjs's util.isNode reads `global.process.versions` for its
// TRUTHINESS one link before `.node`, the member that already lowers to a
// compile-time string. There is an object there — the process global is
// always present in a compiled binary and its versions is always an
// object — so the container answers with the components that EXIST.
//
// What is pinned here is only what both worlds agree on. The raw strings
// never appear: process.versions.node and .openssl report the runtime's
// Node COMPATIBILITY TARGET (SEMANTICS.md divergence 60), which is the
// 1531/1639 stance. A component the build does not link is ABSENT, and
// absent is a real answer — Node's own for anything not compiled in.
const isNode = Boolean(
  typeof global !== "undefined" &&
    global &&
    global.process &&
    global.process.versions &&
    global.process.versions.node,
);
console.log(isNode);

// The container as a VALUE, and the two components read THROUGH it: the
// same answers the direct spellings give, so both spellings name one
// object.
const versions = process.versions;
console.log(typeof versions);
console.log(typeof versions.node, versions.node === process.versions.node);
console.log(typeof versions.openssl === "string");
console.log(Object.keys(versions).length > 0);

// A component NEITHER world links — commander's Electron probe, and the
// shape of every "which runtime is this" question a library asks after the
// first one. Nothing declares it, so both read undefined and both take the
// fallback branch.
console.log(process.versions.electron === undefined);
console.log(process.versions.electron ? "electron" : "plain");
