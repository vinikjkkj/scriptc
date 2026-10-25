// Computed string-key reads on a class instance: a template-literal key naming declared fields.
class Auth {
  password1 = 'one';
  password2 = 'two';
  password3 = 'three';
  authenticationFactor = 1;
  pick() {
    return this[`password${this.authenticationFactor}`];
  }
  bump() {
    this.authenticationFactor += 1;
  }
}
const a = new Auth();
console.log(a.pick());
a.bump();
console.log(a.pick());
a.bump();
console.log(a.pick());
a.bump();
console.log(String(a.pick()));
