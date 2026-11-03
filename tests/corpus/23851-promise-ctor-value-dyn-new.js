// The Promise constructor held in a value and constructed through it (mysql2's
// `this.Promise = thePromise || Promise` ... `new this.Promise(executor)`): the
// value is a function object, and `new` runs a dynamic executor whose resolve
// and reject share one already-resolved flag.
class Client {
  constructor(thePromise) {
    this.Promise = thePromise || Promise;
  }
  ok(v) {
    return new this.Promise((resolve) => resolve(v));
  }
  fail(msg) {
    return new this.Promise((resolve, reject) => reject(new Error(msg)));
  }
  twice() {
    return new this.Promise((resolve, reject) => {
      resolve('first');
      resolve('second');
      reject(new Error('late'));
    });
  }
  throwing() {
    return new this.Promise(() => {
      throw new Error('executor threw');
    });
  }
  throwingAfterResolve() {
    return new this.Promise((resolve) => {
      resolve('kept');
      throw new Error('ignored');
    });
  }
  chained(v) {
    return new this.Promise((resolve) => resolve(this.ok(v)));
  }
  bad(x) {
    return new this.Promise(x);
  }
}

async function main() {
  const withArg = new Client(Promise);
  const without = new Client();
  console.log(typeof withArg.Promise, withArg.Promise === Promise, without.Promise === withArg.Promise);
  console.log(withArg.Promise.name, withArg.Promise.length);
  console.log(await withArg.ok(1), await without.ok('two'));
  console.log(await withArg.twice());
  console.log(await withArg.throwingAfterResolve());
  console.log(await withArg.chained(3));
  try {
    await withArg.fail('boom');
    console.log('no throw');
  } catch (e) {
    console.log('caught fail', e.message);
  }
  try {
    await withArg.throwing();
    console.log('no throw');
  } catch (e) {
    console.log('caught throwing', e.message);
  }
  for (const x of [undefined, 5, 'str', null, true]) {
    try {
      withArg.bad(x);
      console.log('no throw');
    } catch (e) {
      console.log(e.name + ': ' + e.message);
    }
  }
  try {
    withArg.Promise(() => {});
  } catch (e) {
    console.log(e.name + ': ' + e.message);
  }
  const p = withArg.ok(9);
  console.log(p instanceof Promise, Object.prototype.toString.call(p));
  const order = [];
  const a = withArg.ok('a').then((v) => order.push(v));
  const b = withArg.ok('b').then((v) => order.push(v));
  await a;
  await b;
  console.log(order.join(','));
}
main();
