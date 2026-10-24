// Control chosen from a finite set of fragments (flags), data inlined as literals (names): the two halves of a
// generate-function style reader.
function reader(name, unsigned, asString) {
  const read = unsigned ? 'p.u()' : 'p.s()';
  const conv = asString ? 'String(' + read + ')' : read;
  return new Function('p', 'var r = {}; r[' + JSON.stringify(name) + '] = ' + conv + '; return r;');
}
function packet(v) { return { u() { return v >>> 0; }, s() { return v | 0; } }; }
for (const flags of [[false, false], [true, false], [false, true], [true, true]]) {
  const f = reader('col ' + flags.join('/'), flags[0], flags[1]);
  console.log(f(packet(-1)), f(packet(5)));
}
console.log(reader('q"uote', true, true)(packet(7)));
