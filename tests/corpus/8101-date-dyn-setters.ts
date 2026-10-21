// Date setters through an `any` receiver (the checked-dynamic handle invoke path).
const a: any = new Date(1700000000000);
console.log(a.setHours(3, 4), a.getTime(), a.setMonth(14), a.getTime());
console.log(a.setUTCFullYear(2001, 1, 31, 99), a.setTime(5), a.setDate(), a.getTime(), a.setYear(95), a.getFullYear());
