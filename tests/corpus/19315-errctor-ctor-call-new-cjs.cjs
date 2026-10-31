try { JSON.parse("null").x; } catch (e) {
  const E = e.constructor;
  const x = new E("made");
  const y = E("called");
  console.log("new", x.name, x.message, x instanceof TypeError);
  console.log("call", y.name, y.message);
  console.log("same", e.constructor === E, E.name);
}
