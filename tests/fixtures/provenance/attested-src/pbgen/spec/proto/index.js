/* The implementation twin of index.d.ts — the generated runtime. Its
 * presence is the point: a declaration file whose .js sibling this build
 * compiles (provenanceDeclSiblings + declTwinOf) is BETTER provenance than
 * a declaration-only module, and the shapes it declares must map at least
 * as well. The values it exports still fence at their own gates. */
const encodeMsg = (m) => (m.details ? m.details : new Uint8Array(0));

const decodeMsg = (r) => ({
  details: r,
  signature: new Uint8Array([7, 7]),
  count: r.length,
});

export const waproto = {
  Msg: { encode: encodeMsg, decode: decodeMsg },
};

/* The generated TABLE half. Every `parts` value is an ARRAY literal, so
 * its inferred type here is `readonly (A|B)[]` however precisely
 * index.d.ts spells it — a generator writes JS, and JS has no tuples.
 * This is zapo-js's spec/appstate/index.js, WA_APPSTATE_SCHEMAS. */
export const TABLE = Object.freeze({
  Ping: Object.freeze({
    name: "ping",
    version: 1,
    parts: Object.freeze([Object.freeze({ kind: "literal", value: "ping" })]),
  }),
  Mute: Object.freeze({
    name: "mute",
    version: 2,
    parts: Object.freeze([
      Object.freeze({ kind: "literal", value: "mute" }),
      Object.freeze({ kind: "slot", label: "chatJid" }),
    ]),
  }),
  Star: Object.freeze({
    name: "star",
    version: 5,
    parts: Object.freeze([
      Object.freeze({ kind: "literal", value: "star" }),
      Object.freeze({ kind: "slot", label: "remote" }),
      Object.freeze({ kind: "slot", label: "id" }),
    ]),
  }),
});
