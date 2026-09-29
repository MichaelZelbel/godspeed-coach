// Every time the coach shows a person is local time in the zone their settings name. The server
// runs on UTC and the laptop does not, and a Sunday 19:00 talk has to be 19:00 in Berlin on both.
export function now() {
  return process.env.GODSPEED_NOW ? new Date(process.env.GODSPEED_NOW) : new Date();
}

const WEEKDAYS = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, hms: `${p.hour}${p.minute}${p.second}`,
    y: p.year, m: p.month, d: p.day, weekday: WEEKDAYS[p.weekday],
  };
}

export const minutesBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 60000);

// The UTC moment of a local date and time in a zone. Two passes, so a date across a clock change
// lands on the right hour.
export function zonedToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, h, mi);
  let t = wanted;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    const [lh, lm] = p.hm.split(":").map(Number);
    const seen = Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d), lh, lm);
    t += wanted - seen;
  }
  return new Date(t);
}

export function addDays(ymd, n) {
  const t = Date.parse(ymd + "T12:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function weekdayOf(ymd) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(ymd + "T12:00:00Z").getUTCDay()];
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
}
