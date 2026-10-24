// A generated function calls back into a native closure passed as an
// argument: the engine calls the host function, and its result returns to
// the generated body.
const ops = [];
for (let i = 0; i < 2; i++) ops.push('cb(' + (i + 1) + ')');
const body = 'return [' + ops.join(', ') + '];';
const gen = new Function('cb', body);
const doubled = gen((x) => x * 2);
console.log(doubled.length, doubled[0], doubled[1]);
let calls = 0;
const counted = gen((x) => { calls++; return x + 100; });
console.log(counted[0], counted[1], calls);
