// Plain values cross both ways: numbers, strings, booleans, and arrays and
// records of them. The generated body reads them and returns new ones.
const keys = ['n', 's', 'b', 'arr', 'rec'];
const reads = [];
for (let i = 0; i < keys.length; i++) reads.push('out.' + keys[i] + ' = in_.' + keys[i] + ';');
const gen = new Function('in_', 'const out = {};\n' + reads.join('\n') + '\nout.sum = in_.arr.reduce((p, q) => p + q, 0) + in_.n;\nout.flag = !in_.b;\nreturn out;');
const res = gen({ n: 3, s: 'hi', b: false, arr: [1, 2, 3], rec: { k: 'v' } });
console.log(res.n, res.s, res.b, res.arr.join(','), res.rec.k, res.sum, res.flag);
console.log(JSON.stringify(gen({ n: 0, s: '', b: true, arr: [], rec: {} })));
