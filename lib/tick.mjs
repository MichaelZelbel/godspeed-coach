// What the no-model job does every 15 minutes. Pure: it returns the messages to send and the writes
// that prove they went out, and the caller does the writing. Empty output is the normal case and
// makes the scheduler stay silent.
import { localParts, addDays } from "./clock.mjs";
import { listAreas } from "./areas.mjs";
import { followUpDue, notHeldDue } from "./talks.mjs";
import { listHabits, dueOn, answerOn, askedOn } from "./habits.mjs";
import { autoTicks } from "./auto.mjs";

export const CHECK_WINDOW_HOURS = 3;

const T = {
  en: {
    one: (t) => `${t} today? Answer yes, no or skip.`,
    many: (ts) => `Habits today: ${ts.join(", ")}. Answer each with yes, no or skip, in that order.`,
    follow: (t) => `Still up for the ${t} talk? One line is enough.`,
  },
  de: {
    one: (t) => `${t} heute? Antworte ja, nein oder skip.`,
    many: (ts) => `Gewohnheiten heute: ${ts.join(", ")}. Antworte für jede mit ja, nein oder skip, in dieser Reihenfolge.`,
    follow: (t) => `Noch Lust auf das Gespräch über ${t}? Eine Zeile reicht.`,
  },
};

const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);

export function pendingHabits(habits, ymd) {
  return habits.filter((h) => dueOn(h, ymd) && !h.auto && !answerOn(h, ymd));
}

export function dueTick(mcDir, s, now, table = {}) {
  const messages = []; const writes = [];
  const txt = T[s.language] || T.en;
  const lp = localParts(now, s.timezone);
  const active = listHabits(mcDir, { status: "active" });

  for (const t of autoTicks(active, table, [addDays(lp.date, -2), addDays(lp.date, -1), lp.date])) {
    writes.push({ kind: "auto", habit: t.habit, ymd: t.ymd, words: t.words });
  }
  const autoToday = new Set(writes.filter((w) => w.ymd === lp.date).map((w) => w.habit.slug));

  for (const a of listAreas(mcDir)) {
    for (const d of notHeldDue(a, now, s.timezone)) writes.push({ kind: "not-held", area: a, ymd: d });
    const f = followUpDue(a, now, s.timezone);
    if (f) {
      messages.push(txt.follow(lower(a.title)));
      writes.push({ kind: "follow-up", area: a, ymd: f, at: now.toISOString().replace(/\.\d+Z$/, "Z") });
    }
  }

  const [h, m] = s.habit_check_at.split(":").map(Number);
  const [nh, nm] = lp.hm.split(":").map(Number);
  const mins = nh * 60 + nm - (h * 60 + m);
  const alreadyAsked = active.some((x) => askedOn(x, lp.date));
  if (mins >= 0 && mins <= CHECK_WINDOW_HOURS * 60 && !alreadyAsked) {
    const pending = pendingHabits(active, lp.date).filter((x) => !autoToday.has(x.slug));
    if (pending.length) {
      messages.push(pending.length === 1 ? txt.one(pending[0].title) : txt.many(pending.map((x) => lower(x.title))));
      for (const x of pending) writes.push({ kind: "asked", habit: x, ymd: lp.date });
    }
  }
  return { messages, writes };
}
