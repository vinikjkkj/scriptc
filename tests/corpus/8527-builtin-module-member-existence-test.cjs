// A builtin module member that has a lowering row, tested for existence (pg connection.js: net.isIP && net.isIP(host) === 0).
// @ts-nocheck
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
function pick(h) { return net.isIP && net.isIP(h) === 0 ? 'name' : 'ip'; }
console.log(pick('example.com'), pick('::1'));
console.log(Boolean(path.dirname && os.type), !fs.existsSync, fs.readFileSync ? 'y' : 'n');
