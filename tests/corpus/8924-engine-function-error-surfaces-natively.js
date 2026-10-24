// An engine SyntaxError while the text is compiled, and an engine TypeError
// while the function runs, both surface as ordinary JS exceptions of the
// right class. (Message texts are the engine's own; only the class is
// compared with Node.)
const bad = [];
for (let i = 0; i < 2; i++) bad.push('(');
try {
  new Function('a', 'return a ' + bad.join(''));
} catch (e) {
  console.log(e instanceof SyntaxError, e.name);
}
const thrower = [];
for (let i = 0; i < 1; i++) thrower.push('null.x');
const g = new Function('a', 'return ' + thrower.join(';') + ';');
try {
  g(1);
} catch (e) {
  console.log(e instanceof TypeError, e.name);
}
