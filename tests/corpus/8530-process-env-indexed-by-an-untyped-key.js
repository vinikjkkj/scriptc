// pg-connection-string: `process.env[envVar]` where envVar is an untyped parameter.
'use strict';
process.env.SC_8530_SET = 'present';
function read(envVar) {
  if (envVar === undefined) {
    return process.env['SC_8530_' + 'SET'];
  } else if (envVar === false) {
    return 'off';
  }
  return process.env[envVar];
}
console.log(read(undefined), read(false), read('SC_8530_SET'), read('SC_8530_MISSING'));
function write(k) {
  process.env[k] = 'x';
  return process.env[k];
}
console.log(write('SC_8530_W'), process.env.SC_8530_W);
const numeric = 7;
process.env[numeric] = 'seven';
console.log(process.env['7'], process.env[numeric]);
