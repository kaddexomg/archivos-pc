@echo off
chcp 65001 >nul 2>nul
title JJ Paper - Extraer TODO de MixNet
color 0F

echo.
echo ========================================================
echo    EXTRACTOR TOTAL MIXNET  (solo lectura)
echo ========================================================
echo.
echo  Este script SOLO LEE. No modifica nada de MixNet.
echo  Captura TODA la informacion util:
echo    [A] INVENTARIO/CATALOGO  (codigo, nombre real,
echo        descripcion, precio, existencia, familia,
echo        proveedor)
echo    [B] CLIENTES             (razon social, RIF,
echo        direccion, tel, vendedor, zona, saldo,
echo        limite de credito)
echo    [C] TABLAS MAESTRAS      (vendedores, familias,
echo        proveedores, bancos)
echo.
echo  Objetivo: que los productos del catalogo JJ coincidan
echo  con los productos REALES de MixNet por codigo de
echo  inventario, nombre real, precio real y existencia.
echo.
echo  Auto-detecta las unidades y las tablas por nombre de
echo  campo. NO depende de conocer la ruta.
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
echo   1.  EXTRAER TODO (inventario + clientes + maestras)
echo   2.  EXPLORAR primero (VER que tablas hay)
echo   3.  DIAGNOSTICAR una carpeta especifica
echo   4.  VER esquema de un archivo DBF
echo.
echo ========================================================
echo.

set /p "OPCION=Elige una opcion (1, 2, 3 o 4): "

if "%OPCION%"=="1" goto EXTRAER
if "%OPCION%"=="2" goto EXPLORAR
if "%OPCION%"=="3" goto DIAGNOSTICO
if "%OPCION%"=="4" goto ESQUEMA
echo  Opcion no valida. Elige 1, 2, 3 o 4.
echo.
goto MENU

:EXTRAER
echo.
echo ========================================================
echo   EXTRAYENDO TODO...
echo ========================================================
echo.
echo  Detectara las unidades y escaneara buscando tablas
echo  de inventario, clientes y maestras. El CSV se genera
echo  de inmediato y se va enriqueciendo por rondas.
echo.
echo  NO cierres esta ventana. Espera a que diga TERMINADO.
echo.
echo --------------------------------------------------------
echo.

set /p "MIN=Minutos de escaneo (deja en blanco = 15): "
if "%MIN%"=="" set "MIN=15"
set /a "SEG=%MIN%*60"

echo  Escaneando durante %MIN% minutos (presupuesto)...
echo  El archivo se guarda al final en C: y en tu escritorio.
echo.
"%NODE%" "%~dp0extraer-todo-mixnet.cjs" --tiempo %SEG%
goto FIN

:EXPLORAR
echo.
echo ========================================================
echo   EXPLORANDO TABLAS DE MIXNET...
echo ========================================================
echo.
echo  Esto puede tardar varios minutos. Mostrara que tablas
echo  hay, que tipo son y que campos tienen.
echo.
"%NODE%" "%~dp0extraer-todo-mixnet.cjs" --explorar --tiempo 180
goto FIN

:DIAGNOSTICO
echo.
echo  Escribe la ruta de la carpeta de MixNet.
echo  Ejemplo: M:\comp01
echo  (Si no sabes, elige opcion 2 "EXPLORAR" primero)
echo.
set /p "RUTA=Ruta: "
echo.
"%NODE%" "%~dp0extraer-todo-mixnet.cjs" --diagnostico "%RUTA%"
goto FIN

:ESQUEMA
echo.
echo  Escribe la ruta completa de un archivo DBF.
echo  Ejemplo: M:\comp01\MXARTIC.DBF
echo.
set /p "ARCH=Ruta del .DBF: "
echo.
"%NODE%" "%~dp0extraer-todo-mixnet.cjs" --esquema "%ARCH%"
goto FIN

:FIN
echo.
echo ========================================================
echo   PROCESO TERMINADO.
echo   Revisa tu ESCRITORIO y la CARPETA DE ESTE SCRIPT (C:)
echo   para los archivos generados:
echo     - mixnet_inventario_*.csv      (productos)
echo     - mixnet_clientes_*.csv        (clientes)
echo     - mixnet_ventas_*.csv          (movimientos/ventas)
echo     - mixnet_*_*.csv               (resto de tipos)
echo     - exploracion_todo_*.csv       (que tablas hay)
echo     - resumen_todo_*.csv           (resumen)
echo ========================================================
echo.
echo  Presiona cualquier tecla para cerrar...
pause >nul
