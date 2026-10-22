function copy(target, source) {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  }
  return target;
}

function keysOf(bag) {
  const out = [];
  for (const k in bag) out.push(k);
  return out.join(',');
}

console.log(JSON.stringify(copy({ a: 1 }, { b: 2, c: 'x' })));
console.log(keysOf({ z: 1, y: 2 }), keysOf({}), keysOf(null), keysOf(undefined));
console.log(keysOf([10, 20]), keysOf('ab'));

const def = ['a', 'b'];
const picked = [];
for (const i in def) picked.push(def[i]);
let j;
for (j in def) picked.push(def[j] + j);
console.log(picked.join(','));
