// Math members are native (no engine): sqrt is the IEEE instruction and the transcendentals are V8's own fdlibm routines (scr_fdlibm.c), so
// they print the bits Node prints. The toFixed(9) rounding the engine-era version needed stays: it is still a valid check of the same values.
console.log(Math.floor(7.6), Math.ceil(7.2), Math.round(7.5), Math.round(-7.5), Math.trunc(-7.9));
console.log(Math.abs(-3.5), Math.sign(-12), Math.sign(0), Math.sign(4.2));
console.log(Math.sqrt(144), Math.sqrt(2), Math.pow(2, 10), Math.pow(2, 0.5));
console.log(Math.hypot(3, 4), Math.min(2, -9), Math.max(2, -9));
console.log(Math.log2(1024), Math.log10(100000), Math.exp(0), Math.log(1));
console.log(Math.PI, Math.E);
console.log(Math.cbrt(27).toFixed(9), Math.exp(1).toFixed(9), Math.log(10).toFixed(9));
console.log(Math.sin(1).toFixed(9), Math.cos(1).toFixed(9), Math.tan(1).toFixed(9));
console.log(Math.asin(0.5).toFixed(9), Math.acos(0.5).toFixed(9));
console.log(Math.atan(1).toFixed(9), Math.atan2(1, 1).toFixed(9), Math.atan2(-1, -1).toFixed(9));
// Island results chain into static arithmetic like any number.
const area = Math.PI * Math.pow(2, 2);
console.log(area.toFixed(6), Math.floor(area) + 1);
// Non-finite edges: strict exits accept every engine number.
console.log(Math.log(0), Math.log(-1), Math.sqrt(-1), Math.pow(0, -1));
