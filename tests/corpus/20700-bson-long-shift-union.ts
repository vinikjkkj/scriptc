// bson long.ts shapes: a `number | Long` parameter narrowed by an
// assignment, then a compound bitwise `&=` on the same variable.
class Long {
  low: number;
  high: number;
  constructor(low: number, high: number) {
    this.low = low;
    this.high = high;
  }
  static isLong(x: unknown): x is Long {
    return x instanceof Long;
  }
  toInt(): number {
    return this.low;
  }
  shiftLeft(numBits: number | Long): number {
    if (Long.isLong(numBits)) numBits = numBits.toInt();
    if ((numBits &= 63) === 0) return this.low;
    else if (numBits < 32) return (this.low << numBits) | (this.high >>> (32 - numBits));
    else return this.low << (numBits - 32);
  }
  shiftRightUnsigned(numBits: Long | number): number {
    if (Long.isLong(numBits)) numBits = numBits.toInt();
    numBits &= 63;
    if (numBits === 0) return this.high;
    return this.high >>> numBits;
  }
}
const l = new Long(5, 9);
console.log(l.shiftLeft(3), l.shiftLeft(0), l.shiftLeft(64), l.shiftLeft(new Long(33, 0)));
console.log(l.shiftRightUnsigned(2), l.shiftRightUnsigned(0), l.shiftRightUnsigned(new Long(65, 0)));
