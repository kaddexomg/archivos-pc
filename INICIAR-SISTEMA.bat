@echo off
title JJ PAPER - Intelligence Suite & Multiagente IA
color 0b

echo.
echo ========================================================================
echo    JJ PAPER -- SUITE DE INTELIGENCIA COMERCIAL & MULTIAGENTE IA
echo ========================================================================
echo.
echo  Buscando Node.js en el equipo...

where node >nul 2>nul
if %errorlevel% equ 0 (
  set "NODE_CMD=node"
  goto :START_APP
)

if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE_CMD=C:\Program Files\nodejs\node.exe"
  goto :START_APP
)

if exist "C:\Program Files (x86)\nodejs\node.exe" (
  set "NODE_CMD=C:\Program Files (x86)\nodejs\node.exe"
  goto :START_APP
)

if exist "%APPDATA%\npm\node.exe" (
  set "NODE_CMD=%APPDATA%\npm\node.exe"
  goto :START_APP
)

if exist "C:\node\node.exe" (
  set "NODE_CMD=C:\node\node.exe"
  goto :START_APP
)

echo  [ERROR] No se encontro Node.js en este equipo.
echo  Por favor instala Node.js v13 para ejecutar el sistema.
pause
exit /b 1

:START_APP
echo  [OK] Node.js detectado: %NODE_CMD%
echo.
echo  Iniciando servidor local y cargando base de datos MixNet...
echo  Abriendo panel de control en tu navegador (http://localhost:3000)...
echo.

start "" "http://localhost:3000"

"%NODE_CMD%" server.cjs

pause
