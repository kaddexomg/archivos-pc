# ============================================================
#  RemoteBridge v2.0  -  Servidor para PC (Windows 11)
#  Pega este script completo en PowerShell y presiona Enter
#  NO necesita permisos de administrador
# ============================================================

$VERSION   = "2.0"
$PORT      = 8765
$SHARE_DIR = "$env:USERPROFILE\RemoteBridge\Archivos"
$LOG_FILE  = "$env:USERPROFILE\RemoteBridge\remotebrige.log"
$PIN       = "1234"   # <-- CAMBIA ESTE PIN antes de usar

# ── Colores y utilidades ─────────────────────────────────────
function Write-Log($msg, $color = "White") {
    $ts = Get-Date -Format "HH:mm:ss"
    $line = "[$ts] $msg"
    Write-Host $line -ForegroundColor $color
    try { Add-Content -Path $LOG_FILE -Value $line -ErrorAction SilentlyContinue } catch {}
}

function Write-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "  ██████╗ ███████╗███╗   ███╗ ██████╗ ████████╗███████╗" -ForegroundColor Cyan
    Write-Host "  ██╔══██╗██╔════╝████╗ ████║██╔═══██╗╚══██╔══╝██╔════╝" -ForegroundColor Cyan
    Write-Host "  ██████╔╝█████╗  ██╔████╔██║██║   ██║   ██║   █████╗  " -ForegroundColor Cyan
    Write-Host "  ██╔══██╗██╔══╝  ██║╚██╔╝██║██║   ██║   ██║   ██╔══╝  " -ForegroundColor Cyan
    Write-Host "  ██║  ██║███████╗██║ ╚═╝ ██║╚██████╔╝   ██║   ███████╗" -ForegroundColor Cyan
    Write-Host "  ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝    ╚═╝   ╚══════╝" -ForegroundColor Cyan
    Write-Host "  BRIDGE v$VERSION  -  PC: $env:COMPUTERNAME  -  Usuario: $env:USERNAME" -ForegroundColor DarkCyan
    Write-Host "  ─────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Verificar SSH disponible ──────────────────────────────────
function Test-SSH {
    try {
        $r = & ssh -V 2>&1
        return $true
    } catch {
        return $false
    }
}

# ── Preparar entorno ─────────────────────────────────────────
function Initialize-Environment {
    # Crear carpetas necesarias
    @($SHARE_DIR, (Split-Path $LOG_FILE)) | ForEach-Object {
        if (!(Test-Path $_)) {
            New-Item -ItemType Directory -Path $_ -Force | Out-Null
            Write-Log "Carpeta creada: $_" "Green"
        }
    }

    # Crear archivo de bienvenida si está vacía la carpeta
    $welcome = Join-Path $SHARE_DIR "LEEME.txt"
    if (!(Test-Path $welcome)) {
        Set-Content $welcome @"
RemoteBridge - Carpeta de archivos compartidos
==============================================
Los archivos que pongas aqui seran visibles desde tu Android.
Los archivos que subas desde el movil apareceran aqui.

Ruta completa: $SHARE_DIR
"@
    }
}

# ── Responder solicitudes HTTP ────────────────────────────────
function Send-Response($res, $body, $contentType = "application/json") {
    try {
        $res.Headers.Set("Content-Type", "$contentType; charset=utf-8")
        $res.Headers.Set("Access-Control-Allow-Origin", "*")
        $res.Headers.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $res.Headers.Set("Access-Control-Allow-Headers", "Content-Type, X-Filename, X-PIN")
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
    } catch { }
}

function Send-JsonOk($res, $data) {
    Send-Response $res ($data | ConvertTo-Json -Depth 5 -Compress)
}

function Send-JsonError($res, $msg, $code = 400) {
    $res.StatusCode = $code
    Send-Response $res "{`"error`":`"$msg`"}"
}

# ── Verificar PIN ─────────────────────────────────────────────
function Test-PIN($req) {
    $p = $req.Headers["X-PIN"]
    if (!$p) {
        # Intentar desde query string
        $qs = $req.QueryString["pin"]
        $p = $qs
    }
    return ($p -eq $PIN)
}

# ── Manejador principal de rutas ──────────────────────────────
function Handle-Request($ctx) {
    $req  = $ctx.Request
    $res  = $ctx.Response
    $path = $req.Url.AbsolutePath.TrimEnd('/')
    $method = $req.HttpMethod

    # CORS preflight
    if ($method -eq "OPTIONS") {
        Send-Response $res "" "text/plain"
        return
    }

    # Ruta publica: ping (sin PIN)
    if ($path -eq "/ping") {
        Send-Response $res '{"alive":true}' "application/json"
        return
    }

    # Verificar PIN en todas las demas rutas
    if (!(Test-PIN $req)) {
        Send-JsonError $res "PIN incorrecto" 401
        Write-Log "Intento sin PIN valido desde $($req.RemoteEndPoint)" "Yellow"
        return
    }

    # ── /status ───────────────────────────────────────────────
    if ($path -eq "/status" -and $method -eq "GET") {
        $uptime = (Get-Date) - (Get-Process -Id $PID).StartTime
        $disk   = Get-PSDrive C | Select-Object -ExpandProperty Free
        $cpu    = (Get-WmiObject Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
        $mem    = Get-WmiObject Win32_OperatingSystem
        $memPct = [math]::Round((($mem.TotalVisibleMemorySize - $mem.FreePhysicalMemory) / $mem.TotalVisibleMemorySize) * 100)

        Send-JsonOk $res @{
            host      = $env:COMPUTERNAME
            user      = $env:USERNAME
            os        = (Get-WmiObject Win32_OperatingSystem).Caption
            uptime    = "$([math]::Round($uptime.TotalHours,1))h"
            cpu_pct   = $cpu
            ram_pct   = $memPct
            disk_free = "$([math]::Round($disk/1GB,1)) GB libres"
            time      = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            share_dir = $SHARE_DIR
        }
        Write-Log "GET /status" "DarkGray"
        return
    }

    # ── /clipboard/get ────────────────────────────────────────
    if ($path -eq "/clipboard/get" -and $method -eq "GET") {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            $text = [System.Windows.Forms.Clipboard]::GetText()
            Send-JsonOk $res @{ text = $text; length = $text.Length }
            Write-Log "GET /clipboard/get ($($text.Length) chars)" "DarkGray"
        } catch {
            Send-JsonError $res "No se pudo leer el portapapeles: $_"
        }
        return
    }

    # ── /clipboard/set ────────────────────────────────────────
    if ($path -eq "/clipboard/set" -and $method -eq "POST") {
        try {
            $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $body   = $reader.ReadToEnd() | ConvertFrom-Json
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Clipboard]::SetText($body.text)
            Send-JsonOk $res @{ ok = $true; length = $body.text.Length }
            Write-Log "POST /clipboard/set ($($body.text.Length) chars)" "Green"
        } catch {
            Send-JsonError $res "No se pudo escribir el portapapeles: $_"
        }
        return
    }

    # ── /files ────────────────────────────────────────────────
    if ($path -eq "/files" -and $method -eq "GET") {
        try {
            $files = Get-ChildItem $SHARE_DIR -File | ForEach-Object {
                @{
                    name     = $_.Name
                    size     = $_.Length
                    size_kb  = [math]::Round($_.Length / 1KB, 1)
                    modified = $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
                    ext      = $_.Extension.TrimStart('.')
                }
            }
            Send-JsonOk $res @{ files = @($files); count = $files.Count; dir = $SHARE_DIR }
            Write-Log "GET /files ($($files.Count) archivos)" "DarkGray"
        } catch {
            Send-JsonError $res "Error listando archivos: $_"
        }
        return
    }

    # ── /files/download ───────────────────────────────────────
    if ($path -like "/files/download/*" -and $method -eq "GET") {
        try {
            $fname = [System.Uri]::UnescapeDataString($path.Replace("/files/download/", ""))
            $fpath = Join-Path $SHARE_DIR $fname
            if (!(Test-Path $fpath)) {
                Send-JsonError $res "Archivo no encontrado: $fname" 404
                return
            }
            $bytes = [System.IO.File]::ReadAllBytes($fpath)
            $res.Headers.Set("Content-Type", "application/octet-stream")
            $res.Headers.Set("Content-Disposition", "attachment; filename=`"$fname`"")
            $res.Headers.Set("Access-Control-Allow-Origin", "*")
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            $res.OutputStream.Close()
            Write-Log "GET /files/download/$fname ($([math]::Round($bytes.Length/1KB,1)) KB)" "Green"
        } catch {
            Send-JsonError $res "Error descargando: $_"
        }
        return
    }

    # ── /files/upload ─────────────────────────────────────────
    if ($path -eq "/files/upload" -and $method -eq "POST") {
        try {
            $fname = $req.Headers["X-Filename"]
            if (!$fname) { Send-JsonError $res "Falta header X-Filename"; return }
            $fname  = [System.IO.Path]::GetFileName($fname)   # seguridad: solo nombre
            $fpath  = Join-Path $SHARE_DIR $fname
            $ms     = New-Object System.IO.MemoryStream
            $req.InputStream.CopyTo($ms)
            [System.IO.File]::WriteAllBytes($fpath, $ms.ToArray())
            Send-JsonOk $res @{ ok = $true; saved = $fname; size_kb = [math]::Round($ms.Length/1KB,1) }
            Write-Log "POST /files/upload $fname ($([math]::Round($ms.Length/1KB,1)) KB)" "Green"
        } catch {
            Send-JsonError $res "Error subiendo archivo: $_"
        }
        return
    }

    # ── /files/delete ─────────────────────────────────────────
    if ($path -like "/files/delete/*" -and $method -eq "DELETE") {
        try {
            $fname = [System.Uri]::UnescapeDataString($path.Replace("/files/delete/", ""))
            $fpath = Join-Path $SHARE_DIR $fname
            if (!(Test-Path $fpath)) { Send-JsonError $res "No encontrado" 404; return }
            Remove-Item $fpath -Force
            Send-JsonOk $res @{ ok = $true; deleted = $fname }
            Write-Log "DELETE /files/delete/$fname" "Yellow"
        } catch {
            Send-JsonError $res "Error borrando: $_"
        }
        return
    }

    # ── /cmd ─────────────────────────────────────────────────
    if ($path -eq "/cmd" -and $method -eq "POST") {
        try {
            $reader  = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $body    = $reader.ReadToEnd() | ConvertFrom-Json
            $command = $body.command
            if (!$command) { Send-JsonError $res "Falta campo 'command'"; return }

            Write-Log "CMD: $command" "Magenta"

            # Timeout de 15 segundos para comandos lentos
            $job    = Start-Job { param($c) Invoke-Expression $c 2>&1 | Out-String } -ArgumentList $command
            $done   = Wait-Job $job -Timeout 15
            if (!$done) {
                Stop-Job $job
                Send-JsonOk $res @{ output = "[TIMEOUT] El comando tardó más de 15 segundos y fue cancelado."; exit_code = -1 }
                return
            }
            $output = Receive-Job $job
            Remove-Job $job

            Send-JsonOk $res @{ output = $output.Trim(); exit_code = 0; command = $command }
        } catch {
            Send-JsonError $res "Error ejecutando comando: $_"
        }
        return
    }

    # ── /screenshot ───────────────────────────────────────────
    if ($path -eq "/screenshot" -and $method -eq "GET") {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing

            $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $bmp    = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
            $g      = [System.Drawing.Graphics]::FromImage($bmp)
            $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)

            # Reducir calidad para PCs lentas: max 1280px ancho
            $maxW = 1280
            if ($screen.Width -gt $maxW) {
                $ratio  = $maxW / $screen.Width
                $newH   = [int]($screen.Height * $ratio)
                $scaled = New-Object System.Drawing.Bitmap($maxW, $newH)
                $gs     = [System.Drawing.Graphics]::FromImage($scaled)
                $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $gs.DrawImage($bmp, 0, 0, $maxW, $newH)
                $gs.Dispose()
                $bmp.Dispose()
                $bmp = $scaled
            }

            $ms    = New-Object System.IO.MemoryStream
            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
            $ep    = New-Object System.Drawing.Imaging.EncoderParameters(1)
            $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
                [System.Drawing.Imaging.Encoder]::Quality, [long]60   # 60% calidad = menos datos
            )
            $bmp.Save($ms, $codec, $ep)

            $res.Headers.Set("Content-Type", "image/jpeg")
            $res.Headers.Set("Access-Control-Allow-Origin", "*")
            $bytes = $ms.ToArray()
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            $res.OutputStream.Close()

            $g.Dispose(); $bmp.Dispose(); $ms.Dispose()
            Write-Log "GET /screenshot ($([math]::Round($bytes.Length/1KB,0)) KB)" "DarkGray"
        } catch {
            Send-JsonError $res "Error capturando pantalla: $_"
        }
        return
    }

    # ── 404 ───────────────────────────────────────────────────
    Send-JsonError $res "Ruta no encontrada: $path" 404
}

# ── Bucle de reconexión del tunel SSH ─────────────────────────
function Start-Tunnel {
    param($RetryCount = 0)

    $maxRetries = 999   # reconecta indefinidamente
    $delay = [math]::Min(30, 5 + $RetryCount * 5)   # espera progresiva: 5s, 10s, 15s... max 30s

    Write-Log "Iniciando tunel SSH hacia serveo.net... (intento $($RetryCount+1))" "Cyan"

    # Puerto 443 para saltar firewalls corporativos
    $sshArgs = @(
        "-o", "StrictHostKeyChecking=no",
        "-o", "ServerAliveInterval=20",
        "-o", "ServerAliveCountMax=3",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ConnectTimeout=15",
        "-p", "443",
        "-R", "80:localhost:$PORT",
        "serveo.net"
    )

    try {
        $proc = Start-Process -FilePath "ssh" -ArgumentList $sshArgs `
            -RedirectStandardOutput "$env:TEMP\rb_tunnel_out.txt" `
            -RedirectStandardError  "$env:TEMP\rb_tunnel_err.txt" `
            -PassThru -WindowStyle Hidden

        # Esperar salida del tunel (la URL aparece en stderr de SSH)
        $deadline = (Get-Date).AddSeconds(20)
        $url = $null
        while ((Get-Date) -lt $deadline -and !$url) {
            Start-Sleep -Milliseconds 500
            if (Test-Path "$env:TEMP\rb_tunnel_err.txt") {
                $content = Get-Content "$env:TEMP\rb_tunnel_err.txt" -Raw -ErrorAction SilentlyContinue
                if ($content -match "https?://([a-z0-9\-]+\.serveo\.net)") {
                    $url = $matches[0]
                }
            }
        }

        if ($url) {
            Write-Log "" "White"
            Write-Host "  ┌─────────────────────────────────────────────────┐" -ForegroundColor Green
            Write-Host "  │  TUNEL ACTIVO                                   │" -ForegroundColor Green
            Write-Host "  │  URL: $url" -ForegroundColor Yellow
            Write-Host "  │  Copia esta URL en tu app Android               │" -ForegroundColor Green
            Write-Host "  └─────────────────────────────────────────────────┘" -ForegroundColor Green
            Write-Log "" "White"
            Write-Log "PIN de acceso: $PIN  (cambialo en la linea 14 del script)" "Yellow"
            return $proc
        } else {
            Write-Log "No se obtuvo URL del tunel. Revisando error..." "Yellow"
            if (Test-Path "$env:TEMP\rb_tunnel_err.txt") {
                $err = Get-Content "$env:TEMP\rb_tunnel_err.txt" -Raw -ErrorAction SilentlyContinue
                if ($err) { Write-Log "SSH dice: $($err.Trim())" "Red" }
            }
            $proc.Kill()
            return $null
        }
    } catch {
        Write-Log "Error iniciando SSH: $_" "Red"
        return $null
    }
}

# ════════════════════════════════════════════════════════════
#  INICIO
# ════════════════════════════════════════════════════════════
Write-Banner

# Verificar SSH
if (!(Test-SSH)) {
    Write-Log "ERROR: SSH no esta disponible en este equipo." "Red"
    Write-Log "Solucion: Ve a Configuracion > Aplicaciones > Caracteristicas opcionales > Agregar: Cliente SSH de OpenSSH" "Yellow"
    Read-Host "Presiona Enter para salir"
    exit 1
}

Initialize-Environment
Write-Log "Carpeta de archivos: $SHARE_DIR" "Green"
Write-Log "Puerto local: $PORT" "Green"
Write-Log "PIN configurado: $PIN" "Yellow"

# Iniciar servidor HTTP
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$PORT/")
try {
    $listener.Start()
    Write-Log "Servidor HTTP activo en puerto $PORT" "Green"
} catch {
    Write-Log "ERROR iniciando servidor HTTP: $_" "Red"
    Write-Log "Posible causa: otro proceso usa el puerto $PORT" "Yellow"
    Write-Log "Solucion: cambia la variable `$PORT al inicio del script" "Yellow"
    Read-Host "Presiona Enter para salir"
    exit 1
}

# Iniciar tunel
$tunnelProc = Start-Tunnel
$tunnelRetries = 0

if (!$tunnelProc) {
    Write-Log "No se pudo conectar el tunel. Reintentando en 10 segundos..." "Yellow"
}

Write-Log "" "White"
Write-Log "Presiona Ctrl+C para detener RemoteBridge" "DarkGray"
Write-Log "" "White"

# ── Bucle principal ────────────────────────────────────────────
$lastTunnelCheck = Get-Date
$requestCount    = 0

try {
    while ($true) {
        # Manejar request HTTP con timeout de 2 segundos
        $asyncResult = $listener.BeginGetContext($null, $null)
        $gotRequest  = $asyncResult.AsyncWaitHandle.WaitOne(2000)

        if ($gotRequest) {
            try {
                $ctx = $listener.EndGetContext($asyncResult)
                $requestCount++
                Handle-Request $ctx
            } catch {
                Write-Log "Error en request: $_" "Red"
            }
        }

        # Verificar salud del tunel cada 30 segundos
        if (((Get-Date) - $lastTunnelCheck).TotalSeconds -gt 30) {
            $lastTunnelCheck = Get-Date
            $tunnelAlive = $tunnelProc -and !$tunnelProc.HasExited

            if (!$tunnelAlive) {
                $tunnelRetries++
                $delay = [math]::Min(30, 5 + $tunnelRetries * 5)
                Write-Log "Tunel caido. Reconectando en ${delay}s... (intento $tunnelRetries)" "Yellow"
                Start-Sleep $delay

                if ($tunnelProc) { try { $tunnelProc.Kill() } catch {} }
                $tunnelProc = Start-Tunnel -RetryCount $tunnelRetries

                if ($tunnelProc) {
                    $tunnelRetries = 0
                    Write-Log "Tunel reconectado!" "Green"
                }
            }
        }
    }
} finally {
    # Limpieza al salir
    Write-Log "Deteniendo RemoteBridge..." "Yellow"
    $listener.Stop()
    if ($tunnelProc -and !$tunnelProc.HasExited) {
        $tunnelProc.Kill()
    }
    Write-Log "RemoteBridge detenido. Total requests atendidos: $requestCount" "Cyan"
}
