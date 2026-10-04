import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, matches, resolveSafe, loadPolicy, checkPaths, checkCommand, parsePatch, evidence, snapshot, audit, treeHash, checkRemovedPaths, patchRemovedPaths } from '../../scripts/harness/core.mjs';
import { start, readState, run, verify, review } from '../../scripts/harness/cli.mjs';
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
  const patchEvent = normalize({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: src/a\n+x\n*** End Patch' } });
  assert.deepEqual(patchEvent.paths, ['src/a']); assert.deepEqual(patchEvent.removedPaths, []);
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

function controlledFixture(t, independent = true) {
  const f = fixture(t);
  f.policy.changeControlRequired = true;
  f.policy.roles.coordinator = { model: 'gpt-6.1-sol', effort: 'high' };
  f.policy.approvedTasks[0].changeContract = {
    sourceRef: 'user-current-request', baselineRefs: ['src/기존 파일.txt'], requireIndependentReview: independent,
    requirements: [
      { id: 'R1', origin: 'user-request', sourceRef: 'user-current-request', expectation: 'approved source edit', action: 'change', approvalRef: 'user-current-request', paths: ['src/**', 'tests/**'] },
      { id: 'R2', origin: 'user-confirmed', sourceRef: 'user-preservation-request', expectation: 'keep original bytes', action: 'preserve', paths: ['src/기존 파일.txt'] }
    ]
  };
  f.save(); return f;
}

test('required contract blocks historical approvals at start/guard/run instead of treating them as current consent', t => {
  const f = fixture(t); f.policy.changeControlRequired = true; f.save();
  assert.throws(() => start(f.root, f.loaded(), 'H01', 'implementer'), /contract/);
  assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'implementer', ['src/a']), /contract/);
  assert.throws(() => checkCommand(f.root, f.policy, 'H01', 'implementer', 'test-pass'), /contract/);
});

test('source requirement permits bounded changes; preservation applies inside a broad editable scope and to command outputs', t => {
  const f = controlledFixture(t);
  assert(checkPaths(f.root, f.policy, 'H01', 'implementer', ['src/new.txt']));
  assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'implementer', ['src/기존 파일.txt']), /preserved/);
  assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'implementer', ['src/기존 파일.txt'], { commandOutput: true }), /preserved/);
  const state = start(f.root, f.loaded(), 'H01', 'implementer');
  fs.writeFileSync(path.join(f.root, 'src/기존 파일.txt'), 'overwritten');
  assert.throws(() => audit(f.root, f.loaded(), state), /preserved/);
});

test('AI proposals, unresolved entries, and unlisted source paths cannot authorize invented buttons', t => {
  const f = controlledFixture(t);
  const contract = f.policy.approvedTasks[0].changeContract;
  contract.requirements[0].paths = ['tests/**'];
  contract.requirements.push({ id: 'P1', origin: 'proposal', sourceRef: 'AI suggestion', expectation: 'new launcher', action: 'add', paths: ['src/button'] });
  f.save(); const state = start(f.root, f.loaded(), 'H01', 'implementer');
  assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'implementer', ['src/button']), /No approved requirement/);
  contract.requirements.at(-1).origin = 'unresolved';
  assert.throws(() => checkPaths(f.root, f.policy, 'H01', 'implementer', ['src/button']), /No approved requirement/);
  fs.writeFileSync(path.join(f.root, 'src/unlisted'), 'invented');
  assert.throws(() => audit(f.root, f.loaded(), state), /No approved requirement/);
});

test('baseline source must exist and current change/remove/merge approvals and requirement ids must be explicit', t => {
  const f = controlledFixture(t); const contract = f.policy.approvedTasks[0].changeContract;
  contract.baselineRefs = ['src/missing']; f.save();
  assert.throws(() => start(f.root, f.loaded(), 'H01', 'implementer'), /missing/);
  contract.baselineRefs = ['src/기존 파일.txt'];
  for (const action of ['change', 'remove', 'merge']) {
    contract.requirements[0].action = action; delete contract.requirements[0].approvalRef; f.save();
    assert.throws(() => f.loaded(), /approval/);
  }
  contract.requirements[0].approvalRef = 'explicit current user permission';
  contract.requirements[1].id = 'R1'; f.save(); assert.throws(() => f.loaded(), /mapping/);
});

test('patch delete/move and actual deletion need removal consent, not a general change permission', t => {
  const f = controlledFixture(t); const contract = f.policy.approvedTasks[0].changeContract;
  fs.writeFileSync(path.join(f.root, 'src/removable'), 'initial');
  const patch = '*** Begin Patch\n*** Update File: src/removable\n*** Move to: src/moved\n@@\n-a\n+b\n*** Delete File: src/other\n*** End Patch';
  assert.deepEqual(patchRemovedPaths(patch), ['src/removable', 'src/other']);
  assert.throws(() => checkRemovedPaths(f.root, f.policy, 'H01', ['src/removable']), /Deletion approval/);
  let state = start(f.root, f.loaded(), 'H01', 'implementer'); fs.unlinkSync(path.join(f.root, 'src/removable'));
  assert.throws(() => audit(f.root, f.loaded(), state), /Deletion approval/);
  fs.writeFileSync(path.join(f.root, 'src/removable'), 'initial');
  contract.requirements.push({ id: 'D1', origin: 'user-confirmed', sourceRef: 'user-remove-request', expectation: 'remove only named file', action: 'remove', approvalRef: 'user-remove-request', paths: ['src/removable'] });
  f.save(); assert(checkRemovedPaths(f.root, f.policy, 'H01', ['src/removable']) === undefined);
  state = start(f.root, f.loaded(), 'H01', 'implementer'); fs.unlinkSync(path.join(f.root, 'src/removable'));
  assert.deepEqual(audit(f.root, f.loaded(), state), ['src/removable']);
});

test('passing tests alone cannot complete a task that requires independent review', t => {
  const f = controlledFixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'coordinator');
  run(f.root, loaded, state, 'test-pass');
  assert.throws(() => verify(f.root, loaded, state), /Independent review missing/);
  assert.throws(() => review(f.root, loaded, state, 'pass'), /independent/);
  const checker = start(f.root, loaded, 'H01', 'checker'); assert.throws(() => review(f.root, loaded, checker, 'pass'), /independent/);
  const reviewer = start(f.root, loaded, 'H01', 'verifier');
  review(f.root, loaded, reviewer, 'fail'); assert.throws(() => verify(f.root, loaded, state), /failed/);
  review(f.root, loaded, reviewer, 'pass'); assert.equal(verify(f.root, loaded, state).status, 'verified');
  assert.deepEqual(readState(f.root, 'H01', 'verifier').review.requirementIds, ['R1', 'R2']);
});

test('later source change invalidates review even after all automated checks are refreshed', t => {
  const f = controlledFixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'coordinator');
  run(f.root, loaded, state, 'test-pass'); const reviewer = start(f.root, loaded, 'H01', 'verifier'); review(f.root, loaded, reviewer, 'pass');
  fs.writeFileSync(path.join(f.root, 'src/late-edit'), 'after review'); run(f.root, loaded, state, 'test-pass');
  assert.throws(() => verify(f.root, loaded, state), /stale/);
});

test('minor direct verification remains possible when independent review is explicitly not required', t => {
  const f = controlledFixture(t, false); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'coordinator');
  run(f.root, loaded, state, 'test-pass'); assert.equal(verify(f.root, loaded, state).status, 'verified');
});

test('both hook adapters enforce missing review on Stop and removal on PreToolUse', t => {
  const f = controlledFixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'implementer'); run(f.root, loaded, state, 'test-pass');
  for (const adapter of ['codex', 'claude']) {
    assert.throws(() => handle(f.root, adapter, { hook_event_name: 'Stop' }), /Independent review/);
    assert.throws(() => handle(f.root, adapter, { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Delete File: src/unapproved\n*** End Patch' } }), /Deletion approval/);
  }
});

test('exact lifecycle/review wrappers work, while extra arguments and unauthorized review still fail', t => {
  const f = fixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'implementer');
  for (const command of ['start H01 implementer', 'guard H01 implementer src/a tests/b', 'verify H01 implementer']) assert(shellCommand(f.root, loaded, state, 'node scripts/harness/cli.mjs ' + command, f.root));
  for (const command of ['verify H01 implementer extra', 'review H01 implementer pass', 'run H01 implementer test-pass extra', 'guard H01 implementer src/../참고자료/raw.txt']) assert.throws(() => shellCommand(f.root, loaded, state, 'node scripts/harness/cli.mjs ' + command, f.root));
  const reviewer = start(f.root, loaded, 'H01', 'verifier'); assert(shellCommand(f.root, loaded, reviewer, 'node scripts/harness/cli.mjs review H01 verifier pass', f.root));
});

test('same approved scope cannot recapture the write-role baseline to hide an unauthorized edit', t => {
  const f = controlledFixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'coordinator');
  fs.writeFileSync(path.join(f.root, 'outside.txt'), 'outside scope');
  assert.throws(() => audit(f.root, loaded, state), /Outside approved/);
  assert.throws(() => start(f.root, loaded, 'H01', 'coordinator'), /Existing baseline/);
});

test('requirement and original inputs remain reviewed even when declared as registered command outputs', t => {
  const f = controlledFixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'coordinator');
  run(f.root, loaded, state, 'test-pass'); const reviewer = start(f.root, loaded, 'H01', 'verifier'); review(f.root, loaded, reviewer, 'pass');
  run(f.root, loaded, state, 'write-output');
  assert.throws(() => verify(f.root, loaded, state), /stale/);
  run(f.root, loaded, state, 'test-pass'); assert.throws(() => verify(f.root, loaded, state), /Independent review.*stale/);
});

test('registered outputs cannot waive removal approval for an existing contracted source file', t => {
  const f = controlledFixture(t, false);
  fs.writeFileSync(path.join(f.root, 'src/remove-output.txt'), 'original');
  fs.writeFileSync(path.join(f.root, 'src/argument script.mjs'), "import fs from 'node:fs'; fs.unlinkSync('src/remove-output.txt');\n");
  f.policy.commands[1].outputs = ['src/**']; f.save(); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'coordinator');
  assert.throws(() => run(f.root, loaded, state, 'write-output'), /Deletion approval/);
  assert.equal(state.evidence['write-output'], undefined);
});

test('the actual CLI rejects unused arguments before loading policy or touching state', () => {
  const cli = path.resolve('scripts/harness/cli.mjs');
  for (const args of [['doctor', 'extra'], ['start', 'H01', 'verifier', 'extra'], ['run', 'H01', 'verifier', 'test-pass', 'extra'], ['review', 'H01', 'verifier', 'pass', 'extra'], ['verify', 'H01', 'verifier', 'extra']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, args.join(' ')); assert.match(result.stderr, /arguments|Usage/);
  }
});

test('exact guard wrappers support approved Korean and quoted space paths without accepting shell syntax', t => {
  const f = controlledFixture(t); const loaded = f.loaded(); const state = start(f.root, loaded, 'H01', 'implementer');
  for (const suffix of ['src/한글.txt', '"src/한글 공백.txt"']) assert(shellCommand(f.root, loaded, state, 'node scripts/harness/cli.mjs guard H01 implementer ' + suffix, f.root));
  for (const suffix of ['"src/../참고자료/raw.txt"', '"src/a$(write).txt"', '"src/a`;write.txt"', '"src/a|write.txt"', '"src/unterminated', 'src/a;write']) assert.throws(() => shellCommand(f.root, loaded, state, 'node scripts/harness/cli.mjs guard H01 implementer ' + suffix, f.root));
});
