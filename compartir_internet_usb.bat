@echo off
chcp 65001 >nul
title Compartir Internet PC → Teléfono via USB

echo ============================================
echo  PASO 1: DIAGNÓSTICO DE ADAPTADORES DE RED
echo ============================================
echo.
echo [Adaptadores disponibles en el sistema:]
netsh interface show interface
echo.
echo [IPs asignadas a cada adaptador:]
netsh interface ipv4 show interfaces
echo.

echo ============================================
echo  PASO 2: DETECTAR TELEFONO USB (RNDIS)
echo ============================================
echo.
echo [Buscando dispositivo RNDIS del telefono...]
wmic path Win32_NetworkAdapter where "Name like '%%RNDIS%%' or Name like '%%Android%%' or Name like '%%Remote%%'" get Name, NetConnectionID, NetEnabled
echo.

echo ============================================
echo  PASO 3: INTENTAR ACTIVAR ICS VIA NETSH
echo ============================================
echo.
echo [Intentando habilitar red hospedada (no requiere admin en algunos equipos)...]
netsh wlan show hostednetwork
echo.

echo ============================================
echo  RESULTADO: LEE ESTO
echo ============================================
echo.
echo Si ves "RNDIS" o "Android" en PASO 2: el driver ya existe,
echo solo falta activar el uso compartido desde Panel de Control.
echo.
echo Si NO ves nada en PASO 2: el telefono no fue reconocido.
echo Soluciones sin instalar:
echo  1. Cambia el modo USB del telefono a "Transferencia de archivos"
echo  2. Conecta y desconecta el cable 2-3 veces
echo  3. Prueba otro puerto USB del PC
echo.
pause
