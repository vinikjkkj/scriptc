// @dynamic
// An unannotated array grown by push in a loop has an 'any' element type,
// which the island lane maps to jsval. join must still render every element
// JS-exactly (strings, empty array, undefined arms printing empty).
const cols = ['a', 'b', 'c'];
const lines = [];
for (let i = 0; i < cols.length; i++) lines.push('  ' + cols[i] + ' = ' + (i + 1) + ';');
console.log(lines.join('\n'));
const none = [];
console.log(JSON.stringify(none.join('-')));
const mixed = [];
for (let i = 0; i < 4; i++) mixed.push(i % 2 === 0 ? 'x' + i : undefined);
console.log(mixed.join(','));
const nums = [];
for (let i = 0; i < 3; i++) nums.push(i * 10);
console.log(nums.join(' | '));
