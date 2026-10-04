import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Execute the shipped installer itself. Only the wrapper substitutes registry
// cmdlets and interactive input; the product script has no test bypass switch.
const root = mkdtempSync(path.join(tmpdir(), 'g2b-installer-'));
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const source = path.resolve('scripts/install-mvp-host.ps1');
const hostName = 'com.sjo1231.g2b_helper';
const a = 'a'.repeat(32), b = 'b'.repeat(32), c = 'c'.repeat(32);
const origin = (id) => `chrome-extension://${id}/`;
const fixedPublicKey = JSON.parse(readFileSync('scripts/mvp-extension-key.json', 'utf8'));
const publicDer = Buffer.from(fixedPublicKey.key, 'base64');
assert.equal(createPublicKey({ key: publicDer, format: 'der', type: 'spki' }).asymmetricKeyType, 'rsa');
const digest = createHash('sha256').update(publicDer).digest();
const automaticId = [...digest.subarray(0, 16)].flatMap(byte => [byte >> 4, byte & 15]).map(nibble => String.fromCharCode(97 + nibble)).join('');
assert.equal(automaticId, fixedPublicKey.id);
assert.equal(automaticId, 'igmgbdicnjmipkncpmojbkioialdjkog');
const results = [];
let fixtureCount = 0;

function fixture({ copied = false, host = true } = {}) {
  const directory = path.join(root, `fixture ${++fixtureCount} 설치`);
  const scriptDirectory = path.join(directory, copied ? 'mvp-host' : 'scripts');
  const hostDirectory = copied ? scriptDirectory : path.join(directory, 'dist', 'mvp-host');
  mkdirSync(scriptDirectory, { recursive: true });
  const script = path.join(scriptDirectory, 'install-mvp-host.ps1');
  copyFileSync(source, script);
  const exe = path.join(hostDirectory, 'G2BHelperHost', 'G2BHelperHost.exe');
  if (host) {
    mkdirSync(path.dirname(exe), { recursive: true });
    writeFileSync(exe, 'isolated runtime fixture; installer must never execute this file');
  }
  return { directory, script, hostDirectory, exe, manifest: path.join(hostDirectory, `${hostName}.json`), extensionManifest: path.join(path.dirname(hostDirectory), 'mvp-extension', 'manifest.json') };
}

function packageManifest(f, value = { manifest_version: 3, name: 'G2B Helper MVP', version: '1.0.0', key: fixedPublicKey.key }) {
  mkdirSync(path.dirname(f.extensionManifest), { recursive: true });
  writeFileSync(f.extensionManifest, typeof value === 'string' ? value : JSON.stringify(value));
}

function execute(f, request = {}) {
  const requestPath = path.join(f.directory, 'request.json');
  const logPath = path.join(f.directory, 'registry-mock.json');
  const wrapperPath = path.join(f.directory, 'wrapper.ps1');
  writeFileSync(requestPath, JSON.stringify({ script: f.script, log: logPath, ...request }));
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  writeFileSync(wrapperPath, `\uFEFF
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath ${quote(requestPath)} -Raw -Encoding UTF8 | ConvertFrom-Json
$global:G2BInstallerTestRegistryCalls = [System.Collections.Generic.List[object]]::new()
$global:G2BInstallerTestPromptCount = 0
$global:G2BInstallerTestInput = [string]$request.input
function New-Item {
    param([string]$Path, [string]$ItemType, [switch]$Force)
    if ($Path -like 'HKCU:*') {
        if ($Path -cnotmatch '^HKCU:\\\\Software\\\\(Google\\\\Chrome|Microsoft\\\\Edge)\\\\NativeMessagingHosts\\\\com[.]sjo1231[.]g2b_helper$') { throw 'Unexpected registry target.' }
        $global:G2BInstallerTestRegistryCalls.Add(@{ action = 'create'; path = $Path })
        return
    }
    Microsoft.PowerShell.Management\\New-Item -Path $Path -ItemType $ItemType -Force:$Force
}
function Set-Item {
    param([string]$LiteralPath, [string]$Value)
    if ($LiteralPath -cnotmatch '^HKCU:\\\\Software\\\\(Google\\\\Chrome|Microsoft\\\\Edge)\\\\NativeMessagingHosts\\\\com[.]sjo1231[.]g2b_helper$') { throw 'Unexpected Set-Item target.' }
    $global:G2BInstallerTestRegistryCalls.Add(@{ action = 'set'; path = $LiteralPath; value = $Value })
}
function Read-Host {
    param([string]$Prompt)
    $global:G2BInstallerTestPromptCount++
    return $global:G2BInstallerTestInput
}
$exitCode = 0
try {
    $invoke = @{}
    if ($null -ne $request.ids) { $invoke.ExtensionId = [string[]]$request.ids }
    if ($null -ne $request.hostExecutable) { $invoke.HostExecutable = [string]$request.hostExecutable }
    if ($request.preview) { $invoke.Preview = $true }
    & $request.script @invoke
} catch {
    [Console]::Error.WriteLine($_.Exception.Message + [Environment]::NewLine + $_.ScriptStackTrace)
    $exitCode = 1
} finally {
    @{ calls = @($global:G2BInstallerTestRegistryCalls.ToArray()); prompts = $global:G2BInstallerTestPromptCount } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $request.log -Encoding UTF8
}
exit $exitCode
`, 'utf8');
  const run = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', wrapperPath], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  assert.ifError(run.error);
  assert.ok(existsSync(logPath), `PowerShell wrapper did not run: ${run.stderr}`);
  return { ...run, log: JSON.parse(readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '')) };
}

function expectSuccess(run) { assert.equal(run.status, 0, run.stderr || run.stdout); }
function expectFailure(run, pattern) {
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, pattern);
  assert.deepEqual(run.log.calls, []);
}
function manifest(f) { return JSON.parse(readFileSync(f.manifest, 'utf8')); }
function expectBothBrowsers(f, run) {
  assert.deepEqual(run.log.calls.filter((call) => call.action === 'set'), [
    { action: 'set', path: `HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`, value: f.manifest },
    { action: 'set', path: `HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`, value: f.manifest },
  ]);
  assert.equal(run.log.calls.length, 4);
}
function test(name, action) {
  action();
  results.push({ name, passed: true });
  console.log(`ok ${results.length} - ${name}`);
}

try {
  test('first install accepts Chrome and Edge IDs together', () => {
    const f = fixture();
    const run = execute(f, { ids: [a, b] });
    expectSuccess(run);
    assert.deepEqual(manifest(f).allowed_origins, [origin(a), origin(b)]);
    assert.equal(manifest(f).path, f.exe);
    assert.equal(run.log.prompts, 0);
    expectBothBrowsers(f, run);
  });
  test('legacy single -ExtensionId remains accepted', () => {
    const f = fixture();
    expectSuccess(execute(f, { ids: [a] }));
    assert.deepEqual(manifest(f).allowed_origins, [origin(a)]);
  });
  test('reinstall merges old IDs, removes duplicates and replaces atomically', () => {
    const f = fixture();
    expectSuccess(execute(f, { ids: [a, b] }));
    const run = execute(f, { ids: [b, c, c] });
    expectSuccess(run);
    assert.deepEqual(manifest(f).allowed_origins, [origin(a), origin(b), origin(c)]);
    expectBothBrowsers(f, run);
    assert.deepEqual(readdirSync(f.hostDirectory).sort(), ['G2BHelperHost', `${hostName}.json`].sort());
  });
  test('one combined interactive prompt splits commas, semicolons and whitespace', () => {
    const f = fixture();
    const run = execute(f, { input: `  ${a}, ${b};\t${a}\n${c}  ` });
    expectSuccess(run);
    assert.equal(run.log.prompts, 1);
    assert.deepEqual(manifest(f).allowed_origins, [origin(a), origin(b), origin(c)]);
  });
  test('explicit combined string splits delimiters', () => {
    const f = fixture();
    expectSuccess(execute(f, { ids: [`${a}; ${b},${a}`] }));
    assert.deepEqual(manifest(f).allowed_origins, [origin(a), origin(b)]);
  });
  test('bad ID preserves existing manifest and has no registry side effects', () => {
    const f = fixture();
    expectSuccess(execute(f, { ids: [a] }));
    const before = readFileSync(f.manifest);
    expectFailure(execute(f, { ids: [b, 'invalid'] }), /Invalid extension ID/);
    assert.deepEqual(readFileSync(f.manifest), before);
  });
  test('empty interactive input does not register anything', () => {
    const f = fixture();
    expectFailure(execute(f, { input: ' , ; ' }), /At least one/);
    assert.equal(existsSync(f.manifest), false);
  });
  test('missing executable is rejected before prompt or directory creation', () => {
    const f = fixture({ host: false });
    const run = execute(f, { input: a });
    expectFailure(run, /packaged G2BHelperHost/);
    assert.equal(run.log.prompts, 0);
    assert.equal(existsSync(f.hostDirectory), false);
  });
  test('non-executable explicit path preserves registration', () => {
    const f = fixture();
    expectSuccess(execute(f, { ids: [a] }));
    const before = readFileSync(f.manifest);
    expectFailure(execute(f, { ids: [b], hostExecutable: f.script }), /packaged G2BHelperHost/);
    assert.deepEqual(readFileSync(f.manifest), before);
  });
  for (const [name, value] of [
    ['broken JSON', '{'],
    ['wrong host name', JSON.stringify({ name: 'other', path: 'C:\\host.exe', type: 'stdio', allowed_origins: [origin(a)] })],
    ['invalid allowed origin', JSON.stringify({ name: hostName, path: 'C:\\host.exe', type: 'stdio', allowed_origins: [origin(a), 'https://example.invalid/'] })],
    ['scalar allowed origins', JSON.stringify({ name: hostName, path: 'C:\\host.exe', type: 'stdio', allowed_origins: origin(a) })],
  ]) {
    test(`${name} is rejected without clobbering existing manifest`, () => {
      const f = fixture();
      writeFileSync(f.manifest, value);
      const before = readFileSync(f.manifest);
      expectFailure(execute(f, { ids: [b] }), /Existing Native Host manifest is invalid/);
      assert.deepEqual(readFileSync(f.manifest), before);
    });
  }
  test('copied ZIP layout resolves runtime beside installer in spaced Unicode path', () => {
    const f = fixture({ copied: true });
    const run = execute(f, { ids: [a, b] });
    expectSuccess(run);
    assert.equal(manifest(f).path, f.exe);
    assert.deepEqual(manifest(f).allowed_origins, [origin(a), origin(b)]);
    expectBothBrowsers(f, run);
  });
  test('preview computes merged plan without manifest or registry mutations', () => {
    const f = fixture();
    const first = execute(f, { ids: [a], preview: true });
    expectSuccess(first);
    assert.equal(existsSync(f.manifest), false);
    assert.deepEqual(first.log.calls, []);
    expectSuccess(execute(f, { ids: [a] }));
    const before = readFileSync(f.manifest);
    const repeat = execute(f, { ids: [b], preview: true });
    expectSuccess(repeat);
    assert.match(repeat.stdout, new RegExp(b));
    assert.deepEqual(repeat.log.calls, []);
    assert.deepEqual(readFileSync(f.manifest), before);
  });
  test('copied ZIP automatically derives fixed ID for both browsers without prompting', () => {
    const f = fixture({ copied: true });
    packageManifest(f);
    const run = execute(f);
    expectSuccess(run);
    assert.equal(run.log.prompts, 0);
    assert.deepEqual(manifest(f).allowed_origins, [origin(automaticId)]);
    assert.equal(manifest(f).path, f.exe);
    expectBothBrowsers(f, run);
  });
  test('same public key has the same ID in different copied installation folders', () => {
    const first = fixture({ copied: true }), second = fixture({ copied: true });
    assert.notEqual(first.directory, second.directory);
    for (const f of [first, second]) {
      packageManifest(f);
      const run = execute(f);
      expectSuccess(run);
      assert.equal(run.log.prompts, 0);
      assert.deepEqual(manifest(f).allowed_origins, [origin(automaticId)]);
      assert.equal(manifest(f).path, f.exe);
    }
  });
  test('development dist layout also derives the packaged manifest ID', () => {
    const f = fixture();
    packageManifest(f);
    const run = execute(f);
    expectSuccess(run);
    assert.equal(run.log.prompts, 0);
    assert.deepEqual(manifest(f).allowed_origins, [origin(automaticId)]);
  });
  test('automatic reinstall preserves prior manually registered IDs', () => {
    const f = fixture({ copied: true });
    expectSuccess(execute(f, { ids: [a, b] }));
    packageManifest(f);
    for (let repeat = 0; repeat < 2; repeat++) {
      const run = execute(f);
      expectSuccess(run);
      assert.equal(run.log.prompts, 0);
      assert.deepEqual(manifest(f).allowed_origins, [origin(a), origin(b), origin(automaticId)]);
      expectBothBrowsers(f, run);
    }
  });
  test('explicit ID still overrides automatic package detection', () => {
    const f = fixture({ copied: true });
    packageManifest(f);
    const run = execute(f, { ids: [a] });
    expectSuccess(run);
    assert.equal(run.log.prompts, 0);
    assert.deepEqual(manifest(f).allowed_origins, [origin(a)]);
  });
  test('valid legacy manifest without key retains the combined interactive input', () => {
    const f = fixture({ copied: true });
    packageManifest(f, { manifest_version: 3, name: 'Legacy MVP', version: '1.0' });
    const run = execute(f, { input: `${a}; ${b}` });
    expectSuccess(run);
    assert.equal(run.log.prompts, 1);
    assert.deepEqual(manifest(f).allowed_origins, [origin(a), origin(b)]);
  });
  test('automatic preview shows fixed ID and preserves all registrations', () => {
    const f = fixture({ copied: true });
    packageManifest(f);
    const first = execute(f, { preview: true });
    expectSuccess(first);
    assert.equal(first.log.prompts, 0);
    assert.deepEqual(first.log.calls, []);
    assert.equal(existsSync(f.manifest), false);
    assert.match(first.stdout, new RegExp(automaticId));
    expectSuccess(execute(f, { ids: [a] }));
    const before = readFileSync(f.manifest);
    const repeat = execute(f, { preview: true });
    expectSuccess(repeat);
    assert.equal(repeat.log.prompts, 0);
    assert.deepEqual(repeat.log.calls, []);
    assert.deepEqual(readFileSync(f.manifest), before);
  });
  const validManifest = { manifest_version: 3, name: 'G2B Helper MVP', version: '1.0', key: fixedPublicKey.key };
  for (const [name, value] of [
    ['malformed package JSON', '{'],
    ['missing package name', { ...validManifest, name: undefined }],
    ['blank package name', { ...validManifest, name: '  ' }],
    ['invalid package version', { ...validManifest, version: '1.0.beta' }],
    ['out of range package version', { ...validManifest, version: '65536' }],
    ['all-zero package version', { ...validManifest, version: '0.0' }],
    ['wrong manifest version', { ...validManifest, manifest_version: 2 }],
    ['empty public key', { ...validManifest, key: '' }],
    ['non-string public key', { ...validManifest, key: 123 }],
    ['malformed Base64 key', { ...validManifest, key: '#broken' }],
    ['undersized public key', { ...validManifest, key: Buffer.alloc(127, 65).toString('base64') }],
    ['non-canonical Base64 public key', { ...validManifest, key: Buffer.alloc(128, 65).toString('base64').replace(/E=$/, 'F=') }],
    ['oversized public key', { ...validManifest, key: 'A'.repeat(8196) }],
    ['oversized package manifest', JSON.stringify({ ...validManifest, description: 'A'.repeat(1048576) })],
  ]) {
    test(`${name} is rejected without prompting or changing Native registration`, () => {
      const f = fixture({ copied: true });
      expectSuccess(execute(f, { ids: [a] }));
      const before = readFileSync(f.manifest);
      const beforeFiles = readdirSync(f.hostDirectory).sort();
      packageManifest(f, value);
      const run = execute(f, { input: b });
      expectFailure(run, /Packaged extension manifest is invalid/);
      assert.equal(run.log.prompts, 0);
      assert.deepEqual(readFileSync(f.manifest), before);
      assert.deepEqual(readdirSync(f.hostDirectory).sort(), beforeFiles);
    });
  }
  const output = path.resolve('artifacts/mvp-improvements/installer');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'results.json'), JSON.stringify({ tests: results.length, passed: results.length, runtime: 'Windows PowerShell; isolated temp fixtures; mocked HKCU cmdlets', actualBrowserRegistration: 'not performed', results }, null, 2));
  console.log(`Verified ${results.length} installer runtime tests; no user registry writes.`);
} finally {
  // All fixtures are within the single resolved OS temporary root created above.
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
  rmSync(root, { recursive: true, force: true });
}
