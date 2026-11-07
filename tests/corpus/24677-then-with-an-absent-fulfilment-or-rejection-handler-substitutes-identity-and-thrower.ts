// then with an absent fulfilment and/or rejection handler: the spec's identity / thrower substitutions.
function squash(_e: unknown): void { console.log('squashed'); }
async function ok(): Promise<number> { return 5; }
async function bad(): Promise<number> { throw new Error('boom'); }
async function badStr(): Promise<string> { throw new Error('boom2'); }
ok().then(undefined, squash).then(() => console.log('ok flows'));
bad().then(undefined, squash).then(() => console.log('bad squashed'));
bad().then(undefined, (e) => 7).then((v) => console.log('replaced with', v));
ok().then(undefined, (e) => 7).then((v) => console.log('kept', v));
ok().then(undefined, undefined).then((v) => console.log('pass', v));
bad().then(undefined, undefined).catch((e) => console.log('rethrown', (e as Error).message));
ok().then((v) => v + 1, undefined).then((v) => console.log('fulfil only', v));
bad().then((v) => v + 1, undefined).catch((e) => console.log('fulfil only rethrow', (e as Error).message));
bad().then(null, squash).then(() => console.log('null form'));
badStr().then(undefined, (e) => 'handled:' + (e as Error).message).then((s) => console.log(s));
