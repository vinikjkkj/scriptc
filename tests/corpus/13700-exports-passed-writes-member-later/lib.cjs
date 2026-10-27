var saved = null;
exports.a = 1;
exports.keep = function keep(o) { saved = o; };
exports.flush = function flush() { saved.b = 7; };
exports.keep(exports);
