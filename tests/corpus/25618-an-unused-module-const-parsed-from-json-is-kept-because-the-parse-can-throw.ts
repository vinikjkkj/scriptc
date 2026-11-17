// JSON.parse is not provably pure (it throws on bad text) and its result is a dynamic value: the unused const is evaluated, in order, with its effects.
const GOOD = JSON.parse('{"a":[1,2,3],"b":{"c":true}}');
export const UNUSED_GOOD = Object.keys(GOOD);
console.log("evaluated", JSON.stringify(GOOD));
