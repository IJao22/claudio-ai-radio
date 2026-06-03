@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev-stack.ps1"
echo.
if errorlevel 1 (
  echo Claudio 启动失败。请查看 web.err.log、server.err.log、tts.err.log。
) else (
  echo Claudio 已启动。
  echo Web: http://127.0.0.1:5173
)
pause
