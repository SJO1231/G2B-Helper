import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, matches, resolveSafe, loadPolicy, checkPaths, checkCommand, parsePatch, evidence, snapshot, audit, treeHash } from '../../scripts/harness/core.mjs';
import { start, readState, run, verify } from '../../scripts/harness/cli.mjs';
import { normalize, shellCommand, handle, denial } from '../../scripts/harness/hook.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2b-harness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['src', 'tests', '참고자료', 'prototypes/grid', 'docs/process', '.codex', '.claude']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/기존 파일.txt'), 'original');
  fs.writeFileSync(path.join(root, '참고자료/raw.txt'), 'unchanged');
  fs.writeFileSync(path.join(root, 'prototypes/grid/untracked.txt'), 'untracked frozen');
  const policy = {
    version: 1, bootstrapAuthorization: { sourceRef: 'test-human-approval', date: '2026-10-01', statement: 'approved test fixture' },
    protected: ['참고자료/**', 'prototypes/**'], frozen: [{ path: 'prototypes/grid', sha256: treeHash(root, 'prototypes/grid') }],
    roles: { implementer: { model: 'gpt-6.1-sol', effort: 'high' }, verifier: { model: 'gpt-6.1-sol', effort: 'high', readOnly: true }, checker: { model: 'gpt-6-luna', effort: 'medium', readOnly: true } },
    approvedTasks: [{ id: 'H01', status: 'approved', mode: 'implement', scope: ['src/**', 'tests/**'], commands: ['test-pass', 'write-output'], verification: ['test-pass'] }],
    commands: [
      { id: 'test-pass', executable: process.execPath, args: ['--test', '--test-reporter=tap', 'tests/pass.test.mjs'], cwd: '.', outputs: [], evidence: { kind: 'node-test', minTests: 1 } },
      { id: 'write-output', executable: process.execPath, args: ['src/argument script.mjs', '한글 공백', 'a b'], cwd: '.', outputs: ['src/output.txt'], evidence: { kind: 'exit' } }
    ]
  };
  fs.writeFileSync(path.join(root, 'tests/pass.test.mjs'), "import test from 'node:test'; test('fixture', () => {});\n");
  fs.writeFileSync(path.join(root, 'src/argument script.mjs'), "import fs from 'node:fs'; fs.writeFileSync('src/output.txt',JSON.stringify(process.argv.slice(2)));\n");
  const save = () => fs.writeFileSync(path.join(root, 'docs/process/P00.md'), '# P00\n```harness-json\n' + JSON.stringify(policy) + '\n```\n');
  save(); return { root, policy, save, loaded: () => loadPolicy(root) };
}

test('exact and subtree matching does not allow sibling prefixes', () => { assert(matches('src/a', 'src/**')); assert(!matches('src-other/a', 'src/**')); });
test('allows approved file and refuses protected, frozen, unknown task and role', t => {
  const f = fixture(t); assert(checkPaths(f.root, f.policy, 'H01', 'implementer', ['src/new.txt']));
  for (const file of ['참고자료/new.txt', 'prototypes/grid/new.txt', 'other/new.txt']) assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'implementer', [file]));
  assert.throws(() => checkPaths(f.root, f.policy, 'unknown', 'implementer', ['src/a']));
  assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'unknown', ['src/a']));
});
test('read-only roles cannot edit and cannot hide source edits in audit', t => {
  const f = fixture(t); const state = start(f.root, f.loaded(), 'H01', 'verifier');
  assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'verifier', ['src/a']));
  fs.writeFileSync(path.join(f.root, 'src/new.txt'), 'bad'); assert.throws(() => audit(f.root, f.loaded(), state), /Read-only/);
});
test('traversal, outside absolute paths and ADS rejected; spaces Korean allowed', t => {
  const f = fixture(t); assert.equal(resolveSafe(f.root, 'src/한글 공백.txt').relative, 'src/한글 공백.txt');
  for (const p of ['src/../참고자료/raw.txt', '..\\escape', 'src/a:stream', path.join(f.root, 'src/a:stream'), path.resolve(f.root, '../outside')]) assert.throws(() => resolveSafe(f.root, p));
});
test('symlink/junction into protected or outside refused', t => {
  const f = fixture(t); fs.symlinkSync(path.join(f.root, '참고자료'), path.join(f.root, 'src/link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveSafe(f.root, 'src/link/raw.txt'), /Symlink/);
});
test('patch covers add/update/delete/move paths', () => {
  const patch = '*** Begin Patch\n*** Add File: src/a\n+x\n*** Update File: src/b\n*** Move to: 참고자료/a\n*** Delete File: src/c\n*** End Patch';
  assert.deepEqual(parsePatch(patch), ['src/a', 'src/b', '참고자료/a', 'src/c']); assert.throws(() => parsePatch('unknown mutation'));
});
test('frozen untracked modification, addition, deletion detected by hash', t => {
  const f = fixture(t); const state = start(f.root, f.loaded(), 'H01', 'implementer');
  fs.writeFileSync(path.join(f.root, 'prototypes/grid/untracked.txt'), 'changed'); assert.throws(() => audit(f.root, f.loaded(), state), /Frozen/);
  fs.writeFileSync(path.join(f.root, 'prototypes/grid/untracked.txt'), 'untracked frozen');
  fs.writeFileSync(path.join(f.root, 'prototypes/grid/added.txt'), 'added'); assert.throws(() => audit(f.root, f.loaded(), state), /Frozen/);
  fs.unlinkSync(path.join(f.root, 'prototypes/grid/added.txt')); fs.unlinkSync(path.join(f.root, 'prototypes/grid/untracked.txt')); assert.throws(() => audit(f.root, f.loaded(), state), /Frozen/);
});
test('preexisting edits preserved, new untracked outside scope caught', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'preexisting.txt'), 'user'); const state = start(f.root, f.loaded(), 'H01', 'implementer');
  assert.deepEqual(audit(f.root, f.loaded(), state), []); fs.writeFileSync(path.join(f.root, 'outside.txt'), 'bad'); assert.throws(() => audit(f.root, f.loaded(), state), /Outside approved/);
});
test('policy change invalidates active baseline', t => {
  const f = fixture(t); const state = start(f.root, f.loaded(), 'H01', 'implementer'); f.policy.approvedTasks[0].scope.push('outside/**'); f.save(); assert.throws(() => audit(f.root, f.loaded(), state), /stale/);
});
test('bootstrap authorization, duplicate blocks and generic shells rejected', t => {
  const f = fixture(t); delete f.policy.bootstrapAuthorization; f.save(); assert.throws(() => f.loaded(), /authorization/);
  f.policy.bootstrapAuthorization = { sourceRef: 'human', date: 'today', statement: 'approved' }; f.policy.commands[0].executable = path.resolve(path.dirname(process.execPath), 'powershell.exe'); f.save(); assert.throws(() => f.loaded(), /shells/);
  f.policy.commands[0].executable = process.execPath; f.save(); fs.appendFileSync(path.join(f.root, 'docs/process/P00.md'), '\n```harness-json\n{}\n```'); assert.throws(() => f.loaded(), /Exactly one/);
  f.policy.commands[0].executable = path.resolve(path.dirname(process.execPath), 'git.exe'); f.policy.commands[0].args = ['push']; f.save(); assert.throws(() => f.loaded(), /Git commit\/push/);
});
test('command catalog rejects unknown id or protected output', t => {
  const f = fixture(t); assert.throws(() => checkCommand(f.root, f.policy, 'H01', 'implementer', 'unknown'));
  f.policy.commands[0].outputs = ['참고자료/raw.txt']; assert.throws(() => checkCommand(f.root, f.policy, 'H01', 'implementer', 'test-pass'), /Protected/);
});
test('literal shell wrapper only: denies separators, quoting, traversal and wrong task', t => {
  const f = fixture(t); const state = start(f.root, f.loaded(), 'H01', 'implementer');
  assert(shellCommand(f.root, f.loaded(), state, 'node scripts/harness/cli.mjs run H01 implementer test-pass', f.root));
  for (const command of ['node -e "delete"', 'node scripts/harness/cli.mjs run H01 implementer test-pass; rm x', 'node scripts/harness/cli.mjs run H02 implementer test-pass', 'node scripts/harness/../harness/cli.mjs doctor', 'node scripts/harness/cli.mjs run H01 implementer "test-pass"']) assert.throws(() => shellCommand(f.root, f.loaded(), state, command, f.root));
});
test('unknown tools denied; adapters recognize structured edit and patch', () => {
  assert.throws(() => normalize({ hook_event_name: 'PreToolUse', tool_name: 'mcp__unknown__write', tool_input: {} }));
  assert.deepEqual(normalize({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'src/a' } }).paths, ['src/a']);
  assert.deepEqual(normalize({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: src/a\n+x\n*** End Patch' } }).paths, ['src/a']);
});
test('zero tests, failure, missing summary and cancelled tests are not passes', () => {
  for (const output of ['# tests 0\n# fail 0', '', '# tests 3\n# fail 1', '# tests 3\n# fail 0\n# cancelled 1']) assert.throws(() => evidence(output, { kind: 'node-test', minTests: 1 }));
  assert.equal(evidence('# tests 2\n# pass 2\n# fail 0', { kind: 'node-test' }).count, 2);
  assert.throws(() => evidence('No test files found', { kind: 'vitest' }));
});
test('argv preserves Korean and spaces, exact outputs and cwd', t => {
  const f = fixture(t); const state = start(f.root, f.loaded(), 'H01', 'implementer'); run(f.root, f.loaded(), state, 'write-output');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'src/output.txt'), 'utf8')), ['한글 공백', 'a b']);
});
test('undeclared command write detected after process and not falsely recorded', t => {
  const f = fixture(t); f.policy.commands[1].outputs = []; f.save(); const state = start(f.root, f.loaded(), 'H01', 'implementer');
  assert.throws(() => run(f.root, f.loaded(), state, 'write-output'), /undeclared/); assert.equal(readState(f.root).evidence['write-output'], undefined);
});
test('verify needs real current evidence and invalidates after source edit', t => {
  const f = fixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'implementer');
  assert.throws(() => verify(f.root, loaded, state), /Missing/); assert.equal(run(f.root, loaded, state, 'test-pass').count, 1);
  assert.equal(verify(f.root, loaded, state).status, 'verified'); fs.writeFileSync(path.join(f.root, 'src/a'), 'new'); assert.throws(() => verify(f.root, loaded, state), /stale/);
});
test('both adapters return valid deny and lifecycle marker; actual model mismatch fails', t => {
  const f = fixture(t); start(f.root, f.loaded(), 'H01', 'implementer');
  for (const adapter of ['codex', 'claude']) {
    assert(handle(f.root, adapter, { hook_event_name: 'SessionStart', cwd: f.root, session_id: 'smoke', model: 'gpt-6.1-sol' }).hookSpecificOutput.additionalContext.includes('HARNESS ACTIVE'));
    assert.throws(() => handle(f.root, adapter, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '참고자료/raw.txt' } }));
  }
  assert.throws(() => handle(f.root, 'codex', { hook_event_name: 'SessionStart', model: 'gpt-6-astra' }), /model differs/);
  assert.equal(denial('PreToolUse', 'bad').hookSpecificOutput.permissionDecision, 'deny'); assert.equal(denial('Stop', 'bad').decision, 'block');
});
test('CLI malformed hook stdin exits 2 with machine-readable deny', () => {
  const hook = path.resolve('scripts/harness/hook.mjs'); const result = spawnSync(process.execPath, [hook, 'codex'], { input: '{bad', encoding: 'utf8' });
  assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).continue, false);
});
test('Astra automatic role refused and unknown evidence format refused', t => {
  const f = fixture(t); f.policy.roles.implementer.model = 'gpt-6-astra'; assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'implementer', ['src/a']), /Astra/); assert.throws(() => evidence('done', { kind: 'invented' }));
});
test('task states separate; current approved collaborating task changes do not stale own evidence', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, 'product'));
  f.policy.approvedTasks.push({ id: 'M01', status: 'approved', mode: 'implement', scope: ['product/**'], commands: [], verification: [] }); f.save();
  const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'implementer'); run(f.root, loaded, state, 'test-pass');
  start(f.root, loaded, 'M01', 'implementer'); fs.writeFileSync(path.join(f.root, 'product/changed'), 'authorized collaborator');
  assert.equal(readState(f.root, 'M01', 'implementer').task, 'M01'); assert.equal(readState(f.root).task, 'H01');
  assert.equal(verify(f.root, loaded, state).status, 'verified');
  fs.writeFileSync(path.join(f.root, '참고자료/raw.txt'), 'bad'); assert.throws(() => audit(f.root, loaded, state), /Protected/);
});
test('unstated or stale collaboration cannot authorize outside changes', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, 'product'));
  f.policy.approvedTasks.push({ id: 'M01', status: 'approved', mode: 'implement', scope: ['product/**'], commands: [], verification: [] }); f.save();
  const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'implementer'); fs.writeFileSync(path.join(f.root, 'product/changed'), 'unstated');
  assert.throws(() => audit(f.root, loaded, state), /Outside approved/); assert.throws(() => readState(f.root, '../escape', 'implementer'), /Invalid state/);
});
test('registered build outputs do not invalidate preceding source test evidence', t => {
  const f = fixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'implementer');
  run(f.root, loaded, state, 'test-pass'); run(f.root, loaded, state, 'write-output'); assert.equal(verify(f.root, loaded, state).status, 'verified');
});

test('explicit verification inputs override output exclusion and track read-only dependencies', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, 'product'));
  fs.writeFileSync(path.join(f.root, 'src/review.mjs'), 'review v1');
  f.policy.approvedTasks[0].verificationInputs = ['src/review.mjs', 'product/**'];
  f.policy.commands[1].outputs = ['src/**'];
  f.policy.approvedTasks.push({ id: 'M01', status: 'approved', mode: 'implement', scope: ['product/**'], commands: [], verification: [] }); f.save();
  const loaded = f.loaded(), state = start(f.root, loaded, 'H01', 'implementer'); start(f.root, loaded, 'M01', 'implementer');
  run(f.root, loaded, state, 'test-pass'); run(f.root, loaded, state, 'write-output');
  assert.equal(verify(f.root, loaded, state).status, 'verified');
  fs.writeFileSync(path.join(f.root, 'src/review.mjs'), 'review v2'); assert.throws(() => verify(f.root, loaded, state), /stale/);
  fs.writeFileSync(path.join(f.root, 'src/review.mjs'), 'review v1');
  fs.writeFileSync(path.join(f.root, 'product/changed'), 'authorized edit'); assert.throws(() => verify(f.root, loaded, state), /stale/);
  f.policy.approvedTasks[0].verificationInputs = ['../outside']; f.save(); assert.throws(() => f.loaded(), /Traversal|escapes/);
});

test('explicit human Astra dispatch accepts its actual model without changing automatic roles', t => {
  const f = fixture(t); f.policy.approvedTasks[0].dispatchModel = 'gpt-6-astra';
  f.policy.approvedTasks[0].authorizationRef = 'explicit human Astra request'; f.save();
  start(f.root, f.loaded(), 'H01', 'implementer');
  assert(handle(f.root, 'codex', { hook_event_name: 'SessionStart', model: 'gpt-6-astra' }).hookSpecificOutput);
  assert.throws(() => handle(f.root, 'codex', { hook_event_name: 'SessionStart', model: 'gpt-6.1-sol' }), /model differs/);
  delete f.policy.approvedTasks[0].authorizationRef; f.save(); assert.throws(() => f.loaded(), /dispatch authorization/);
});
test('directory frozen pre-edit guard blocks descendants even without protected glob', t => {
  const f = fixture(t); f.policy.protected = []; f.policy.approvedTasks[0].scope.push('prototypes/**');
  assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'implementer', ['prototypes/grid/new.txt']), /frozen/);
});
