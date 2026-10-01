import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPolicy, bounds, audit, checkPaths, parsePatch, checkCommand } from './core.mjs';
import { projectRoot, readState, writeState, verify } from './cli.mjs';

export function normalize(event) {
  const tool = event.tool_name; const input = event.tool_input ?? {};
  if (event.hook_event_name !== 'PreToolUse') return { kind: 'lifecycle' };
  if (['Edit', 'Write', 'MultiEdit'].includes(tool)) {
    if (!input.file_path) throw new Error('Unknown edit input'); return { kind: 'edit', paths: [input.file_path] };
  }
  if (tool === 'apply_patch') return { kind: 'edit', paths: parsePatch(input.command ?? input.patch ?? input) };
  if (['Bash', 'PowerShell', 'exec_command'].includes(tool)) return { kind: 'shell', command: input.command ?? input.cmd, cwd: input.cwd ?? input.workdir ?? event.cwd };
  if (['Read', 'Glob', 'Grep', 'read_file', 'list_directory', 'WebSearch'].includes(tool)) return { kind: 'read' };
  throw new Error('Unknown tool mutation capability denied: ' + tool);
}
export function shellCommand(root, loaded, state, command, cwd) {
  // Only one literal wrapper grammar is accepted. Shell parsing is deliberately absent.
  const match = /^node scripts\/harness\/cli\.mjs (doctor|run ([A-Z][0-9]+) ([a-z]+) ([a-z0-9-]+))$/.exec(command ?? '');
  if (!match || cwd && requireCwd(root, cwd) !== root) throw new Error('Shell must use exact registered harness wrapper');
  if (match[1] === 'doctor') return true;
  if (match[2] !== state.task || match[3] !== state.role) throw new Error('Shell task/role mismatch');
  checkCommand(root, loaded.policy, state.task, state.role, match[4]); return true;
}
import path from 'node:path';
function requireCwd(root, cwd) { return path.resolve(root, cwd); }
export function handle(root, adapter, event) {
  if (!['codex', 'claude'].includes(adapter)) throw new Error('Unknown hook adapter');
  if (!['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'].includes(event.hook_event_name)) throw new Error('Unsupported hook event');
  const loaded = loadPolicy(root); const state = readState(root, process.env.HARNESS_TASK ?? 'H01', process.env.HARNESS_ROLE ?? 'implementer'); const { task } = bounds(loaded.policy, state.task, state.role);
  if (process.env.HARNESS_TASK && process.env.HARNESS_TASK !== state.task || process.env.HARNESS_ROLE && process.env.HARNESS_ROLE !== state.role) throw new Error('Session task/role differs from start');
  if (adapter === 'codex' && event.model && event.model !== (task.dispatchModel ?? loaded.policy.roles[state.role].model)) throw new Error('Actual Codex model differs from approved role');
  audit(root, loaded, state);
  const eventName = event.hook_event_name;
  const normalized = normalize(event);
  if (normalized.kind === 'edit') checkPaths(root, loaded.policy, state.task, state.role, normalized.paths);
  if (normalized.kind === 'shell') shellCommand(root, loaded, state, normalized.command, normalized.cwd);
  if (eventName === 'Stop') {
    if (event.stop_hook_active) return { systemMessage: 'HARNESS Stop already blocked once; report incomplete verification.' };
    verify(root, loaded, state);
  }
  state.hookSmoke[adapter + ':' + eventName] = { at: new Date().toISOString(), session: event.session_id ?? null };
  writeState(root, state);
  if (eventName === 'SessionStart') return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'HARNESS ACTIVE ' + state.task + '/' + state.role + '. Read AGENTS.md, docs/MVP.md and P00 only as needed. Shell: exact node scripts/harness/cli.mjs run TASK ROLE COMMAND_ID. Unknown mutation denied. Hooks do not replace OS sandbox.' } };
  return { systemMessage: 'HARNESS checked ' + eventName };
}
export function denial(eventName, reason) {
  if (eventName === 'PreToolUse') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'HARNESS: ' + reason } };
  if (['Stop', 'PostToolUse'].includes(eventName)) return { decision: 'block', reason: 'HARNESS: ' + reason };
  return { continue: false, stopReason: 'HARNESS: ' + reason, systemMessage: 'HARNESS degraded: ' + reason };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let event = {};
  try { event = JSON.parse(fs.readFileSync(0, 'utf8')); console.log(JSON.stringify(handle(projectRoot, process.argv[2], event))); }
  catch (error) { console.log(JSON.stringify(denial(event.hook_event_name, error.message))); process.stderr.write('HARNESS DENY: ' + error.message + '\n'); process.exitCode = 2; }
}
