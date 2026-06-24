# ============================================
# ACTIVAR ICS (Internet Connection Sharing)
# Sin instalar nada - Solo APIs nativas Windows
# Ejecutar: clic derecho → "Ejecutar con PowerShell"
# ============================================

Write-Host "=== DIAGNOSTICO DE RED ===" -ForegroundColor Cyan

# --- Ver todos los adaptadores ---
Write-Host "`n[Adaptadores de red detectados:]" -ForegroundColor Yellow
Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, MacAddress | Format-Table -AutoSize

# --- Buscar el teléfono ---
Write-Host "`n[Buscando telefono Android/RNDIS:]" -ForegroundColor Yellow
$phone = Get-NetAdapter | Where-Object {
    $_.InterfaceDescription -like "*RNDIS*" -or
    $_.InterfaceDescription -like "*Android*" -or
    $_.InterfaceDescription -like "*Remote*" -or
    $_.Name -like "*USB*"
}

if ($phone) {
    Write-Host "TELEFONO DETECTADO: $($phone.Name) - $($phone.InterfaceDescription)" -ForegroundColor Green
    $phoneAdapter = $phone.Name
} else {
    Write-Host "Telefono NO detectado aun. Conecta el cable y activa 'Anclaje USB' en Android." -ForegroundColor Red
    Write-Host "Luego vuelve a ejecutar este script." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit
}

# --- Buscar la conexión con internet (Ethernet) ---
Write-Host "`n[Buscando adaptador con internet (Ethernet):]" -ForegroundColor Yellow
$internet = Get-NetAdapter | Where-Object {
    ($_.Status -eq "Up") -and
    ($_.InterfaceDescription -notlike "*RNDIS*") -and
    ($_.InterfaceDescription -notlike "*Android*") -and
    ($_.InterfaceDescription -notlike "*Virtual*") -and
    ($_.InterfaceDescription -notlike "*Loopback*")
} | Select-Object -First 1

if ($internet) {
    Write-Host "ADAPTADOR INTERNET: $($internet.Name) - $($internet.InterfaceDescription)" -ForegroundColor Green
} else {
    Write-Host "No se detecto adaptador con internet activo." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit
}

# --- Activar ICS via API COM nativa de Windows ---
Write-Host "`n=== ACTIVANDO ICS ===" -ForegroundColor Cyan
Write-Host "Adaptador origen (internet): $($internet.Name)"
Write-Host "Adaptador destino (telefono): $($phoneAdapter)"

try {
    # Usar la API COM de Windows (INetSharingManager) - nativa, sin instalar nada
    $netShare = New-Object -ComObject HNetCfg.HNetShare

    # Obtener todas las conexiones
    $connections = $netShare.EnumEveryConnection

    $srcConn = $null
    $dstConn = $null

    foreach ($conn in $connections) {
        $props = $netShare.NetConnectionProps($conn)
        Write-Host "  Encontrado: $($props.Name)" -ForegroundColor DarkGray
        if ($props.Name -eq $internet.Name) { $srcConn = $conn }
        if ($props.Name -eq $phoneAdapter)  { $dstConn = $conn }
    }

    if ($srcConn -and $dstConn) {
        # Obtener configuracion ICS de cada adaptador
        $srcConfig = $netShare.INetSharingConfigurationForINetConnection($srcConn)
        $dstConfig = $netShare.INetSharingConfigurationForINetConnection($dstConn)

        # Desactivar ICS previo si existia
        $srcConfig.DisableSharing()
        $dstConfig.DisableSharing()

        # Activar: origen = publico (SHARINGCONNECTIONTYPE_HNET_PUBLIC = 0)
        #           destino = privado (SHARINGCONNECTIONTYPE_HNET_PRIVATE = 1)
        $srcConfig.EnableSharing(0)
        $dstConfig.EnableSharing(1)

        Write-Host "`n ICS ACTIVADO CORRECTAMENTE" -ForegroundColor Green
        Write-Host " El telefono deberia recibir internet en unos segundos." -ForegroundColor Green
        Write-Host " Si no conecta, desactiva y reactiva 'Anclaje USB' en el telefono." -ForegroundColor Yellow
    } else {
        Write-Host "`nNo se pudieron mapear los adaptadores correctamente." -ForegroundColor Red
        Write-Host "Adaptadores encontrados por COM:" -ForegroundColor Yellow
        foreach ($conn in $connections) {
            $p = $netShare.NetConnectionProps($conn)
            Write-Host "  - '$($p.Name)'" -ForegroundColor DarkGray
        }
        Write-Host "`nEjecuta el script CMD primero para ver los nombres exactos." -ForegroundColor Yellow
    }
} catch {
    Write-Host "`nError al acceder a ICS: $_" -ForegroundColor Red
    Write-Host "Posiblemente se requieren permisos de administrador para esta operacion." -ForegroundColor Yellow
    Write-Host "`nAlternativa manual:" -ForegroundColor Cyan
    Write-Host "Panel de control > Redes > clic derecho en Ethernet > Propiedades > Uso compartido"
}

Write-Host ""
Read-Host "Presiona Enter para salir"
