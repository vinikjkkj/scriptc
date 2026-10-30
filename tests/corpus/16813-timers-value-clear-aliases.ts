// clearTimeout, clearInterval and clearImmediate as values: a cancelled
// timeout, a cancelled immediate and an interval cleared from its own callback.
const ct = clearTimeout;
const cim = clearImmediate;
const ci = clearInterval;
const st = setTimeout;
const sim = setImmediate;
const si = setInterval;
const dead = st(() => console.log('never'), 50);
ct(dead);
const deadI = sim(() => console.log('never imm'));
cim(deadI);
let k = 0;
const iv = si(() => {
  console.log('iv', k++);
  if (k === 2) ci(iv);
}, 2);
st(() => console.log('timeout after clears'), 30);
