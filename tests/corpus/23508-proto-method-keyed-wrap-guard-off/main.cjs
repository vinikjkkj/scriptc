const P = require('./index.cjs');
const show = (p) => console.log(p.kind, JSON.stringify(p.data), p._name);
const q = new P.Query('select 1');
show(q.toPacket());
show(new P.Ping().toPacket());
show(new P.Auth(7).toPacket('utf8'));
console.log(P.Row.toPacket([1, 2]));
show(P.OK.toPacket());
