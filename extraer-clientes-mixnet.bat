@echo off
chcp 65001 >nul 2>nul
title JJ Paper - Extraer CLIENTES de MixNet
color 0F

echo.
echo ========================================================
echo    EXTRACTOR DE CLIENTES MIXNET v3  (solo lectura)
echo ========================================================
echo.
echo  Este script SOLO LEE. No modifica nada de MixNet.
echo  Siempre genera el CSV de clientes, y va buscando
echo  correos hasta 70% de cobertura (o 10 min maximo).
echo.

echo  Buscando Node.js...
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE=node"
  goto FOUND
)

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
if defined NODE goto FOUND

echo  No esta en rutas comunes. Buscando en C:\...
for /f "delims=" %%f in ('where /R "C:\" node.exe 2^>nul') do (
  set "NODE=%%f"
  goto FOUND
)

echo.
echo  ============================================
echo   [ERROR] No se encontro Node.js
echo  ============================================
echo.
pause
exit /b 1

:FOUND
echo  Node encontrado: %NODE%
echo.

:MENU
echo ========================================================
echo   QUE QUIERES HACER?
echo ========================================================
echo.
echo   1.  EXTRAER clientes (flujo completo, busca correos)
echo   2.  EXPLORAR primero (VER que hay en esta PC)
echo   3.  DIAGNOSTICAR una carpeta especifica
echo.
echo ========================================================
echo.

set /p "OPCION=Elige una opcion (1, 2 o 3): "

if "%OPCION%"=="1" goto EXTRAER
if "%OPCION%"=="2" goto EXPLORAR
if "%OPCION%"=="3" goto DIAGNOSTICO
echo  Opcion no valida. Elige 1, 2 o 3.
echo.
goto MENU

:EXTRAER
echo.
echo ========================================================
echo   EXTRAYENDO TODOS LOS CLIENTES...
echo ========================================================
echo.
echo  Objetivo de correos: 70%
echo  Tiempo maximo: 10 minutos (el CSV se va guardando solo)
echo  Puedes cerrar DESPUES de que diga "TERMINADO".
echo.
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set "DD=%%c%%a%%b"
for /f "tokens=1-2 delims=:" %%a in ('time /t') do set "HH=%%a%%b"
set "OUT=clientes_mixnet_%DD%_%HH%.csv"
echo  Archivo de salida: %OUT%
echo.
echo  Esto puede tardar varios minutos.
echo  NO cierres esta ventana. Espera a que diga "TERMINADO".
echo.
echo --------------------------------------------------------
echo.
"%NODE%" "%~dp0extraer-clientes-mixnet.cjs" --completo --out "%OUT%" --objetivo 70 --tiempo 600
goto FIN

:EXPLORAR
echo.
echo ========================================================
echo   EXPLORANDO QUE HAY EN ESTA PC...
echo ========================================================
echo.
echo  Esto puede tardar varios minutos.
echo.
"%NODE%" "%~dp0extraer-clientes-mixnet.cjs" --explorar --tiempo 120
goto FIN

:DIAGNOSTICO
echo.
echo  Escribe la ruta de la carpeta de MixNet.
echo  Ejemplo: M:\comp01
echo  (Si no sabes, elige opcion 2 "EXPLORAR" primero)
echo.
set /p "RUTA=Ruta: "
echo.
"%NODE%" "%~dp0extraer-clientes-mixnet.cjs" --diagnostico "%RUTA%"
goto FIN

:FIN
echo.
echo ========================================================
echo   PROCESO TERMINADO.
echo   Revisa tu ESCRITORIO para los archivos generados:
echo     - clientes_mixnet_*.csv        (clientes con correo)
echo     - clientes_sin_correo_*.csv    (faltan - captura manual)
echo     - resumen_mixnet_*.csv         (cobertura)
echo ========================================================
echo.
echo  Presiona cualquier tecla para cerrar...
pause >nul