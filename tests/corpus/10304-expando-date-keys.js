// An expando written on a Date is an own property: it is listed, it is
// overwritten by a later write, and a missing one reads undefined.
function stamp(ms, tag) {
  var when = new Date(ms);
  when.tag = tag;
  when.tag = tag + '!';
  when.count = 1;
  when.count += 1;
  return when;
}
var s = stamp(0, 'boot');
console.log(s.tag, s.count, s.other === undefined, s.getTime());
console.log(Object.keys(s).join(','));
console.log(s);
console.log('tag' in s, 'other' in s, Object.hasOwn(s, 'count'), Object.values(s).join('|'));
