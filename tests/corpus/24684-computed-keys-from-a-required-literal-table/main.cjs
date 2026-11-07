"use strict";
const decoder_1 = require("./decoder.cjs");
const legacy = { [decoder_1.RESP_TYPES.NUMBER]: Number, [decoder_1.RESP_TYPES.SET]: Array };
const resp3 = { [decoder_1.RESP_TYPES.SIMPLE_STRING]: Buffer, [decoder_1.RESP_TYPES.BIG_NUMBER]: String, [decoder_1.RESP_TYPES.SET]: Array };
function getMapping(o) {
  const base = o.replyMapping === "resp3" ? resp3 : legacy;
  return o.stringNumbers ? { ...base, [decoder_1.RESP_TYPES.NUMBER]: String } : base;
}
const a = getMapping({ replyMapping: "resp3" });
const b = getMapping({ stringNumbers: true });
console.log(Object.keys(a).join(","), a[43] === Buffer, a[126] === Array);
console.log(Object.keys(b).join(","), b[58] === String, b[126] === Array);
