// Installs godspeed-coach into a mission control folder. Each step is safe to run again, says one
// line, and never overwrites something the person made: their settings, their areas, or a recipe
// they wrote under the same name. Built the same way as godspeed-journal's installer.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import * as P from "./paths.mjs";
import { loadSettings, saveSettings, settingsFile, validateSettings, setSetting, DEFAULTS } from "./settings.mjs";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;
const isWin = process.platform === "win32";
const ok = (m) => console.log(`✓ ${m}`);
const warn = (m) => console.log(`! ${m}`);
const say = (m) => console.log(`\n${m}`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", shell: isWin, windowsHide: true, ...opts });
const git = (mcDir, args) => run("git", ["-C", mcDir, ...args], { shell: false });

const HOOK_MATCH = "godspeed-coach";
export const TALK_JOB = "coach-talks";
export const TICK_JOB = "coach-tick";
export const TALK_PROMPT = "You are opening a coaching talk. The brief above, from the coach's gate script, names the area and holds what was prepared. Follow the coach recipe (skills/coach/SKILL.md), section \"Opening a talk\". Your final answer is sent to him as it is: the opening only, or exactly [SILENT] when the command says the talk is already open.";

export function claudeHookMerge(text, command) {
  const cfg = text && text.trim() ? JSON.parse(text) : {};
  if (JSON.stringify(cfg).includes(HOOK_MATCH)) return null;
  cfg.hooks ||= {};
  cfg.hooks.UserPromptSubmit ||= [];
  cfg.hooks.UserPromptSubmit.push({ hooks: [{ type: "command", command, timeout: 10 }] });
  return JSON.stringify(cfg, null, 2) + "\n";
}
export const hermesArgs = (profile) => (profile ? ["-p", profile] : []);
export const gateScript = (bin, mcDir) => `#!/bin/sh\n# Written by godspeed-coach setup: is a coaching talk due? Prints the brief, or {"wakeAgent": false}.\nexec "${bin}" gate --godspeed "${mcDir}"\n`;
export const tickScript = (bin, mcDir) => `#!/bin/sh\n# Written by godspeed-coach setup: the habit check and the talk follow-up. Empty output sends nothing.\nexec "${bin}" tick --godspeed "${mcDir}"\n`;
export function wantTick(settings, host) {
  if (!settings.tick_host) return "register";
  return settings.tick_host === host ? "already-here" : "other-host";
}
export function telegramConfigured(configValue, envText) {
  const v = String(configValue || "").trim();
  if (v && !/^(null|none|\{\}|\[\])$/i.test(v)) return true;
  return /^\s*TELEGRAM_BOT_TOKEN\s*=\s*\S+/m.test(envText || "");
}

async function ask(q, dflt, yes) {
  if (yes || !process.stdin.isTTY) return dflt;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${q} `)).trim();
  rl.close();
  return a || dflt;
}

function stepRecipe(mcDir, extra) {
  say("The recipe your assistant follows");
  const rooms = [P.skillsRoom(mcDir), ...(extra ? [path.resolve(extra)] : [])];
  const written = [];
  for (const room of rooms) {
    const dst = path.join(room, P.RECIPE);
    if (!P.mayReplace(dst)) { warn(`Left alone: ${dst} holds a recipe you wrote with the same name.`); continue; }
    fs.rmSync(dst, { recursive: true, force: true });
    P.copyDir(path.join(PKG, "skill", P.RECIPE), dst);
    fs.writeFileSync(path.join(dst, P.MARKER), `godspeed-coach ${VERSION}\n`);
    ok(`${dst}`); written.push(dst);
  }
  return written;
}

async function stepSettings(mcDir, f) {
  say("Your settings");
  const file = settingsFile(mcDir);
  const written = [];
  if (fs.existsSync(file)) ok(`kept: ${file}`);
  else {
    const s = { ...DEFAULTS };
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    s.timezone = f.timezone || (await ask(`Your time zone [${guess}]:`, guess, f.yes));
    s.language = f.language || (await ask("Language for the habit check, en or de [en]:", "en", f.yes));
    if (f["daily-table"]) s.daily_table = f["daily-table"];
    const problems = validateSettings(s);
    if (problems.length) { warn(problems.join(" ")); return { written, failed: true }; }
    saveSettings(mcDir, s); ok(`written: ${file}`); written.push(file);
  }
  const readme = path.join(mcDir, "coach", "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, "# coach\n\nYour recurring coaching talks and habits. One folder per area of your life: area.md says when the talk happens and how it sounds, questions.md holds questions for a coming talk, talks/ has one record per talk, habits/ one file per habit.\nAsk your assistant to add an area, move a talk, start or pause a habit. `godspeed-coach areas` and `godspeed-coach habit list` show what there is.\n");
    written.push(readme);
  }
  return { written, failed: false };
}

function stepCommand() {
  say("The godspeed-coach command");
  const app = path.join(P.appHome(), "app");
  if (path.resolve(PKG) !== path.resolve(app)) {
    fs.rmSync(app, { recursive: true, force: true });
    P.copyDir(PKG, app, { skip: (n) => [".git", "node_modules", "test"].includes(n) });
  }
  const dir = P.binDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const l of P.launchers(app)) { const file = path.join(dir, l.name); fs.rmSync(file, { force: true }); fs.writeFileSync(file, l.body, { mode: l.mode }); }
  if (P.onPath(dir)) ok(`godspeed-coach is ready to type (${dir})`);
  else warn(`${dir} is not on this terminal's PATH. Open a new terminal; if godspeed-coach is still unknown, use ${path.join(dir, isWin ? "godspeed-coach.cmd" : "godspeed-coach")}`);
  return path.join(dir, "godspeed-coach");
}

async function stepHermes(mcDir, f, bin) {
  const hv = run("hermes", ["--version"]);
  if (f["no-hermes"] || (hv.status !== 0 && !f["hermes-profile"])) return { skipped: true };
  say("Hermes: the open talk before every turn, the talks and the habit check");
  const hp = hermesArgs(f["hermes-profile"]);
  const cfgPath = run("hermes", [...hp, "config", "path"]).stdout.trim().split("\n").pop();
  if (!cfgPath) { warn("Hermes did not say where its settings are; skipped. Run `hermes config path` to see why."); return { failed: true }; }
  const home = path.dirname(cfgPath);
  const plug = path.join(home, "plugins", "godspeed-coach");
  const wasThere = fs.existsSync(plug);
  P.copyDir(path.join(PKG, "hermes", "plugin", "godspeed-coach"), plug);
  fs.writeFileSync(path.join(plug, "mission-control.txt"), mcDir + "\n");
  const en = run("hermes", [...hp, "plugins", "enable", "godspeed-coach"]);
  if (en.status === 0) ok("plugin godspeed-coach enabled"); else warn(`could not enable the plugin: ${en.stderr.trim() || en.stdout.trim()}`);

  const s = loadSettings(mcDir);
  const where = wantTick(s, os.hostname());
  const tgRun = run("hermes", [...hp, "config", "get", "platforms.telegram"]);
  const envPath = run("hermes", [...hp, "config", "env-path"]).stdout.trim().split("\n").pop();
  const envText = envPath && fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (where === "other-host") ok(`Talks and the habit check already come from ${s.tick_host}; this computer only reads and writes.`);
  else if (!telegramConfigured(tgRun.status === 0 ? tgRun.stdout : "", envText)) warn("Talks need your assistant on a messenger (Chapter 32). Tracking habits still works.");
  else {
    fs.mkdirSync(path.join(home, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(home, "scripts", "coach-talk-gate.sh"), gateScript(bin, mcDir), { mode: 0o755 });
    fs.writeFileSync(path.join(home, "scripts", "coach-tick.sh"), tickScript(bin, mcDir), { mode: 0o755 });
    const list = run("hermes", [...hp, "cron", "list"]).stdout;
    if (!list.includes(TALK_JOB)) {
      const c = run("hermes", [...hp, "cron", "create", "*/15 * * * *", TALK_PROMPT, "--name", TALK_JOB, "--script", "coach-talk-gate.sh", "--skill", "coach", "--deliver", "telegram", "--failure-deliver", "local", "--workdir", mcDir]);
      if (c.status === 0) ok("talks: checked every 15 minutes, the model runs only when one is due");
      else warn(`could not schedule the talks: ${c.stderr.trim() || c.stdout.trim()}`);
    } else ok("talk schedule already there");
    if (!list.includes(TICK_JOB)) {
      const c = run("hermes", [...hp, "cron", "create", "*/15 * * * *", "--no-agent", "--script", "coach-tick.sh", "--deliver", "telegram", "--failure-deliver", "local", "--name", TICK_JOB]);
      if (c.status === 0) ok("habit check and follow-ups: every 15 minutes, silent when nothing is due");
      else warn(`could not schedule the habit check: ${c.stderr.trim() || c.stdout.trim()}`);
    } else ok("habit check schedule already there");
    setSetting(mcDir, "tick_host", os.hostname());
  }
  if (!wasThere) {
    const a = await ask("Restart the Hermes gateway now so the plugin loads? Y/n:", "y", f.yes);
    if (/^y/i.test(a)) run("hermes", [...hp, "gateway", "restart"]);
  }
  return { failed: false };
}

function stepClaude(mcDir, f) {
  if (f["no-claude"] || !fs.existsSync(path.join(mcDir, ".claude"))) return [];
  say("Claude Code: the open talk before every prompt");
  const file = path.join(mcDir, ".claude", "settings.json");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  // Always the sh launcher: Claude Code runs hooks through Git Bash on Windows too, and a .cmd
  // hook starts cmd.exe, which flashes a console window on every prompt.
  const launcher = path.join(P.binDir(), "godspeed-coach");
  const command = `"${launcher.replace(/\\/g, "/")}" context --hook claude`;
  let merged;
  try { merged = claudeHookMerge(text, command); } catch { warn(`${file} is not valid JSON; add this hook by hand: {"type":"command","command":"${command}"} under hooks.UserPromptSubmit`); return []; }
  if (merged === null) { ok("hook already there"); return []; }
  const dirty = fs.existsSync(path.join(mcDir, ".git")) && git(mcDir, ["status", "--porcelain", "--", ".claude/settings.json"]).stdout.trim() !== "";
  fs.writeFileSync(file, merged);
  if (dirty) { ok(`hook added to ${file}; it had your own uncommitted changes, so it is left for you to commit`); return []; }
  ok(`hook added to ${file}`); return [file];
}

function stepGit(mcDir, paths) {
  if (!paths.length || !fs.existsSync(path.join(mcDir, ".git"))) return;
  const rel = paths.map((p) => path.relative(mcDir, p)).filter((p) => !p.startsWith(".."));
  if (!rel.length) return;
  git(mcDir, ["add", "--", ...rel]);
  if (git(mcDir, ["diff", "--cached", "--quiet", "--", ...rel]).status === 1) {
    git(mcDir, ["commit", "-m", `Install godspeed-coach ${VERSION}`, "--", ...rel]);
    ok("saved in mission control's history");
  }
}

export async function setup(f) {
  const mcDir = P.findMissionControl({ arg: f.godspeed });
  if (!mcDir) { console.error("Could not find your mission control folder. Run this again from inside it, or add --godspeed <folder>."); return 1; }
  console.log(`godspeed-coach ${VERSION} into ${mcDir}`);
  const recipes = stepRecipe(mcDir, f["extra-skills-dir"]);
  const st = await stepSettings(mcDir, f);
  if (st.failed) return 1;
  const bin = stepCommand();
  await stepHermes(mcDir, f, bin);
  const claude = stepClaude(mcDir, f);
  stepGit(mcDir, [...recipes, ...st.written, settingsFile(mcDir), ...claude]);
  return check(mcDir, f);
}

export async function check(mcDir, f = {}) {
  say("Check");
  let essential = true;
  const line = (good, m, fix, must = false) => { console.log(`${good ? "✓" : "✗"} ${m}${good || !fix ? "" : `: ${fix}`}`); if (!good && must) essential = false; };
  const s = loadSettings(mcDir);
  line(fs.existsSync(path.join(P.binDir(), isWin ? "godspeed-coach.cmd" : "godspeed-coach")), "godspeed-coach command", "run godspeed-coach setup again", true);
  line(P.onPath(P.binDir()), "command folder on PATH", "open a new terminal, or add " + P.binDir() + " to your PATH");
  const problems = validateSettings(s);
  line(problems.length === 0, "settings", problems.join(" "), true);
  line(fs.existsSync(path.join(P.skillsRoom(mcDir), P.RECIPE, "SKILL.md")), "recipe", "run godspeed-coach setup again", true);
  if (s.daily_table) line(fs.existsSync(path.isAbsolute(s.daily_table) ? s.daily_table : path.join(mcDir, s.daily_table)), "daily table", `${s.daily_table} not found; habits with an AUTO rule wait for it`);
  const probe = path.join(mcDir, "coach", ".write-probe");
  try {
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, "x"); fs.rmSync(probe); line(true, "coach folder writable");
  } catch (e) { line(false, "coach folder writable", e.message, true); }
  if (!f["no-hermes"] && run("hermes", ["--version"]).status === 0) {
    const hp = hermesArgs(f["hermes-profile"]);
    line(/godspeed-coach/.test(run("hermes", [...hp, "plugins", "list", "--plain"]).stdout), "Hermes plugin", "hermes plugins enable godspeed-coach");
    if (s.tick_host === os.hostname()) {
      const list = run("hermes", [...hp, "cron", "list"]).stdout;
      line(list.includes(TALK_JOB), "talk schedule", "run godspeed-coach setup again");
      line(list.includes(TICK_JOB), "habit check schedule", "run godspeed-coach setup again");
    }
    line(!/false/i.test(run("hermes", [...hp, "config", "get", "stt.enabled"]).stdout), "voice messages transcribed", "hermes config set stt.enabled true");
  }
  if (fs.existsSync(path.join(mcDir, ".claude"))) {
    const t = fs.existsSync(path.join(mcDir, ".claude", "settings.json")) ? fs.readFileSync(path.join(mcDir, ".claude", "settings.json"), "utf8") : "";
    line(t.includes(HOOK_MATCH), "Claude Code hook", "run godspeed-coach setup again");
  }
  return essential ? 0 : 1;
}
