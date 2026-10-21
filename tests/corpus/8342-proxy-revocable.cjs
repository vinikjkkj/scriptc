const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
console.log(proxy.a);
revoke();
try { proxy.a; } catch (e) { console.log(e.name, e.message); }
console.log(typeof proxy);
