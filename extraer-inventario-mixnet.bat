@echo off
chcp 65001 >nul 2>nul
title JJ Paper - Extraer INVENTARIO de MixNet
color 0F

echo.
echo ========================================================
echo    EXTRACTOR DE INVENTARIO MIXNET  (solo lectura)
echo ========================================================
echo.
echo  Este script SOLO LEE. No modifica nada de MixNet.
echo  Auto-detecta tablas de artículos, precios, stock,
echo  familias y proveedores por nombre de campo.
echo.

REM Buscar Node.js
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
echo   1.  EXTRAER inventario (flujo completo, busca precios/stock)
echo   2.  EXPLORAR primero (VER qué tablas de inventario hay)
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
echo   EXTRAYENDO INVENTARIO...
echo ========================================================
echo.
echo  Esto buscara tablas de artículos/precios/stock en
echo  todas las unidades. El CSV se genera de inmediato
echo  y se va enriqueciendo cada ronda (hasta 85% o 10 min).
echo.
echo  NO cierres esta ventana. Espera a que diga "TERMINADO".
echo.
echo --------------------------------------------------------
echo.
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set "DD=%%c%%a%%b"
for /f "tokens=1-2 delims=:" %%a in ('time /t') do set "HH=%%a%%b"
set "OUT=inventario_mixnet_%DD%_%HH%.csv"
echo  Archivo de salida: %OUT%
echo.
"%NODE%" "%~dp0extraer-inventario-mixnet.cjs" --completo --out "%OUT%" --objetivo 85 --tiempo 600
goto FIN

:EXPLORAR
echo.
echo ========================================================
echo   EXPLORANDO TABLAS DE INVENTARIO...
echo ========================================================
echo.
echo  Esto puede tardar varios minutos.
echo.
"%NODE%" "%~dp0extraer-inventario-mixnet.cjs" --explorar --tiempo 120
goto FIN

:DIAGNOSTICO
echo.
echo  Escribe la ruta de la carpeta de MixNet.
echo  Ejemplo: M:\comp01
echo  (Si no sabes, elige opcion 2 "EXPLORAR" primero)
echo.
set /p "RUTA=Ruta: "
echo.
"%NODE%" "%~dp0extraer-inventario-mixnet.cjs" --diagnostico "%RUTA%"
goto FIN

:FIN
echo.
echo ========================================================
echo   PROCESO TERMINADO.
echo   Revisa tu ESCRITORIO para los archivos generados:
echo     - inventario_mixnet_*.csv        (inventario completo)
echo     - inventario_sin_precio_*.csv    (sin precio)
echo     - resumen_inventario_*.csv       (cobertura)
echo     - exploracion_inventario_*.csv   (tablas encontradas)
echo ========================================================
echo.
echo  Presiona cualquier tecla para cerrar...
pause >nul