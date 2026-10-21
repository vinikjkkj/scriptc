// npm-static pilot: a CommonJS module that attaches its API member by member
// and calls its own members through module.exports -- including a member
// attached LATER in the file than the function that calls it (iconv-lite's
// encode -> getEncoder -> getCodec chain).
import memberexports from "memberexports";

console.log(memberexports.encode("hi", "UTF-8"));
console.log(memberexports.getCodec("Latin_1").name, memberexports.toEncoding("x", "ASCII"));
console.log(memberexports.state());
console.log(memberexports.decode("a", "x"), memberexports.decode("b", "y"), memberexports.use("q"), memberexports.use("r"), memberexports.state());
