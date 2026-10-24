// `new Function` whose text is assembled in a loop from run-time data is not
// foldable at build time; the text runs on the embedded engine and the
// function it builds is called natively with native arguments.
const cols = ['x0', 'x1', 'x2'];
const lines = [];
for (let i = 0; i < cols.length; i++) lines.push('  ' + cols[i] + ' = a * ' + (i + 1) + ';');
const src = 'let ' + cols.join(', ') + ' = 0;\n' + lines.join('\n') + '\n  return x0 + x1 + x2;';
const f = new Function('a', src);
console.log(f(2), f(5));
console.log(typeof f, f.length);
