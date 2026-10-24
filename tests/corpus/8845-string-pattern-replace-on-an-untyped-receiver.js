// replace/replaceAll with string pattern and replacement on an untyped receiver (pg-connection-string, postgres-date): the receiver is validated as a string or Node's TypeError is thrown.
function a(str) { return str.replace('@/', '@___DUMMY___/'); }
function b(iso) { return iso.replace('i', 'I'); }
function c(s) { return encodeURI(s).replace(/%25(\d\d)/g, '%$1'); }
function d(s) { return s.replace(/^\[(.+)\]$/, '$1'); }
function e(s) { return s.replaceAll('a', 'b') + s.replace(/a/g, 'X'); }
console.log(a('x@/y'), b('-infinity'), c('a b%2520'), d('[::1]'), e('banana'));
console.log(a(5 + ''), a(String(7)));
try { a(5); } catch (e) { console.log(e.name, e.message); }
try { a({}); } catch (e) { console.log(e.name, e.message); }
try { a(undefined); } catch (e) { console.log(e.name, e.message); }
console.log(a('no match'), a(''), b('xii'), e('aaa'));
