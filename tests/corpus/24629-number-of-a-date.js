// Number(date) is the date's time value (the ms getTime reads), NaN for an invalid date (debug's `Number(new Date())`).
const a = Number(new Date(0));
const b = Number(new Date(5000));
console.log(a, b, b - a, typeof Number(new Date()));
console.log(Number(new Date()) > 1e12, Number(new Date("2020-01-02T03:04:05.678Z")), Number(new Date("nonsense")));
const d = new Date(86400000);
console.log(Number(d) === d.getTime());
d.setTime(5);
console.log(Number(d));
