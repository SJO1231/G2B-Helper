import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const slash = value => value.replaceAll('\\', '/');
const isFrozen = (file, item) => matches(file, item.path) || matches(file, item.path.replace(/\/$/, '') + '/**');
export function matches(file, pattern) {
  const p = fold(slash(pattern)); const f = fold(slash(file));
  if (p.endsWith('/**')) return f === p.slice(0, -3) || f.startsWith(p.slice(0, -2));
  return f === p;
}
export function resolveSafe(root, input) {
  if (typeof input !== 'string' || !input || input.includes('\0')) fail('Invalid path');
  const normalized = slash(input);
  if (normalized.split('/').includes('..') || normalized.replace(/^[A-Za-z]:\//, '').includes(':')) fail('Traversal or alternate data stream rejected');
  const absolute = path.resolve(root, input);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('Path escapes project');
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) fail('Symlink/junction rejected');
  }
  return { absolute, relative: slash(relative) || '.' };
}
export function fileTree(root, exclusions = []) {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name); const rel = slash(path.relative(root, full));
      if (exclusions.some(p => matches(rel, p))) continue;
      if (entry.isSymbolicLink()) result[rel] = 'SYMLINK:' + fs.readlinkSync(full);
      else if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) result[rel] = digest(fs.readFileSync(full));
    }
  }
  visit(root); return result;
}
export function treeHash(root, item) {
  const { absolute } = resolveSafe(root, item);
  if (!fs.existsSync(absolute)) fail('Frozen path missing: ' + item);
  if (fs.statSync(absolute).isFile()) return digest(fs.readFileSync(absolute));
  const tree = fileTree(absolute);
  return digest(Object.keys(tree).sort().map(p => p + '\0' + tree[p]).join('\n'));
}
export function loadPolicy(root, policyFile = 'docs/process/P00.md') {
  const source = fs.readFileSync(resolveSafe(root, policyFile).absolute, 'utf8');
  const blocks = [...source.matchAll(/```harness-json\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (blocks.length !== 1) fail('Exactly one harness-json block required');
  const policy = JSON.parse(blocks[0][1]);
  if (policy.version !== 1 || !policy.bootstrapAuthorization?.sourceRef || !policy.bootstrapAuthorization?.statement || !policy.bootstrapAuthorization?.date) fail('Approved bootstrap authorization missing');
  for (const key of ['approvedTasks', 'commands', 'protected', 'frozen']) if (!Array.isArray(policy[key])) fail('Invalid policy: ' + key);
  if (!policy.roles || !policy.approvedTasks.length) fail('Roles/tasks required');
  const ids = policy.commands.map(c => c.id);
  if (new Set(ids).size !== ids.length) fail('Duplicate command id');
  for (const task of policy.approvedTasks) {
    if (task.dispatchModel !== undefined && (typeof task.dispatchModel !== 'string' || !task.dispatchModel || !task.authorizationRef)) fail('Explicit dispatch authorization missing');
    if (task.verificationInputs !== undefined) {
      if (!Array.isArray(task.verificationInputs) || !task.verificationInputs.every(p => typeof p === 'string')) fail('Invalid verification inputs');
      for (const input of task.verificationInputs) resolveSafe(root, input.endsWith('/**') ? input.slice(0, -3) : input);
    }
  }
  for (const command of policy.commands) {
    if (!command.id || !path.isAbsolute(command.executable) || !Array.isArray(command.args) || !command.args.every(a => typeof a === 'string') || !command.cwd || !Array.isArray(command.outputs)) fail('Invalid registered command (absolute executable required)');
    resolveSafe(root, command.cwd);
    for (const output of command.outputs) resolveSafe(root, output.endsWith('/**') ? output.slice(0, -3) : output);
    if (/(?:^|[\\/])(cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|bash|sh)(?:$)/i.test(command.executable)) fail('Generic shells are not registered executables');
    if (/^git(?:\.exe)?$/i.test(path.basename(command.executable)) && command.args.some(a => ['commit', 'push'].includes(a))) fail('Automated Git commit/push rejected');
    if (command.args.some(a => /dangerously|bypassPermissions|git\s+(push|commit)/i.test(a))) fail('Permission bypass or automated publishing rejected');
  }
  return { policy, hash: digest(blocks[0][1]), policyFile };
}
export function bounds(policy, taskId, roleId) {
  const task = policy.approvedTasks.find(t => t.id === taskId);
  const role = policy.roles[roleId];
  if (!task || task.status !== 'approved' || !role || !role.model || !role.effort) fail('Unknown/unapproved task or role');
  if (/astra/i.test(role.model)) fail('Astra requires explicit human dispatch; no automatic role');
  return { task, role };
}
export function checkPaths(root, policy, taskId, roleId, files, { commandOutput = false } = {}) {
  const { task, role } = bounds(policy, taskId, roleId);
  if (!files.length) fail('No mutation paths identified');
  if (!commandOutput && (role.readOnly || task.mode === 'read-only')) fail('Read-only role/task');
  for (const file of files) {
    const { relative } = resolveSafe(root, file);
    if (policy.protected.some(p => matches(relative, p)) || policy.frozen.some(p => isFrozen(relative, p))) fail('Protected/frozen mutation: ' + relative);
    if (!task.scope?.some(p => matches(relative, p))) fail('Outside approved task: ' + relative);
    if (!commandOutput && role.scope && !role.scope.some(p => matches(relative, p))) fail('Outside role scope: ' + relative);
  }
  return true;
}
export function checkCommand(root, policy, taskId, roleId, id) {
  const { task } = bounds(policy, taskId, roleId);
  const command = policy.commands.find(c => c.id === id);
  if (!command || !task.commands?.includes(id)) fail('Unregistered command for task: ' + id);
  if (command.outputs.length) checkPaths(root, policy, taskId, roleId, command.outputs.map(p => p.endsWith('/**') ? p.slice(0, -3) : p), { commandOutput: true });
  return command;
}
const excludes = ['.git/**', 'node_modules/**', '.venv/**', '.codex/harness-state/**', 'artifacts/harness/**'];
export function snapshot(root) { return fileTree(root, excludes); }
export function taskSnapshot(root, policy, taskId) {
  const task = policy.approvedTasks.find(t => t.id === taskId);
  const inputs = task.verificationInputs ?? [];
  const patterns = [...task.scope, ...policy.protected, ...inputs];
  const outputs = policy.commands.filter(c => task.commands.includes(c.id)).flatMap(c => c.outputs);
  return Object.fromEntries(Object.entries(snapshot(root)).filter(([p]) => (patterns.some(pattern => matches(p, pattern)) || policy.frozen.some(f => isFrozen(p, f))) && (!outputs.some(pattern => matches(p, pattern)) || inputs.some(pattern => matches(p, pattern)))));
}
export function diff(before, after) { return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]); }
export function audit(root, loaded, state) {
  if (!state || state.policyHash !== loaded.hash) fail('Missing/stale start baseline');
  for (const frozen of loaded.policy.frozen) if (!frozen.sha256 || treeHash(root, frozen.path) !== frozen.sha256) fail('Frozen hash changed: ' + frozen.path);
  const changes = diff(state.baseline, snapshot(root));
  const { task, role } = bounds(loaded.policy, state.task, state.role);
  const localChanges = [];
  for (const file of changes) {
    if (loaded.policy.protected.some(p => matches(file, p)) || loaded.policy.frozen.some(p => isFrozen(file, p))) fail('Protected/frozen changed: ' + file);
    if (task.scope.some(p => matches(file, p))) { localChanges.push(file); continue; }
    const otherTask = loaded.policy.approvedTasks.find(t => t.id !== task.id && t.status === 'approved' && t.scope.some(p => matches(file, p)) && Object.keys(loaded.policy.roles).some(r => {
      const statePath = path.join(root, '.codex/harness-state', t.id + '-' + r + '.json');
      if (!fs.existsSync(statePath)) return false;
      try { const other = JSON.parse(fs.readFileSync(statePath, 'utf8')); return other.policyHash === loaded.hash && other.task === t.id && other.role === r; } catch { return false; }
    }));
    if (!otherTask) fail('Outside approved task: ' + file);
  }
  if (localChanges.length) checkPaths(root, loaded.policy, state.task, state.role, localChanges, { commandOutput: true });
  if (role.readOnly || task.mode === 'read-only') {
    const allowedOutputs = loaded.policy.commands.filter(c => task.commands.includes(c.id)).flatMap(c => c.outputs);
    for (const changed of localChanges) if (!allowedOutputs.some(p => matches(changed, p))) fail('Read-only role changed source: ' + changed);
  }
  return localChanges;
}
export function parsePatch(patch) {
  if (typeof patch !== 'string' || !patch.startsWith('*** Begin Patch') || !patch.includes('*** End Patch')) fail('Unknown patch format');
  const paths = [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(m => m[1].trim());
  if (!paths.length) fail('Patch has no paths'); return paths;
}
export function evidence(output, contract = { kind: 'exit' }) {
  output = output.replace(/\x1b\[[0-9;]*m/g, '');
  if (contract.kind === 'exit') return { count: null };
  let count = 0; let failures = 0;
  if (contract.kind === 'node-test') {
    const total = output.match(/(?:#|ℹ) tests (\d+)/);
    const passed = output.match(/(?:#|ℹ) pass (\d+)/);
    const failed = output.match(/(?:#|ℹ) fail (\d+)/);
    count = Math.min(Number(total?.[1] ?? 0), Number(passed?.[1] ?? 0));
    failures = Number(failed?.[1] ?? 1);
  } else if (contract.kind === 'vitest') {
    count = Number(output.match(/Tests\s+(\d+) passed/)?.[1] ?? 0);
    failures = Number(output.match(/Tests[^\n]*?(\d+) failed/)?.[1] ?? 0);
  } else if (contract.kind === 'unittest') {
    count = Number(output.match(/Ran (\d+) tests?/)?.[1] ?? 0);
    if (!/\nOK\s*$/.test(output)) failures = 1;
  } else fail('Unknown evidence kind');
  if (count < (contract.minTests ?? 1) || failures || /No test files found|\bnot ok\b|\bcancelled [1-9]/i.test(output)) fail('Evidence gate: zero/failed/incomplete tests');
  return { count };
}
export function execute(root, command) {
  const environment = { ...process.env };
  // A registered test command is a fresh process, not the parent node:test worker.
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(command.executable, command.args, { cwd: resolveSafe(root, command.cwd).absolute, env: environment, encoding: 'utf8', shell: false, timeout: command.timeoutMs ?? 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  if (result.error || result.status !== 0) fail('Command failed: ' + (result.error?.message ?? result.status) + '\n' + output.slice(-6000));
  return { output, ...evidence(output, command.evidence), exitCode: result.status };
}
