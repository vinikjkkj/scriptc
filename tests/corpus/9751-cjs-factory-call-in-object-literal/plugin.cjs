function factory(opts) { return () => 'k=' + (opts.k ?? 'none'); }
function helper(x) { return 'h:' + x; }
module.exports = factory;
module.exports.helper = helper;
