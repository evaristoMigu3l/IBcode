@echo off
title ZCode Web
cd /d "%~dp0"
rem Opens the browser once the server answers, then runs the server in this window (close it to stop).
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest http://127.0.0.1:3030 -UseBasicParsing -TimeoutSec 1|Out-Null;Start-Process http://127.0.0.1:3030;break}catch{Start-Sleep 1}}"
node scripts\start-web.mjs %*
if errorlevel 1 pause
