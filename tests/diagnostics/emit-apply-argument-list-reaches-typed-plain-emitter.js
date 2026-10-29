const EventEmitter = require("events");
const em = new EventEmitter();
em.on("ready", () => console.log("zero-arg"));
console.log(em.emit.apply(em, ["ready", 1]));
