import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, bounds, snapshot, taskSnapshot, audit, checkPaths, checkCommand, execute, digest, matches } from './core.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const stateFile = (root, task = 'H01', role = 'implementer') => {
  if (!/^[A-Z][0-9]+$/.test(task) || !/^[a-z]+$/.test(role)) throw new Error('Invalid state task/role id');
  return path.join(root, '.codex/harness-state', task + '-' + role + '.json');
};
export function readState(root, task = 'H01', role = 'implementer') { return JSON.parse(fs.readFileSync(stateFile(root, task, role), 'utf8')); }
export function writeState(root, state) { const file = stateFile(root, state.task, state.role); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n'); }
export function start(root, loaded, task, role) {
  bounds(loaded.policy, task, role);
  for (const frozen of loaded.policy.frozen) if (!frozen.sha256) throw new Error('Frozen entry must have sha256');
  const state = { version: 1, task, role, policyHash: loaded.hash, startedAt: new Date().toISOString(), baseline: snapshot(root), evidence: {}, hookSmoke: {} };
  audit(root, loaded, state); writeState(root, state); return state;
}
export function run(root, loaded, state, id) {
  audit(root, loaded, state);
  const command = checkCommand(root, loaded.policy, state.task, state.role, id);
  const before = snapshot(root); const outcome = execute(root, command);
  const changed = audit(root, loaded, { ...state, baseline: before });
  for (const file of changed) {
    checkPaths(root, loaded.policy, state.task, state.role, [file], { commandOutput: true });
    if (!command.outputs.some(p => matches(file, p))) throw new Error('Command wrote undeclared output: ' + file);
  }
  state.evidence[id] = { at: new Date().toISOString(), targetHash: digest(JSON.stringify(taskSnapshot(root, loaded.policy, state.task))), count: outcome.count, exitCode: 0, commandHash: digest(JSON.stringify(command)), outputHash: digest(outcome.output) };
  writeState(root, state); return outcome;
}
export function verify(root, loaded, state) {
  const changes = audit(root, loaded, state); const targetHash = digest(JSON.stringify(taskSnapshot(root, loaded.policy, state.task)));
  const { task } = bounds(loaded.policy, state.task, state.role);
  if (!task.verification?.length) throw new Error('No required verification registered');
  for (const id of task.verification) {
    const record = state.evidence[id];
    if (!record || record.targetHash !== targetHash || record.exitCode !== 0) throw new Error('Missing/stale verification: ' + id);
    const command = checkCommand(root, loaded.policy, state.task, state.role, id);
    if (record.commandHash !== digest(JSON.stringify(command))) throw new Error('Verification command changed');
  }
  return { status: 'verified', changes, task: state.task, role: state.role, hookCoverage: state.hookSmoke, limitation: 'Hooks are advisory guardrails; skipped/failed hooks and alternate tool paths can bypass them. No OS security boundary.' };
}
export function doctor(root, loaded) {
  const files = ['.codex/hooks.json', '.codex/config.toml', '.claude/settings.json'];
  const config = files.map(file => ({ file, exists: fs.existsSync(path.join(root, file)) }));
  for (const file of ['.codex/hooks.json', '.claude/settings.json']) {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']) if (!parsed.hooks?.[event]?.length) throw new Error('Hook event missing: ' + event);
  }
  return { status: 'configuration-valid', node: process.version, policyHash: loaded.hash, config, activeSessionHooks: 'unverified', limitations: ['Codex project trust and exact hook hash trust required; /hooks to review.', 'Claude --bare, --safe-mode, restricted/project-source exclusions and invalid settings can skip hooks.', 'Explicit deny tested locally; host timeout/error fail-open must be treated as degraded.', 'No global permission changes and no auto commit/push.'] };
}
function main() {
  const [action, task = 'H01', role = 'implementer', ...rest] = process.argv.slice(2);
  const loaded = loadPolicy(projectRoot);
  if (action === 'doctor') return doctor(projectRoot, loaded);
  if (action === 'start') { start(projectRoot, loaded, task, role); return { status: 'started', task, role }; }
  if (action === 'guard') { const state = readState(projectRoot, task, role); if (state.task !== task || state.role !== role) throw new Error('Active task/role mismatch'); audit(projectRoot, loaded, state); checkPaths(projectRoot, loaded.policy, task, role, rest); return { status: 'allowed', paths: rest }; }
  const state = readState(projectRoot, task, role);
  if (state.task !== task || state.role !== role) throw new Error('Active task/role mismatch');
  if (action === 'run') { const result = run(projectRoot, loaded, state, rest[0]); process.stderr.write(result.output); return { status: 'passed', command: rest[0], count: result.count }; }
  if (action === 'verify') return verify(projectRoot, loaded, state);
  throw new Error('Usage: node scripts/harness/cli.mjs doctor|start TASK ROLE|guard TASK ROLE PATH...|run TASK ROLE COMMAND_ID|verify TASK ROLE');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(main(), null, 2)); } catch (error) { console.error('HARNESS DENY: ' + error.message); process.exitCode = 2; }
}
