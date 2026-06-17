@echo off
title Infinity Pools - Build Manager
cd /d "%~dp0"
echo.
echo   Starting Infinity Pools...
echo   Keep this window open while you use the app.
echo   Opening http://localhost:4525 in your browser...
echo.
start "" http://localhost:4525
node server.js
pause
