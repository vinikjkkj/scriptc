'use strict';
// A CJS module attaches members to module.exports from inside a function body: a function value, a boolean, and a later alias (iconv-lite's enableStreamingAPI shape). Reads see the writes in source order.
module.exports = {};
module.exports.getEncoder = function (e) { return 'E' + e; };
function enableStreamingAPI(streamModule) {
  module.exports.encodeStream = function encodeStream(encoding) {
    return module.exports.getEncoder(encoding) + '!';
  };
  module.exports.supportsStreams = streamModule !== undefined;
}
console.log(module.exports.encodeStream === undefined, module.exports.supportsStreams);
let streamModule = JSON.parse('{"Transform": 1}');
if (streamModule && streamModule.Transform) {
  enableStreamingAPI(streamModule);
  module.exports.decodeStream = module.exports.encodeStream;
} else {
  module.exports.encodeStream = module.exports.decodeStream = function () { throw new Error('no streams'); };
}
console.log(module.exports.encodeStream('x'), module.exports.supportsStreams, module.exports.decodeStream('y'));
const late = module.exports.encodeStream;
console.log(late('z'), typeof module.exports.skipDecodeWarning);
