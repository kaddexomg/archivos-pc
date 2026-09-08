@echo off
rem ====================================================================
rem JJ PAPER - Lanzador Extractor MixNet v4.1 para Windows 7
rem ====================================================================
title JJ PAPER - Extractor MixNet v4.1
color 0b
cls

echo ====================================================================
echo      JJ PAPER -- EXTRACTOR CONSCIENTE MIXNET v4.1
echo ====================================================================
echo.
echo  Buscando Node.js en esta PC...
echo.

set "NODE="

rem 1. Probar comando node directo del sistema
where node >nul 2>nul
if %errorlevel%==0 (
    set "NODE=node"
    goto EJECUTAR
)

rem 2. Probar ubicaciones comunes de instalacion
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE=C:\Program Files\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE=C:\Program Files (x86)\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\nodejs\node.exe" (
    set "NODE=C:\nodejs\node.exe"
    goto EJECUTAR
)
if exist "D:\nodejs\node.exe" (
    set "NODE=D:\nodejs\node.exe"
    goto EJECUTAR
)
if exist "C:\node\node.exe" (
    set "NODE=C:\node\node.exe"
    goto EJECUTAR
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    goto EJECUTAR
)
if exist "%APPDATA%\npm\node.exe" (
    set "NODE=%APPDATA%\npm\node.exe"
    goto EJECUTAR
)

echo [ERROR] No se encontro Node.js en las carpetas habituales.
echo Por favor abre una ventana de CMD en esta carpeta y ejecuta:
echo   node extraer-todo-mixnet.cjs
echo.
pause
exit /b 1

:EJECUTAR
echo  Node.js detectado: %NODE%
echo  Iniciando escaneo inteligente de MixNet...
echo --------------------------------------------------------------------
echo.
"%NODE%" "%~dp0extraer-todo-mixnet.cjs"

echo.
echo ====================================================================
echo   Proceso finalizado.
echo ====================================================================
echo.
pause
