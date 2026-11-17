// Node lists an Error instance's own keys in creation order: the declared fields first, then `name` once the constructor assigns it.
class PublishNack extends Error {
  public retryable: boolean;
  public constructor(m: string, retryable: boolean) { super(m); this.retryable = retryable; this.name = 'PublishNack'; }
}
class MissingKey extends Error {
  public keyId = 'k1';
  public collection = 'c';
  public constructor(m: string) { super(m); this.name = 'MissingKey'; }
}
class Quiet extends Error {}
const a = new PublishNack('boom', true);
const b = new MissingKey('gone');
const c = new Quiet('q');
console.log(Object.keys(a).join(','), JSON.stringify(Object.entries(a)), JSON.stringify(Object.values(a)));
console.log(Object.keys(b).join(','), JSON.stringify(Object.entries(b)), JSON.stringify(Object.values(b)));
console.log(Object.keys(c).length, JSON.stringify(Object.entries(c)));
const seen: string[] = [];
for (const k in b) seen.push(k);
console.log(seen.join(','));
