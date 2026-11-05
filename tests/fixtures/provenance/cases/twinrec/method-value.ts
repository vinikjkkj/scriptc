// A method read as a value from an instance that takes own properties under run-time keys: the own property when one shadows it,
// of any type, else the method; `.bind` and calls on it behave as on that value.
import { scenario } from "twinrec/methodval";
scenario((s) => console.log(s));
