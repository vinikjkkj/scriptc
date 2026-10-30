// The timer functions as values: const aliases, a function parameter typed
// with one signature receiving setTimeout, and extra arguments reaching the
// callback exactly as Node passes them.
function run(sched: (cb: () => void, ms: number) => unknown, label: string) {
  sched(() => console.log('run', label), 30);
}
const st = setTimeout;
const sim = setImmediate;
run(st, 'A');
st((x: string, y: number) => console.log('args', x, y), 40, 'X', 9);
sim((a: string) => console.log('imm', a), 'M');
console.log('typeof', typeof st, typeof setInterval);
