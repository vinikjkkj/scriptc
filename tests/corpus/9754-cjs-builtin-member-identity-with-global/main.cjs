// A builtin module member that is the same object as a global: identity holds across the two spellings.
const { Buffer: B } = require('buffer');
const { URL: U } = require('url');
const { TextEncoder: TE } = require('util');
console.log(B === Buffer, U === URL, TE === TextEncoder, B.from('ab', 'utf8').length, new U('http://x.y/p').pathname);
