import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { dueTick } from "../lib/tick.mjs";
import { contextBlock } from "../lib/context.mjs";
import { readArea } from "../lib/areas.mjs";
import { openTalk, setFollowUp } from "../lib/talks.mjs";
import { addHabit, track, findHabit } from "../lib/habits.mjs";
import { tmpMission, area, S } from "./helpers.mjs";

const at = (iso) => new Date(iso);
const mission = () => tmpMission({ "coach/health/area.md": area(), "coach/work/area.md": area({ AREA: "work", TITLE: "Work and money", RHYTHM: "weekly wednesday", STARTS: "2026-10-14" }) });

// Applies writes the way the command does, so a second tick sees the first one's record.
function apply(mc, writes) {
  for (const w of writes) {
    if (w.kind === "asked") track(w.habit, w.ymd, "asked", "tick", "");
    if (w.kind === "auto") track(w.habit, w.ymd, "done", "data", w.words);
    if (w.kind === "follow-up") setFollowUp(w.area, w.ymd, w.at);
  }
}

test("the habit check: at 21:00 Berlin, once, only for what is not tracked", () => {
  const mc = mission();
  addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", days: "daily" }, "2026-09-29");
  addHabit(mc, { area: "health", title: "Run", days: "daily", auto: "run_km > 0" }, "2026-09-29");
  assert.deepEqual(dueTick(mc, S, at("2026-09-29T18:59:00Z")).messages, [], "20:59 Berlin");
  const t1 = dueTick(mc, S, at("2026-09-29T19:00:00Z"));
  assert.deepEqual(t1.messages, ["Face-down head lifts today? Answer yes, no or skip."]);
  apply(mc, t1.writes);
  assert.deepEqual(dueTick(mc, S, at("2026-09-29T19:15:00Z")).messages, [], "never a second message");
});

test("everything tracked means no habit message; several pending share one message", () => {
  const mc = mission();
  let h = addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", days: "daily" }, "2026-09-29");
  track(h, "2026-09-29", "done", "telegram", "did head lifts");
  assert.deepEqual(dueTick(mc, S, at("2026-09-29T19:00:00Z")).messages, []);
  addHabit(mc, { area: "work", title: "Evening walk", days: "daily" }, "2026-09-30");
  addHabit(mc, { area: "work", title: "Reading", days: "daily" }, "2026-09-30");
  assert.deepEqual(dueTick(mc, S, at("2026-09-30T19:00:00Z")).messages, ["Habits today: face-down head lifts, evening walk, reading. Answer each with yes, no or skip, in that order."]);
  assert.deepEqual(dueTick(mc, { ...S, language: "de" }, at("2026-10-01T19:00:00Z")).messages[0].slice(0, 22), "Gewohnheiten heute: fa");
});

test("a run in the table ticks itself and is never asked", () => {
  const mc = mission();
  addHabit(mc, { area: "health", title: "Run", days: "daily", auto: "run_km > 0" }, "2026-09-29");
  const t = dueTick(mc, S, at("2026-09-29T19:00:00Z"), { "2026-09-29": { date: "2026-09-29", run_km: "5.1" } });
  assert.deepEqual(t.messages, []);
  assert.deepEqual(t.writes.map((w) => `${w.kind} ${w.habit.slug} ${w.ymd}`), ["auto run 2026-09-29"]);
});

test("an unanswered talk: follow-up the next evening, not-held the day after, silently", () => {
  const mc = mission();
  const a = readArea(path.join(mc, "coach", "health"));
  openTalk(a, "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:01:00Z"));
  const t1 = dueTick(mc, S, at("2026-10-05T17:00:00Z"));
  assert.deepEqual(t1.messages, ["Still up for the health and fitness talk? One line is enough."]);
  apply(mc, t1.writes);
  assert.deepEqual(dueTick(mc, S, at("2026-10-05T17:15:00Z")).messages, []);
  const t3 = dueTick(mc, S, at("2026-10-06T13:00:00Z"));
  assert.deepEqual(t3.messages, []);
  assert.deepEqual(t3.writes.map((w) => `${w.kind} ${w.area.slug} ${w.ymd}`), ["not-held health 2026-10-04"]);
});

test("context: an open talk and tonight's unanswered habit check both appear, each named", () => {
  const mc = mission();
  const a = readArea(path.join(mc, "coach", "health"));
  assert.equal(contextBlock(mc, S, at("2026-10-04T19:10:00Z")), "");
  openTalk(a, "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:01:00Z"));
  addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", days: "daily" }, "2026-09-29");
  apply(mc, dueTick(mc, S, at("2026-10-04T19:00:00Z")).writes);
  const c = contextBlock(mc, S, at("2026-10-04T19:10:00Z"));
  assert.match(c, /^\[godspeed-coach\] \(times in Europe\/Berlin\)/);
  assert.match(c, /Open talk: Health and fitness \(health\), opened 2026-10-04 19:01, record coach\/health\/talks\/2026-10-04\.md/);
  assert.match(c, /Habit check sent tonight, still unanswered, asking in this order: Face-down head lifts/);
  assert.match(c, /Active habits: Face-down head lifts \(head-lifts\)/);
  track(findHabit(mc, "head lifts"), "2026-10-04", "done", "telegram", "yes");
  const c2 = contextBlock(mc, S, at("2026-10-04T19:20:00Z"));
  assert.doesNotMatch(c2, /Habit check sent/);
  assert.match(c2, /Face-down head lifts \(head-lifts, today done\)/);
});
