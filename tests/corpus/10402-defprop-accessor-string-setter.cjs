// A string-valued accessor: the setter normalises what it stores, and the
// getter reads it back through module.exports. The write comes from a function.
var label = 'none';
Object.defineProperty(module.exports, 'label', {
  get: function () { return label; },
  set: function (v) { label = String(v).toUpperCase(); }
});
module.exports.label = 'alpha';
console.log(module.exports.label);
function relabel(s) { module.exports.label = s + '-' + s.length; }
relabel('beta');
console.log(module.exports.label, label.length);
