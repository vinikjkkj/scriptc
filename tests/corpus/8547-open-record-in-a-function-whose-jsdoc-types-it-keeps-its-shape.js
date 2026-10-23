// An object literal written through dynamic keys is an open (dynamic) object
// when nothing the author typed says otherwise. A function whose own JSDoc
// declares what it returns keeps the record: the write must be visible through
// the returned record (a dynamic object crossing into a typed slot is copied).
/**
 * @param {{ tick: () => void }} impls
 * @returns {{ live: { tick: () => void }, set: (name: string, fn: () => void) => void }}
 */
function typed(impls) {
  const live = { ...impls };
  const set = (name, fn) => { live[name] = fn; };
  return { live, set };
}
const t = typed({ tick: () => console.log('real') });
t.live.tick();
t.set('tick', () => console.log('mocked'));
t.live.tick();

// The unannotated control: the open record rule still applies.
function counts(words) {
  return words.reduce(function (acc, w) { acc[w] = w.length; return acc; }, {});
}
console.log(counts(['aa', 'bbb']), Object.keys(counts(['x'])));
function table(keys) {
  var obj = {};
  for (var i = 0; i < keys.length; i++) obj[keys[i]] = i;
  return obj;
}
console.log(table(['p', 'q']));
