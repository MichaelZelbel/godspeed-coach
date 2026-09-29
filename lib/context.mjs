// The lines the model sees before it reads the person's message, on every interface: which talk is
// waiting for his reply, which habit question went out tonight, and which habits exist, so "yes" at
// 21:10 and "track head lifts" at noon both land in the right place. Empty when there is nothing.
import { localParts } from "./clock.mjs";
import { openTalks } from "./talks.mjs";
import { listHabits, askedOn, answerOn } from "./habits.mjs";

export function contextBlock(mcDir, s, now) {
  const tz = s.timezone;
  const today = localParts(now, tz).date;
  const talks = openTalks(mcDir, now);
  const active = listHabits(mcDir, { status: "active" });
  if (!talks.length && !active.length) return "";
  const L = [`[godspeed-coach] (times in ${tz})`];
  for (const { area, ymd, talk } of talks) {
    const when = talk.opened ? localParts(new Date(talk.opened), tz) : null;
    L.push(`- Open talk: ${area.title} (${area.slug}), opened ${when ? `${when.date} ${when.hm}` : ymd}, record coach/${area.slug}/talks/${ymd}.md${talk.followUp ? ", follow-up sent" : ""}. His reply continues it: follow the coach recipe, "Continuing a talk".`);
  }
  const asked = active.filter((h) => askedOn(h, today) && !answerOn(h, today));
  if (asked.length) L.push(`- Habit check sent tonight, still unanswered, asking in this order: ${asked.map((h) => h.title).join(", ")}. A short yes / no / skip answers it: follow the coach recipe, "Tracking a habit".`);
  if (active.length) L.push(`- Active habits: ${active.map((h) => `${h.title} (${h.slug}${answerOn(h, today) ? `, today ${answerOn(h, today)}` : ""})`).join("; ")}. "Track <habit>" or "did <habit>" tracks one.`);
  return L.join("\n");
}
