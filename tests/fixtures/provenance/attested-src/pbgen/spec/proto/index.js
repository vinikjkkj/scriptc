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
