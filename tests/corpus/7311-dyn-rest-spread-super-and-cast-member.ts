// The three zapo call sites this capability is supposed to reach, in
// their source spelling.
//
//   src/client/WaClient.ts:224          super.emit(event, ...args)
//   packages/store-redis/src/BaseRedisStore.ts:80
//                                       (r as { mset: (...a) => P }).mset(...args)
//   packages/store-sqlite/src/connection.ts:155/159/167
//                                       statement.run(...params)   [own probe]
function fmt(args: unknown[]): string {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  return line + "]"
}

// --- WaClient.ts:224 -- an overloaded emit whose implementation forwards
// a `string | symbol` name and a dyn rest to the base class.
class Base {
  emit(event: string | symbol, ...args: unknown[]): boolean {
    console.log("base " + fmt(args))
    return args.length > 0
  }
}
class Sub extends Base {
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args)
  }
}
const s = new Sub()
console.log(String(s.emit("open", 1, "two", true)))
console.log(String(s.emit("close")))
const xs: unknown[] = ["a", "b"]
console.log(String(s.emit("burst", ...xs)))

// --- BaseRedisStore.ts:80 -- a spread into a func-typed MEMBER reached
// through a cast; the record member's rest slot is the dyn one.
const redisish: unknown = {
  mset: (...a: unknown[]): string => "mset " + fmt(a),
}
const args: unknown[] = ["k1", "v1", "k2", "v2"]
const m = (redisish as { mset: (...a: unknown[]) => string }).mset
console.log(m(...args))
console.log((redisish as { mset: (...a: unknown[]) => string }).mset(...args))
