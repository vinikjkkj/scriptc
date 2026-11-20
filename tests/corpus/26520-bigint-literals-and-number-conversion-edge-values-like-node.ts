const vals: number[] = [0, -0, 1, -1, 2 ** 31, -(2 ** 31), 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, 2 ** 53 - 1, 2 ** 53, -(2 ** 53) + 1, 2 ** 53 + 2, 2 ** 62, 2 ** 63 - 1024, 2 ** 63, -(2 ** 63), 2 ** 64, 2 ** 100, -(2 ** 100), 1e21, 123456789012345680000, 4503599627370497, 9007199254740993]
for (const v of vals) console.log(String(v), BigInt(v).toString(), (BigInt(v) + 1n).toString(), (-BigInt(v)).toString(), BigInt.asUintN(64, BigInt(v)).toString(), BigInt.asIntN(32, BigInt(v)).toString())
const lits = [0n, 1n, 0xffffffffn, 0x100000000n, 0xdeadbeefcafebaben, 0b1011n, 0o777n, 340282366920938463463374607431768211455n, 1_000_000n]
for (const l of lits) console.log(l.toString(), (l * l).toString(), (l - 1n).toString(), (l << 3n).toString(), (-l).toString(), typeof l, l === 0n, l > 5n)
let h = 0n
for (let i = 0; i < 5; i++) h = (h << 7n) ^ (BigInt(i) + 0x7fffffffn)
console.log(h.toString(), JSON.stringify({ a: String(3n) }))
