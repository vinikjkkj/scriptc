// An object literal whose empty-array members receive arrays and elements of ANY kind later (ioredis ClusterSubscriber's previousChannels): tsc types
// the literal's [] as never[], but the program stores strings there, so the binding is the evolving object, not a number[] struct.
function run(cond) {
  const prev = { a: [], b: [] };
  prev.a = cond.get("a");
  console.log(prev.a.length, prev.a[0], prev.b.length);
  prev.b.push("x", 2);
  console.log(JSON.stringify(prev));
}
run({ get(k) { return [k + "1", k + "2"]; } });

class Sub2 {
  constructor() { this.got = []; }
  channels(kind) { return kind === "ssubscribe" ? ["s1", "s2"] : ["a"]; }
  ssubscribe(ch) { this.got.push(ch); return Promise.resolve(ch); }
  subscribe(chs) { this.got.push(chs.join("+")); return Promise.resolve(chs); }
  psubscribe(chs) { this.got.push("p" + chs.join("+")); return Promise.resolve(chs); }
}
function resub2(last, subscriber) {
  const previousChannels = { subscribe: [], psubscribe: [], ssubscribe: [] };
  const condition = last.condition;
  if (condition && condition.subscriber) {
    previousChannels.subscribe = condition.subscriber.channels("subscribe");
    previousChannels.psubscribe = condition.subscriber.channels("psubscribe");
    previousChannels.ssubscribe = condition.subscriber.channels("ssubscribe");
  }
  let pending = 0;
  for (const type of ["subscribe", "psubscribe", "ssubscribe"]) {
    const channels = previousChannels[type];
    if (channels.length == 0) continue;
    if (type === "ssubscribe") {
      for (const channel of channels) {
        pending += 1;
        subscriber[type](channel).then(() => { --pending; });
      }
    } else {
      pending += 1;
      subscriber[type](channels).then(() => { --pending; });
    }
  }
  return pending;
}
const target = new Sub2();
console.log(resub2({ condition: { subscriber: new Sub2() } }, target), target.got.join("|"));
// numeric-only stores keep the typed record
const nums = { xs: [] }; nums.xs.push(1, 2); nums.xs = [3]; console.log(nums.xs.length, nums.xs[0]);
