// The text is concatenated, templated, joined and bound through consts, but every piece is known at build time.
const PRELUDE = 'var total = 0;';
const STEP = 'total += a[i];';
const body = PRELUDE + ' for (var i = 0; i < a.length; i++) { ' + STEP + ' } return total;';
const sum = new Function('a', body);
console.log(sum([1, 2, 3, 4]), sum([]));

const op = '*';
const mul = new Function('x', 'y', `return x ${op} y`);
console.log(mul(6, 7));

const lines = ['var out = [];', 'for (var i = 0; i < n; i++) out.push(i * i);', 'return out.join(",");'];
const squares = new Function('n', lines.join('\n'));
console.log(squares(6));

function build(kind) {
  const ret = kind === 'a' ? 'return 1;' : 'return 2;';
  return new Function(ret);
}
console.log(build('a')(), build('b')());

const num = 3.5, flag = true, nothing = null;
const consts = new Function('return [' + num + ', ' + flag + ', ' + nothing + '].length');
console.log(consts());
