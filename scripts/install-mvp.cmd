@echo off
setlocal DisableDelayedExpansion
if not exist "%~dp0mvp-host\install-mvp-host.ps1" goto missing
if not exist "%~dp0mvp-extension\manifest.json" goto missing
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "%~dp0mvp-host\install-mvp-host.ps1"
if errorlevel 1 goto failed
echo.
echo Native connection registered for Chrome and Edge. No extension ID input is needed.
echo First use: load the mvp-extension folder from chrome://extensions or edge://extensions.
echo Keep this extracted folder in place. See the included installation guide.
pause
exit /b 0
:missing
echo Extract the entire ZIP into a permanent folder before running this file.
pause
exit /b 1
:failed
echo.
echo Registration failed. See the error above. It has not been reported as complete.
pause
exit /b 1
