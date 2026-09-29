// An area is one folder under coach/ with an area.md: what the talks are about, when they happen,
// how they sound and what they may never do. Adding an area is adding a folder; nothing here knows
// any area by name.
import fs from "node:fs";
import path from "node:path";
import { parseDoc } from "./header.mjs";
import { weekdayOf, daysBetween, zonedToUtc } from "./clock.mjs";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun" };

export const coachDir = (mcDir) => path.join(mcDir, "coach");

export function parseRhythm(raw) {
  const r = String(raw || "").trim().toLowerCase();
  const day = (w) => DAY_NAMES[w] || (DAYS.includes(w) ? w : null);
  if (r === "daily") return { kind: "daily" };
  let m = r.match(/^weekly (\w+)$/);
  if (m && day(m[1])) return { kind: "weeks", every: 1, day: day(m[1]) };
  m = r.match(/^every (\d+) weeks? (\w+)$/);
  if (m && day(m[2]) && Number(m[1]) >= 1) return { kind: "weeks", every: Number(m[1]), day: day(m[2]) };
  m = r.match(/^monthly (\d+)$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 28) return { kind: "monthly", day: Number(m[1]) };
  return null;
}

export function readArea(dir) {
  const file = path.join(dir, "area.md");
  if (!fs.existsSync(file)) return null;
  const d = parseDoc(fs.readFileSync(file, "utf8"));
  const h = d.head;
  return {
    slug: path.basename(dir), dir, file, head: h, lists: d.lists, sections: d.sections,
    title: h.TITLE || path.basename(dir),
    rhythm: parseRhythm(h.RHYTHM), rhythmText: h.RHYTHM || "",
    time: /^\d\d:\d\d$/.test(h.TIME || "") ? h.TIME : "19:00",
    starts: /^\d{4}-\d{2}-\d{2}$/.test(h.STARTS || "") ? h.STARTS : null,
    on: (h.STATUS || "on").toLowerCase() === "on",
    style: h.STYLE || "compass", tone: h.TONE || "gentle",
    serves: (h.SERVES || "").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

export function listAreas(mcDir) {
  const root = coachDir(mcDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => readArea(path.join(root, e.name)))
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function findArea(mcDir, name) {
  const n = String(name || "").toLowerCase();
  return listAreas(mcDir).find((a) => a.slug === n || a.title.toLowerCase() === n) || null;
}

export function isTalkDay(area, ymd) {
  if (!area || !area.on || !area.rhythm || !area.starts || ymd < area.starts) return false;
  const r = area.rhythm;
  if (r.kind === "daily") return true;
  if (r.kind === "monthly") return Number(ymd.slice(8, 10)) === r.day;
  if (weekdayOf(ymd) !== r.day) return false;
  if (r.every === 1) return true;
  // Counted from the first talk day on or after STARTS.
  let first = area.starts;
  while (weekdayOf(first) !== r.day) first = new Date(Date.parse(first + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  return Math.floor(daysBetween(first, ymd) / 7) % r.every === 0;
}

export function talkMoment(area, ymd, tz) {
  return isTalkDay(area, ymd) ? zonedToUtc(ymd, area.time, tz) : null;
}
