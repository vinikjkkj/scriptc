const factory =
  (options = {}) =>
  (name) => {
    const secure = typeof options.overrideIsSecure === 'undefined' ? 'default' : options.overrideIsSecure;
    if (options.serverKey) return name + ':key=' + options.serverKey + ':' + secure;
    if (options.onKey) options.onKey(name);
    return name + ':' + secure;
  };

console.log(factory()('a'));
console.log(factory({ serverKey: 'K' })('b'));
console.log(factory({ overrideIsSecure: false, onKey: (n) => console.log('hook', n) })('c'));
const shared = {};
function describe(opts = {}) {
  return Object.keys(opts).length + ':' + (opts.mode || 'none');
}
console.log(describe(), describe({ mode: 'x', extra: 1 }), describe(shared));
