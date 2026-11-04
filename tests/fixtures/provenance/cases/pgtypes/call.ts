import { arrayParser } from "pgtypes";
try {
  console.log(arrayParser("{1}", (e) => e));
} catch (e) {
  console.log(e instanceof TypeError, (e as Error).message);
}
