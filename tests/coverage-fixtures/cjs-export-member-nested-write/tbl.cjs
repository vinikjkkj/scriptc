// `module.exports.<n> = v` written from INSIDE a function. Node attaches
// the property to the same export object either way; the only question is
// whether this compiler has storage for the member, and the answer is NOT
// "where the statement sits" -- it is "did the file attach this member at
// top level". A top-level attachment registers an export global and the
// CJS export-member READ arm already answers from it ANYWHERE in the file,
// nested reads included. So a nested write to one of those members assigns
// the very global its own reads come from.
//
// A PAIR on purpose. The refused half is the members with no top-level
// attachment at all: there is no global, no storage, and nothing to
// assign -- widening to them would need a first-class mutable export
// object, which is the wall this family's other sites sit behind. Keeping
// the refusal asserted makes a later widening FAIL this test instead of
// quietly passing it.
'use strict';

// Top-level attachments: each registers the global.
module.exports.encodings = null;
module.exports.cache = { a: 1 };
exports.bare = 0; //                     the bare spelling, same storage

module.exports.getCodec = function getCodec (e) {
  // --- ADMITTED: nested writes to members the file attached above. ---
  if (!module.exports.encodings) { //    a nested READ, which already lowered
    module.exports.encodings = { b: 2 };
  }
  module.exports.cache = { c: 3 };
  exports.bare = 1;

  // --- REFUSED: members no top-level statement ever attached. ---
  module.exports.skipWarning = true;
  exports.supportsStreams = true;
  return e;
};
