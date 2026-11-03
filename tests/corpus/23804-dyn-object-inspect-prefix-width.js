// The constructor-name prefix counts toward the single-line width (Node keeps it inside braces[0]).
function ext(t, s) { for (var k in s) t[k] = s[k]; return t }
function PostgresInterval() { ext(this, { hours: 1, minutes: 2, seconds: 3, milliseconds: 250 }) }
console.log(new PostgresInterval())
function Q() { this.hours = 1; this.minutes = 2; this.seconds = 3; this.milliseconds = 250 }
console.log(new Q())
function QQ() { this.hours = 1; this.minutes = 2; this.seconds = 3; this.milliseconds = 25 }
console.log(new QQ())
class PostgresInterval2 { constructor() { this.hours = 1; this.minutes = 2; this.seconds = 3; this.milliseconds = 250 } }
console.log(new PostgresInterval2())
/** @type {any} */ var o = { hours: 1, minutes: 2, seconds: 3, milliseconds: 25000, aaaaaaaaaaaaa: 1 }
console.log(o)
var nu = Object.create(null); nu.aaaaaaaaaa = 1; nu.bbbbbbbbbbb = 2; nu.cccccccccc = 3; nu.dddddddddd = 4; nu.eeeeeeeee = 5
console.log(nu)
var nu2 = Object.create(null); nu2.a = 1
console.log(nu2)
function Z() { ext(this, { alpha: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }) }
console.log(new Z())
function Z2() { ext(this, { alpha: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }) }
console.log(new Z2())
function Z3() { ext(this, { alpha: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }) }
console.log(new Z3())
