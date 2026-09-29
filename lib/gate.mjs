// The pre-check the talk job runs every 15 minutes before any model is started. Nothing due: it
// prints {"wakeAgent": false} and Hermes skips the model and sends nothing. A talk due: it prints the
// brief, and the model opens the talk from it. Attempts are remembered on this machine, so a run
// that failed is retried an hour later, three times at most, and a talk never opens twice.
import fs from "node:fs";
import path from "node:path";
import { listAreas } from "./areas.mjs";
import { talkDue } from "./talks.mjs";
import { brief } from "./brief.mjs";

export const NO_WAKE = '{"wakeAgent": false}';
export const MAX_ATTEMPTS = 3;
export const RETRY_MINUTES = 60;

function load(statePath) {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { return { attempts: {} }; }
}

function save(statePath, st, now) {
  const cutoff = now.getTime() - 7 * 86400000;
  for (const [k, v] of Object.entries(st.attempts)) if (!v.length || Date.parse(v.at(-1)) < cutoff) delete st.attempts[k];
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(st, null, 2) + "\n");
}

export const TALK_INSTRUCTION = "A coaching talk is due now. Follow the coach recipe, section \"Opening a talk\", with the brief above.";

export function gate(mcDir, s, now, statePath) {
  const st = load(statePath);
  for (const a of listAreas(mcDir)) {
    const ymd = talkDue(a, now, s.timezone);
    if (!ymd) continue;
    const key = `${a.slug}:${ymd}`;
    const tries = st.attempts[key] || [];
    if (tries.length >= MAX_ATTEMPTS) continue;
    if (tries.length && now.getTime() - Date.parse(tries.at(-1)) < RETRY_MINUTES * 60000) continue;
    st.attempts[key] = [...tries, now.toISOString()];
    save(statePath, st, now);
    return { wake: true, area: a.slug, ymd, attempt: tries.length + 1, output: `${brief(mcDir, s, a, ymd)}\n\n${TALK_INSTRUCTION}` };
  }
  return { wake: false, output: NO_WAKE };
}
