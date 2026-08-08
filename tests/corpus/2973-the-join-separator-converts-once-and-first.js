// Array.prototype.join converts its separator ONCE, and BEFORE any
// element — even when the array is empty or holds a single item.
// Rendering it per gap called a side-effecting separator (len - 1) times
// where Node calls it once, and called it AFTER the first element where
// Node calls it before. Both are user code, so both are observable, and
// neither shows up in the joined text.
function boxed(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + " = " + s);
}

var calls = 0;
var sep = boxed({
  toString: function () {
    calls++;
    return "-";
  },
});

show("three elements", boxed(["a", "b", "c"]).join(sep));
show("calls after three", calls);

calls = 0;
show("one element", boxed(["a"]).join(sep));
show("calls after one", calls);

calls = 0;
show("no elements", boxed([]).join(sep));
show("calls after none", calls);

// Order: the separator's conversion happens ahead of the first element's.
var order = [];
var elem = boxed({
  toString: function () {
    order.push("elem");
    return "E";
  },
});
var sep2 = boxed({
  toString: function () {
    order.push("sep");
    return "/";
  },
});
show("ordered join", boxed([elem, elem]).join(sep2));
show("order", order.join(","));

// The default separator is the comma, and asking for undefined is asking
// for the default — neither converts anything.
show("default", boxed(["a", "b"]).join());
show("explicit undefined", boxed(["a", "b"]).join(undefined));

console.log("done");
