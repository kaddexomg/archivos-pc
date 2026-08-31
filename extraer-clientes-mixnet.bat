@echo off
chcp 65001 >nul
title JJ Paper - Extraer CLIENTES de MixNet
echo.
echo ========================================================
echo    EXTRACTOR DE CLIENTES MIXNET  (solo lectura)
echo ========================================================
echo.
echo  ESTE SCRIPT SOLO LEE. No modifica nada de MixNet.
echo.
echo  Buscando Node.js instalado...
echo.

REM 1) ¿Node esta en el PATH?
where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE=node"
  goto RUN
)

REM 2) Rutas comunes de instalacion (x64, x86, portable)
set "NODE="
for %%p in (
  "%ProgramFiles%\nodejs\node.exe"
  "%ProgramFiles(x86)%\nodejs\node.exe"
  "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  "%APPDATA%\npm\node.exe"
  "%USERPROFILE%\nodejs\node.exe"
  "%USERPROFILE%\AppData\Roaming\npm\node.exe"
  "C:\nodejs\node.exe"
  "C:\node\node.exe"
  "C:\Program Files\nodejs\node.exe"
  "C:\Program Files (x86)\nodejs\node.exe"
  "D:\nodejs\node.exe"
  "D:\node\node.exe"
  "D:\Program Files\nodejs\node.exe"
  "C:\Archivos de Programa\nodejs\node.exe"
) do (
  if exist %%p set "NODE=%%~p"
)
if defined NODE goto RUN

REM 3) Busqueda amplia en el disco C: (puede tardar la 1a vez)
echo  No esta en las rutas comunes. Buscando en todo el disco C: ...
echo  (Esto puede tardar; no cierres esta ventana)
for /f "delims=" %%f in ('where /R "C:\" node.exe 2^>nul') do (
  set "NODE=%%f"
  goto RUN
)
for /f "delims=" %%f in ('dir /s /b "C:\node.exe" 2^>nul') do (
  set "NODE=%%f"
  goto RUN
)

REM 4) Si aun no se encontro, probar el lanzador de npm/npx
if not exist "%NODE%" set "NODE="
where npx >nul 2>nul
if %errorlevel%==0 (
  echo  Se encontro herramientas Node (npx). Intentando localizar node.exe...
  for /f "delims=" %%f in ('where npx 2^>nul') do set "NPXDIR=%%~dpf"
  if exist "%NPXDIR%node.exe" set "NODE=%NPXDIR%node.exe"
)
if defined NODE goto RUN

echo.
echo  [ERROR] No se encontro Node.js en ninguna ubicacion.
echo.
echo  Para ejecutar este script se necesita Node.js (v13 o superior).
echo  Puedes instalarlo desde:  https://nodejs.org/
echo  (Elige "Windows Installer .msi", instala aceptando las opciones
echo   por defecto, cierra y abre esta ventana, y vuelve a probar).
echo.
echo  - O -  si sabes la carpeta exacta donde esta instalado Node,
echo  edita este archivo y pon en la linea de abajo SX:
echo    set "NODE=C:\ruta\exacta\a\node.exe"
echo.
pause
exit /b 1

:RUN
echo.
echo  Node encontrado: %NODE%
echo.
REM Nombre del CSV de salida (con fecha y hora del momento)
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set "DD=%%c%%a%%b"
for /f "tokens=1-2 delims=:" %%a in ('time /t') do set "HH=%%a%%b"
set "OUT=clientes_mixnet_%DD%_%HH%.csv"
echo  El resultado se guardara en:  %OUT%
echo.
echo  Ejecutando... (si ves [progreso fila N/...] es que esta trabajando
echo  normal, NO esta colgado. Espera a que diga "Terminado".)
echo.
"%NODE%" "%~dp0extraer-clientes-mixnet.cjs" --auto --out "%OUT%"
echo.
echo --------------------------------------------------------
echo  Terminado.
echo  El CSV quedo en:  %OUT%
echo  (junto a este archivo)
echo.
pause