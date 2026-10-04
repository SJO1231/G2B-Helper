import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, bounds, snapshot, taskSnapshot, audit, checkPaths, checkCommand, execute, digest, matches, changeContract, treeHash } from './core.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const stateFile = (root, task = 'H01', role = 'implementer') => {
  if (!/^[A-Z][0-9]+$/.test(task) || !/^[a-z]+$/.test(role)) throw new Error('Invalid state task/role id');
  return path.join(root, '.codex/harness-state', task + '-' + role + '.json');
};
export function readState(root, task = 'H01', role = 'implementer') { return JSON.parse(fs.readFileSync(stateFile(root, task, role), 'utf8')); }
export function writeState(root, state) { const file = stateFile(root, state.task, state.role); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n'); }
export function start(root, loaded, task, role) {
  const selected = bounds(loaded.policy, task, role);
  const contract = changeContract(root, loaded.policy, selected.task);
  if (contract) for (const ref of contract.baselineRefs) treeHash(root, ref);
  if (contract && !selected.role.readOnly && fs.existsSync(stateFile(root, task, role)) && readState(root, task, role).policyHash === loaded.hash) throw new Error('Existing baseline: resume without start; a new human-approved scope is required to restart');
  for (const frozen of loaded.policy.frozen) if (!frozen.sha256) throw new Error('Frozen entry must have sha256');
  const state = { version: 1, task, role, policyHash: loaded.hash, startedAt: new Date().toISOString(), baseline: snapshot(root), evidence: {}, hookSmoke: {} };
  audit(root, loaded, state); writeState(root, state); return state;
}
export function review(root, loaded, state, status) {
  audit(root, loaded, state);
  const { task, role } = bounds(loaded.policy, state.task, state.role);
  if (state.role !== 'verifier' || !role.readOnly || !['pass', 'fail'].includes(status)) throw new Error('Review requires independent read-only verifier and pass/fail');
  const contract = changeContract(root, loaded.policy, task);
  if (!contract) throw new Error('Review requires a change contract');
  state.review = { status, at: new Date().toISOString(), policyHash: loaded.hash, targetHash: digest(JSON.stringify(taskSnapshot(root, loaded.policy, state.task))), requirementIds: contract.requirements.map(item => item.id) };
  writeState(root, state);
  return { status: 'review-recorded', verdict: status, task: state.task, role: state.role, requirementIds: state.review.requirementIds, limitation: 'Reviewer declaration; not automatic proof of semantic correctness or actual caller identity.' };
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
  const contract = changeContract(root, loaded.policy, task);
  if (contract?.requireIndependentReview && !loaded.policy.roles[state.role].readOnly) {
    let reviewer;
    try { reviewer = readState(root, state.task, 'verifier'); } catch { throw new Error('Independent review missing'); }
    const record = reviewer.review;
    if (reviewer.role !== 'verifier' || !loaded.policy.roles.verifier?.readOnly || reviewer.policyHash !== loaded.hash || record?.policyHash !== loaded.hash || record?.status !== 'pass' || record.targetHash !== targetHash || JSON.stringify(record.requirementIds) !== JSON.stringify(contract.requirements.map(item => item.id))) throw new Error('Independent review missing/failed/stale');
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
export function parseArguments(args) {
  const [action, task, role, ...rest] = args;
  const invalid = () => { throw new Error('Invalid harness arguments. Usage: doctor | start/verify TASK ROLE | guard TASK ROLE PATH... | run TASK ROLE COMMAND_ID | review TASK verifier pass|fail'); };
  if (action === 'doctor') { if (args.length !== 1) invalid(); return { action }; }
  if (!['start', 'guard', 'run', 'review', 'verify'].includes(action) || !/^[A-Z][0-9]+$/.test(task ?? '') || !/^[a-z]+$/.test(role ?? '')) invalid();
  if (['start', 'verify'].includes(action) && rest.length || action === 'guard' && !rest.length || ['run', 'review'].includes(action) && rest.length !== 1) invalid();
  if (action === 'run' && !/^[a-z0-9-]+$/.test(rest[0]) || action === 'review' && (role !== 'verifier' || !['pass', 'fail'].includes(rest[0]))) invalid();
  return { action, task, role, rest };
}
function main() {
  const { action, task, role, rest } = parseArguments(process.argv.slice(2));
  const loaded = loadPolicy(projectRoot);
  if (action === 'doctor') return doctor(projectRoot, loaded);
  if (action === 'start') { start(projectRoot, loaded, task, role); return { status: 'started', task, role }; }
  if (action === 'guard') { const state = readState(projectRoot, task, role); if (state.task !== task || state.role !== role) throw new Error('Active task/role mismatch'); audit(projectRoot, loaded, state); checkPaths(projectRoot, loaded.policy, task, role, rest); return { status: 'allowed', paths: rest }; }
  const state = readState(projectRoot, task, role);
  if (state.task !== task || state.role !== role) throw new Error('Active task/role mismatch');
  if (action === 'run') { const result = run(projectRoot, loaded, state, rest[0]); process.stderr.write(result.output); return { status: 'passed', command: rest[0], count: result.count }; }
  if (action === 'review') return review(projectRoot, loaded, state, rest[0]);
  if (action === 'verify') return verify(projectRoot, loaded, state);
  throw new Error('Usage: node scripts/harness/cli.mjs doctor|start TASK ROLE|guard TASK ROLE PATH...|run TASK ROLE COMMAND_ID|review TASK verifier pass|fail|verify TASK ROLE');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(main(), null, 2)); } catch (error) { console.error('HARNESS DENY: ' + error.message); process.exitCode = 2; }
}
