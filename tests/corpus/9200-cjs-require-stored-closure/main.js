// A CommonJS module whose exported closures read a binding initialized by a
// require BELOW them (the whatwg-url shape). Node runs the closures only after
// the require has initialized Impl, so nothing reads it early.
'use strict';

const url = require('./url.js');
console.log(url.make('made').tag, typeof url.make, url.is({ tag: 'made' }));
console.log(url.describe());
