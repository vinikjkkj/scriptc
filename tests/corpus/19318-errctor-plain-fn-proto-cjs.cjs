function MyE(m) { this.message = m; }
MyE.prototype = Object.create(Error.prototype);
MyE.prototype.constructor = MyE;
MyE.prototype.name = "MyE";
try { throw new MyE("hi"); } catch (e) { console.log("ctorname", e.constructor.name); }
