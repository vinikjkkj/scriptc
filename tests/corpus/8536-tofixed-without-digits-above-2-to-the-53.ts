// Number.prototype.toFixed() with the digits omitted prints the EXACT integer value
// from 2^53 up, not the shortest round-trip digits ToString would use.
const big: number = 1000000000000000128;
const wide: number = 123456789012345680000;
const edge: number = 9007199254740993;
const negative: number = -1000000000000000128;
const small: number = 123456789012345.5;
console.log(big.toFixed(), wide.toFixed(), edge.toFixed(), negative.toFixed(), small.toFixed(), (2 ** 60).toFixed());
console.log(big.toFixed(0), (2 ** 53).toFixed(), (2 ** 53 - 1).toFixed(), (1e21).toFixed(), (999999999999999900000).toFixed());
