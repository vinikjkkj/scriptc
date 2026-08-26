'use strict';

let user;
try {
  user = process.platform === 'win32' ? 'WINUSER' : 'NIXUSER';
} catch {
  // ignore
}

module.exports = {
  host: 'localhost',
  user,
  port: 5432,
};
