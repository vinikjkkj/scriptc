// A module-level `var` and an export member of the same name are two bindings:
// writing module.exports.label must not change the var, and the var must not
// change the export. The values are heap strings, so a shared storage would
// also double-release at exit.
var label = ['no', 'ne'].join('');
module.exports.label = ['al', 'pha'].join('');
console.log(module.exports.label, label);
label = label + '!';
console.log(module.exports.label, label);
