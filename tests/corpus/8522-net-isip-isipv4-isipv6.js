// node:net address tests, byte-exact with Node's regular expressions
// (internal/net.js): octets without leading zeros, IPv6 compression rules,
// an IPv4 tail, and a %zone suffix.
import net from 'node:net';

const samples = [
  '127.0.0.1', '0.0.0.0', '255.255.255.255', '256.1.1.1', '01.1.1.1', '1.1.1', '1.1.1.1.1', '1.1.1.', '.1.1.1', '1..1.1',
  '1.1.1.1\n', ' 1.1.1.1', '', 'localhost', 'example.com', '999.999.999.999', '1.2.3.04', '1.2.3.0',
  '::', '::1', '1::', '1::2', '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7::', '::2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8',
  ':::', ':1', '1:', '1::2::3', '12345::', 'g::1', '::ffff:1.2.3.4', '::1.2.3.4', '1:2:3:4:5::1.2.3.4', '1:2:3:4:5:6::1.2.3.4',
  '1:2:3:4:5:6:1.2.3.4', '::ffff:256.1.1.1', '::ffff:01.1.1.1', 'fe80::1%eth0', 'fe80::1%', 'fe80::1%a-b.c:d', 'fe80::1%a b',
  'FE80::ABCD:ef01', '2001:db8::8a2e:370:7334', '2001:0db8:0000:0000:0000:ff00:0042:8329', '[::1]', '::1::', '1:2:3:4:5:6:7',
  '0:0:0:0:0:0:0:0', '::0', '1.2.3.4%eth0', '::%1',
];
for (const s of samples) {
  console.log(JSON.stringify(s), net.isIP(s), net.isIPv4(s), net.isIPv6(s));
}
