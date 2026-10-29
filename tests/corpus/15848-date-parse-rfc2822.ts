// Date.parse of RFC 2822 and HTTP-date shapes: a day name, a named month, a zone word.
const xs: string[] = [
  "Tue, 01 Jan 2019 00:00:00 GMT",
  "Sat, 31 Dec 1999 23:59:59 EST",
  "Thu, 01 Jan 1970 00:00:00 GMT+0100",
  "Mon, 25 Dec 1995 13:30:00 +0430",
  "1 January 2000 12:00 UTC",
  "Tue Mar 01 2016 10:00:00 GMT-0500",
];
for (const s of xs) console.log(s, Date.parse(s));
