@echo off
chcp 65001 >nul 2>nul
title JJ PAPER - Inspector y Extractor Consciente MixNet v4.0
color 0A

echo.
echo ======================================================================
echo    JJ PAPER -- INSPECTOR Y EXTRACTOR CONSCIENTE MIXNET v4.0
echo ======================================================================
echo.
echo   Este programa ejecuta la extracción limpia y consciente de MixNet:
echo     [1] Conecta a M:\comp01 o a la IP del servidor 192.168.0.185.
echo     [2] Audita y compara tablas (MXCTAINV vs VICTAINV).
echo     [3] Muestra PRECIOS EN PANTALLA para que confirmes antes de extraer.
echo     [4] Extrae productos con precios reales y existencias reales.
echo     [5] Extrae clientes con RIF limpio, teléfonos, dirección y email.
echo.
echo   SOLO LECTURA: No modifica nada de MixNet ni de la base de datos.
echo.
echo ======================================================================
echo.

echo  Verificando Node.js en esta computadora...
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
  "C:\nodejs\node.exe"
  "C:\node\node.exe"
  "C:\Program Files\nodejs\node.exe"
  "C:\Program Files (x86)\nodejs\node.exe"
  "D:\nodejs\node.exe"
  "D:\node\node.exe"
  "D:\Program Files\nodejs\node.exe"
) do (
  if exist %%p set "NODE=%%~p"
)
if defined NODE goto FOUND

echo  Buscando node.exe en el disco C:\...
for /f "delims=" %%f in ('where /R "C:\" node.exe 2^>nul') do (
  set "NODE=%%f"
  goto FOUND
)

echo.
echo  ==================================================================
echo   [ERROR] No se encontró Node.js en esta PC.
echo   Por favor instala Node.js (versión 13 o superior) para ejecutar.
echo  ==================================================================
echo.
pause
exit /b 1

:FOUND
echo  Node.js detectado: %NODE%
echo.
echo ----------------------------------------------------------------------
echo  Iniciando flujo de inspección y extracción...
echo ----------------------------------------------------------------------
echo.

"%NODE%" "%~dp0extraer-todo-mixnet.cjs"

echo.
echo ======================================================================
echo   FIN DEL PROCESO.
echo   Revisa tu Escritorio para encontrar los archivos:
echo     - mixnet_productos_reales_*.csv  (Catálogo con precios reales)
echo     - mixnet_clientes_reales_*.csv   (Clientes con email y teléfonos)
echo     - mixnet_payload_supabase_*.json (Archivo listo para Supabase)
echo ======================================================================
echo.
echo  Presiona cualquier tecla para cerrar esta ventana...
pause >nul
