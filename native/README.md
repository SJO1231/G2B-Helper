# PCE Gateway

Python 3.10+ for the Gateway modules. The desktop UI uses `pywebview==6.2.1`; packaging uses PyInstaller 6.20.0 in `.venv`. From repository root:

```powershell
python -m unittest discover -s native/tests -v
npm run build
python native/desktop.py
```

With no mode flag, the desktop host uses a pywebview WebView2 window over the authenticated loopback workspace. `--browser` opens the default browser; `--no-browser` runs a headless test server; `--viewer-file` opens a file in a viewer. Options include `--database`, `--port`, `--dist`, and `--webview-profile`. Default DB: `%LOCALAPPDATA%/PCE/pce.sqlite3`. GUI startup and the EXE manifest use Per-Monitor V2 DPI. Source and packaged native-window smoke now pass on this PC after reproducing the previous System DPI failure. See `docs/WEBVIEW2_DIAGNOSIS.md`; headless checks remain a separate evidence class.

Install development/build dependencies from `native/requirements-build.txt` in `.venv`. Build onedir packages with `powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1`. Outputs: `dist/desktop/PCE/PCE.exe` and `dist/desktop-v4/PCE.NativeHost/PCE.NativeHost.exe`; retain both complete directories. `native/install_host.ps1` supports `-PythonExe` for a checkout or `-HostExe` for the packaged host, and `-Browser Chrome|Edge|Both` (default Both). Actual user registration has not been run; package tests record `registryChanged=false`. Full instructions are in `docs/RUNBOOK.md`.

Requests: `{protocolVersion:1,requestId,command,payload}`. Responses have `result` or `error:{code,message}`. Successful mutation IDs persist across restarts and reject different contents under the same ID. Native responses larger than 750 KB use `{requestId,chunk:{index,total,text}}`; concatenate text then JSON-parse.

SQL reads only documented views `pce_records(row_id,source_id,store_version,content)` and `pce_tables(source_id,definition)`. SELECT/CTE supported. Use `json_extract(content,'$.field')`. Authorizer blocks writes, DDL, ATTACH, pragmas, extension loading and other tables. Queries stop near 1.5 seconds and return at most 1000 rows.

Collection rules are `settings` key `collector.rules`: list of `{sourceId,dataset:'$pointInfo'|datasetName,identityFields:string[],screenFilter?,enabled?}`. Explicit rules target existing sources only. Capture import never creates unknown business tables. Relations are single configuration records accessed by relation commands.

`collector.policy` returns `{version:1,storeVersion,rules}` for browser pre-storage screening. `capture.collect` accepts `{bundle,policyVersion}` and validates the current policy and each frame before raw insertion; unknown/ambiguous screens and stale policies fail atomically. `null` rules use designated procurement profiles; `[]` blocks collection. Desktop settings export this policy for the bookmarklet's origin-local store. Manual `capture.import` preserves the explicit file/extraction review path.

Portable backup includes typed rows, definitions, settings and raw captures. Preview reports table replacement. Restore transactionally replaces selected logical tables, retaining other tables. External paths are references only; file bytes and managed attachment storage are not implemented and are not claimed included.

File/URL launchers use OS associations; no arbitrary shell execution. Web scripts require extension userScripts. Viewer text is escaped. Loopback API uses same-origin checks plus a bearer token, no cross-site CORS.

Current evidence is in `docs/TEST_REPORT.md`: unit tests, browser UI flows, package checks and successful native-window smoke are recorded separately. These results do not establish installed Chrome registry connectivity, enterprise permissions or end-user native Windows acceptance.
