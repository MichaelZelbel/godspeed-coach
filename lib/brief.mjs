// Everything one talk needs, gathered before the model runs: the area's rules, what to prepare, the
// last talk in full (the memory), the question queued for today, the week of each habit, and the
// goals the area serves. The talk itself reads more only when the conversation gets there.
import fs from "node:fs";
import path from "node:path";
import { parseDoc } from "./header.mjs";
import { localParts } from "./clock.mjs";
import { lastTalk, missedInARow, talkFile } from "./talks.mjs";
import { listHabits, stats, verdict } from "./habits.mjs";

export function queuedQuestions(area, ymd) {
  const f = path.join(area.dir, "questions.md");
  if (!fs.existsSync(f)) return [];
  const text = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  const parts = text.split(/^### /m).slice(1);
  const out = [];
  for (const p of parts) {
    const m = p.match(/^(\d{4}-\d{2}-\d{2}):\s*(.*)\n?([\s\S]*)$/);
    if (!m) continue;
    const [, date, title, body] = m;
    if (date > ymd || /^ASKED:/m.test(body)) continue;
    out.push({ date, title: title.trim(), body: body.trim() });
  }
  return out;
}

function goalLines(mcDir, id) {
  const f = path.join(mcDir, "goals", `${id}.md`);
  if (!fs.existsSync(f)) return `- ${id}: no goal file found`;
  const d = parseDoc(fs.readFileSync(f, "utf8"));
  const log = (d.sections.Log || "").split("\n").filter((l) => /^- \d{4}-\d{2}-\d{2} /.test(l) && !/^- \S+ ATTENTION /.test(l));
  const recent = log.slice(-3).map((l) => `    ${l.length > 300 ? l.slice(0, 297) + "..." : l}`);
  return [`- ${id}: ${d.head.TITLE || ""}${d.head.MEASURE ? ` (measure: ${d.head.MEASURE})` : ""}`, ...recent].join("\n");
}

export function habitLine(h, ymd) {
  const s = stats(h, ymd, 7);
  const v = verdict(h, ymd);
  const note = v === "graduate" ? "; six weeks of mostly done: offer to graduate it" : v === "struggling" ? "; under half for two weeks: ask whether to make it smaller or drop it" : "";
  return `- ${h.title} (${h.daysText}${h.auto ? `, ticked from data: ${h.auto}` : ""}): last 7 days done ${s.done}, no ${s.no}, skip ${s.skip}, unknown ${s.unknown}${note}`;
}

export function brief(mcDir, s, area, ymd) {
  const rel = (p) => path.relative(mcDir, p).replace(/\\/g, "/");
  const L = [];
  L.push(`COACH TALK DUE: ${area.title} (${area.slug}), ${ymd}, ${area.time} ${s.timezone}`);
  L.push(`Record: ${rel(talkFile(area, ymd))}, created by: godspeed-coach talk open ${area.slug} --opening "<the opening>" --read "<what you read>"`);
  L.push(`Style: ${area.style}. Tone: ${area.tone}. Rhythm: ${area.rhythmText}.`);
  if (area.serves.length) L.push(`Serves: ${area.serves.join(", ")}.`);
  const limits = area.lists.LIMIT || [];
  if (limits.length) L.push("Limits, binding:", ...limits.map((l) => `- ${l}`));
  const reads = area.lists["MAY READ"] || [];
  if (reads.length) L.push("May read:", ...reads.map((l) => `- ${l}`));
  if (area.sections.Preparation) L.push("", "## Preparation", area.sections.Preparation);

  const qs = queuedQuestions(area, ymd);
  L.push("", "## Question queued for this talk");
  if (qs.length) {
    const q = qs[0];
    L.push(`### ${q.date}: ${q.title}`, q.body, "", `This replaces the general question. After asking it, add a line "ASKED: ${ymd}" under its heading in ${rel(path.join(area.dir, "questions.md"))}.`);
  } else L.push("None. Ask the one question the preparation leads to.");

  const missed = missedInARow(area);
  if (missed >= 3) L.push("", "## Rhythm", `The last ${missed} ${area.title} talks got no answer. This opening asks, in one line, whether the rhythm still suits him (${area.rhythmText}, ${area.time}), instead of pushing on.`);

  const last = lastTalk(area, ymd);
  L.push("", "## The last talk");
  L.push(last ? `${rel(last.file)} (${last.state})\n\n${fs.readFileSync(last.file, "utf8").trim()}` : "None yet: this is the first talk of this area.");

  const hs = listHabits(mcDir, { status: "active" }).filter((h) => h.area === area.slug);
  L.push("", "## Habits in this area");
  L.push(hs.length ? hs.map((h) => habitLine(h, ymd)).join("\n") : "None active.");

  if (area.serves.length) L.push("", "## Goals it serves", ...area.serves.map((g) => goalLines(mcDir, g)));
  return L.join("\n");
}

export const todayOf = (now, s) => localParts(now, s.timezone).date;
