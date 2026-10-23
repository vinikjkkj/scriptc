function ins(items, index, newItems) { items.splice(index, 0, ...newItems); return items; }
console.log(ins([1, 2, 3], 1, [9, 8]), ins([], 0, []), ins(['a'], 5, ['z', 'y', 'x']));
function rm(items, i, n, more) { const r = items.splice(i, n, ...more); return [r, items]; }
console.log(JSON.stringify(rm([1, 2, 3, 4], 1, 2, ['x'])), JSON.stringify(rm([1, 2], 0, 1, [])));
function pu(a, xs) { a.push(...xs, 'end'); return a.length; }
console.log(pu([], [1, 2, 3]), pu(['q'], []));
function cc(a, ...rest) { return a.concat(...rest); }
console.log(JSON.stringify(cc([1], [2], [3, 4])));
try { ins([1], 0, 5); } catch (e) { console.log(e.name, e.message); }
try { ins([1], 0, undefined); } catch (e) { console.log(e.name, e.message); }
function st(s, args) { return s.slice(...args); }
console.log(st('hello', [1, 3]), JSON.stringify(st([1, 2, 3, 4], [2])));
