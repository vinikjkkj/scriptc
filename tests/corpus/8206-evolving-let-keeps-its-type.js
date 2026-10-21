// `let x;` with no initializer: every assignment stores one type, so the
// binding holds that type (or undefined before the first assignment).
function parse(address) {
  let parsed;
  if (address.startsWith('http')) {
    parsed = new URL(address);
  } else {
    parsed = new URL('http://' + address);
  }
  return parsed.hostname + ':' + (parsed.port || 'default') + parsed.pathname;
}

function late(flag) {
  let box;
  const before = box === undefined;
  if (flag) box = { n: 1 };
  return before + '/' + (box === undefined ? 'none' : 'n=' + box.n);
}

console.log(parse('http://one.example:81/p'));
console.log(parse('two.example/q'));
console.log(late(true), late(false));

let count;
for (let i = 0; i < 3; i++) count = i * 2;
console.log(count);
