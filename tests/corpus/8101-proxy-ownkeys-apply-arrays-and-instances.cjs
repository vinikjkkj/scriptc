// Proxy beyond get/set: ownKeys + getOwnPropertyDescriptor feeding
// Object.keys/values/entries and JSON.stringify (keys the target lacks are
// dropped by Object.keys, trap order wins), an apply trap on a function
// target, a get trap reading an ARRAY target with negative indices, an
// object whose METHODS run with the proxy as `this` (their own accesses hit
// the traps), proxies of proxies, and sloppy-mode silence for a falsish set. Node is
// the oracle.
const show = (fn) => {
  try {
    console.log("ok", fn());
  } catch (e) {
    console.log(`${e.name}|${e.message}`);
  }
};

show(() => {
  const p = new Proxy(/** @type {any} */ ({ a: 1, b: 2, hidden: 3 }), {
    ownKeys(t) {
      return ["b", "a", "ghost"];
    },
  });
  return [Object.keys(p), Object.values(p), JSON.stringify(Object.entries(p))];
});
show(() => {
  const p = new Proxy(/** @type {any} */ ({ a: 1, b: 2 }), {
    ownKeys() {
      return ["a", "b"];
    },
    getOwnPropertyDescriptor(t, k) {
      return k === "a" ? { value: 1, enumerable: true, configurable: true } : undefined;
    },
  });
  return Object.keys(p);
});
show(() => {
  const p = new Proxy(/** @type {any} */ ({ x: 1, y: [1, 2] }), {
    get(t, k) {
      return k === "x" ? 100 : t[k];
    },
  });
  return JSON.stringify(p);
});
show(() => {
  const p = new Proxy(/** @type {any} */ ({ a: 1 }), { ownKeys: 5 });
  return Object.keys(p);
});
show(() => Object.keys(new Proxy(/** @type {any} */ ({ a: 1 }), { ownKeys() { return 5; } })));

show(() => {
  const add = (a, b) => a + b;
  const f = new Proxy(add, {
    apply(t, thisArg, args) {
      return t(args[0], args[1]) * 10;
    },
  });
  const g = new Proxy(add, {});
  return [f(1, 2), g(3, 4), typeof f];
});

show(() => {
  const arr = new Proxy(/** @type {any} */ ([10, 20, 30]), {
    get(t, k) {
      const i = Number(k);
      return Number.isInteger(i) && i < 0 ? t[t.length + i] : t[k];
    },
  });
  return [arr[-1], arr[0], arr[-3], arr.length];
});

show(() => {
  const trail = [];
  const acct = new Proxy(/** @type {any} */ ({
    owner: "ann",
    balance: 10,
    deposit(n) {
      this.balance += n;
      return this.balance;
    },
    describe() {
      return `${this.owner}:${this.balance}`;
    },
  }), {
    get(t, k, r) {
      trail.push("get " + String(k));
      return Reflect.get(t, k, r);
    },
    set(t, k, v, r) {
      trail.push("set " + String(k) + "=" + v);
      return Reflect.set(t, k, v, r);
    },
  });
  acct.balance = 20;
  const d = acct.deposit(5);
  return [acct.owner, acct.balance, d, acct.describe(), trail.join(",")];
});
show(() => {
  const inner = new Proxy(/** @type {any} */ ({ a: 1 }), {
    get(t, k) {
      return "inner:" + String(k);
    },
  });
  const outer = new Proxy(inner, {
    get(t, k) {
      return "outer>" + t[k];
    },
  });
  return [outer.q, inner.q];
});
show(() => {
  const loose = new Proxy(/** @type {any} */ ({}), {
    set() {
      return false;
    },
  });
  loose.x = 1;
  return Object.keys(loose);
});
