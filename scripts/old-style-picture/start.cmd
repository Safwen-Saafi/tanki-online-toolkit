@echo off
rem Double-click this file: a terminal window opens with the old-style picture maker.
chcp 65001 >nul
title Tanki old-style pictures
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is needed to run this, and it was not found.
    echo Install it from https://nodejs.org and double-click this file again.
    echo.
    pause
    exit /b 1
)
node wizard.mjs
echo.
pause
