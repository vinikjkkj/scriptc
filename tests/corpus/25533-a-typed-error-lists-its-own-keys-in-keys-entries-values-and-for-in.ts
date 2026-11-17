// A plain typed Error: nothing is own and enumerable until the program assigns `name`.
const quiet = new TypeError('t');
console.log(Object.keys(quiet).length, JSON.stringify(Object.entries(quiet)), JSON.stringify(Object.values(quiet)));
const pe = new Error('x');
pe.name = 'P';
console.log(Object.keys(pe).join(','), JSON.stringify(Object.entries(pe)), JSON.stringify(Object.values(pe)));
const seen: string[] = [];
for (const k in pe) seen.push(k);
console.log(seen.join(','));
const named = new RangeError('r');
named.name = 'RangeError';
console.log(Object.keys(named).join(','));
