// The real postgres-interval constructor (an ES5 function whose instance is filled by a run-time key copy,
// `extend(this, parse(raw))`), its prototype methods, and the dyn-keyed regex row reads inside parse.
var PostgresInterval = require('./postgres-interval.cjs')

var strings = [
  '1 year 2 mons 3 days 04:05:06.5',
  '-1 days -01:02:03.000004',
  '',
  '5 mons',
  '00:00:01',
  '12 years 11 mons',
  '1 day 1:00:00',
  '2 years',
  '-2 mons',
  '3 days 00:00:00.000001',
  '100:00:00',
  '+01:02:03.25',
  '0 years 0 mons 0 days 00:00:00'
]
strings.forEach(function (s) {
  var i = PostgresInterval(s)
  console.log(JSON.stringify(s), '|', i.toPostgres(), '|', i.toISO(), '|', i.toISOString())
  console.log(Object.keys(i).join(','), JSON.stringify(i))
  console.log(i)
})

// Called with and without `new`; the prototype chain.
var a = new PostgresInterval('1 day')
var b = PostgresInterval('1 day')
console.log(a instanceof PostgresInterval, b instanceof PostgresInterval, a.toPostgres() === b.toPostgres())
console.log(typeof PostgresInterval.prototype.toPostgres, PostgresInterval.prototype.toISO === PostgresInterval.prototype.toISOString)
console.log(PostgresInterval.prototype.hasOwnProperty('toPostgres'), a.hasOwnProperty('days'), a.hasOwnProperty('hours'), a.hasOwnProperty('toPostgres'))

// hasOwnProperty as an array-callback value with a thisArg (toPostgres's own shape).
var props = ['seconds', 'minutes', 'hours', 'days', 'months', 'years']
var c = PostgresInterval('2 years 3 days')
console.log(props.filter(c.hasOwnProperty, c), props.filter(c.hasOwnProperty, a), props.filter(a.hasOwnProperty, c))
c.milliseconds = 250
console.log(c.toPostgres(), c.toISO())
c.seconds = 7
console.log(c.toPostgres(), c.toISO())
