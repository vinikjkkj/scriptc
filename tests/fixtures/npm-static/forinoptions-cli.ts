// npm-static pilot: for-in over an options bag that is reassigned, hasOwnProperty.call over a typed record, and a for-in cursor indexing an array
import pk from "forinoptions";
console.log(pk.configure('db:3306'), pk.configure({ host: 'h', extra: 1 }), pk.configure({ uri: 'x:1', user: 'u' }));
console.log(pk.flags('c,d'), pk.flags(['e']), pk.flags(undefined));
