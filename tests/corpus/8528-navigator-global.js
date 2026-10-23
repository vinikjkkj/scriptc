// The navigator global Node 21+ exposes: userAgent, platform, language(s),
// hardwareConcurrency (pg's stream.js probes navigator.userAgent for Cloudflare Workers).
'use strict';
console.log(navigator.userAgent, navigator.platform, navigator.language, navigator.languages.length, navigator.languages[0] === navigator.language);
console.log(typeof navigator.hardwareConcurrency, navigator.hardwareConcurrency > 0, Number.isInteger(navigator.hardwareConcurrency));
const isWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
console.log(isWorkers);
