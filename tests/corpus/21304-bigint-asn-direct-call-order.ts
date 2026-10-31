// Direct calls: the width's RangeError comes before the value's TypeError when
// both operands are invalid (Node's order), and a string width is ToIndex.
const v: any = 5;
try { BigInt.asUintN(-1, v); console.log("ok"); } catch (e: any) { console.log(e.constructor.name, e.message); }
try { BigInt.asIntN(2 ** 53, v); console.log("ok"); } catch (e: any) { console.log(e.constructor.name, e.message); }
try { BigInt.asIntN(64, v); console.log("ok"); } catch (e: any) { console.log(e.constructor.name, e.message); }
try { BigInt.asIntN(-1, 5n); console.log("ok"); } catch (e: any) { console.log(e.constructor.name, e.message); }
console.log(String(BigInt.asUintN(0, -5n)), String(BigInt.asIntN(0, 5n)), String(BigInt.asUintN(1, 3n)), String(BigInt.asIntN(1, 1n)));
console.log(String(BigInt.asIntN(63, -1n)), String(BigInt.asUintN(63, -1n)), String(BigInt.asIntN(65, 2n ** 64n)), String(BigInt.asUintN(128, -1n)));
console.log(String(BigInt.asIntN("8" as any, 255n)), String(BigInt.asUintN(1.9, 7n)), String(BigInt.asIntN(64, v === 5 ? 9n : 0n)));
