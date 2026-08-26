// The shape that stopped `lru.min`, and with it mysql2: a factory returns an
// object literal whose members are METHODS over closure state and whose LAST
// members are GETTERS over the same state. The literal's contextual type is
// `any`, so it is a dyn object; the getters are live, not frozen copies.
'use strict';
function take(o) { return o; }

function createCache(max) {
  let size = 0;
  const items = [];
  return take({
    add(k) {
      if (size === max) items.shift();
      else size++;
      items.push(k);
    },
    has(k) { return items.indexOf(k) >= 0; },
    get max() { return max; },
    get size() { return size; },
    get available() { return max - size; },
    get newest() { return size === 0 ? "none" : items[items.length - 1]; },
  });
}

const c = createCache(3);
console.log(c.max + " " + c.size + " " + c.available + " " + c.newest);
c.add("a");
c.add("b");
console.log(c.max + " " + c.size + " " + c.available + " " + c.newest);
c.add("c");
c.add("d");
console.log(c.max + " " + c.size + " " + c.available + " " + c.newest);
console.log(String(c.has("a")) + " " + String(c.has("d")));
console.log(JSON.stringify(Object.keys(c)));

// Two caches do not share state: each getter closes over its own binding.
const d = createCache(1);
d.add("z");
console.log(c.size + " " + d.size + " " + d.newest);
