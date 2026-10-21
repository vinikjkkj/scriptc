// The net argument-validation ladders: misuse of the implemented net
// surface answers Node's exact typed errors instead of fencing —
// createServer's options-type contract, the connect option bag's
// Socket-constructor order (host's string contract, autoSelectFamily's boolean contract, the
// autoSelectFamilyAttemptTimeout range ladder — validated and then inert,
// the single-dial simplification), listen's options.signal AbortSignal
// contract, and the setDefaultAutoSelectFamilyAttemptTimeout value ladder
// with Node's sub-10ms floor. (The objectMode trio over a computed key is a
// runtime option bag, refused at compile time: see
// tests/diagnostics/js-net-connect-with-a-runtime-option-bag.cjs.)
'use strict';
const net = require('net');
const show = (fn) => { try { fn(); console.log('ok'); } catch (e) { console.log(`${e.name}|${e.code}|${e.message}`); } };
show(() => { net.createServer('path'); });
show(() => { net.createServer(0); });
show(() => { net.createConnection({ port: 8080, host: ['192.168.0.1'] }); });
show(() => { net.connect({ port: 8080, autoSelectFamily: 'INVALID' }); });
show(() => { net.connect({ port: 8080, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: -10 }); });
show(() => { net.connect({ port: 8080, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 0 }); });
for (const autoSelectFamilyAttemptTimeout of [-10, 0]) {
  show(() => { net.connect({ port: 8080, autoSelectFamily: true, autoSelectFamilyAttemptTimeout }); });
  show(() => { net.setDefaultAutoSelectFamilyAttemptTimeout(autoSelectFamilyAttemptTimeout); });
}
show(() => net.setDefaultAutoSelectFamilyAttemptTimeout(2.5));
for (const v of [1, 9, 25]) {
  net.setDefaultAutoSelectFamilyAttemptTimeout(v);
  console.log('budget', net.getDefaultAutoSelectFamilyAttemptTimeout());
}
{
  const server = net.createServer();
  show(() => { server.listen({ port: 0, signal: 'INVALID_SIGNAL' }); });
}
