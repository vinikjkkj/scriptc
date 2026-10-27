function Codec(opts, api) { this.api = api; }
exports.encodings = null;
exports.load = function () { exports.encodings = { hi: "there" }; };
exports.codec = function () { return new Codec({}, exports); };
