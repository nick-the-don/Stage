@echo off
setlocal

cd /d "%~dp0"
title Stage

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Stage.
  echo Install it from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH.
  echo Reinstall Node.js from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Dependency install failed.
    pause
    exit /b 1
  )
  echo.
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo Created .env from .env.example.
    echo.
  )
)

if not exist "access.env" (
  if exist "access.env.example" (
    copy "access.env.example" "access.env" >nul
    echo Created access.env from access.env.example.
    echo Edit access.env and set GEMINI_API_KEY before running Gemini or Veo jobs.
    echo.
  )
)

echo Starting Stage at http://127.0.0.1:5173
echo Press Ctrl+C to stop the server.
echo.

call npm.cmd run dev

echo.
echo Stage stopped.
pause
