// int_32.ts shape: a constructor that takes `number | string` and coerces
// with `+value | 0`.
class Int32 {
  value: number;
  constructor(value: number | string) {
    this.value = +value | 0;
  }
}
for (const v of [1.9, "42", "-3.5", 7, "nope", 2147483648]) {
  console.log(new Int32(v).value);
}
