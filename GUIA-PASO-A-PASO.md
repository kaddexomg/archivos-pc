# RemoteBridge — Guía Completa de Instalación y Uso

## Qué incluye este sistema

| Archivo | Para qué |
|---|---|
| `RemoteBridge-PC.ps1` | Script que ejecutas en la PC del trabajo |
| `RemoteBridge-Android.html` | App que abres en tu Android |

---

## PARTE 1 — Configurar la PC (solo la primera vez)

### Paso 1 — Verificar que SSH esté disponible

1. Presiona **Win + R**, escribe `powershell` y presiona Enter
2. Escribe este comando y presiona Enter:
   ```
   ssh -V
   ```
3. Si ves algo como `OpenSSH_8.x` → **listo, continúa al paso 2**
4. Si ves un error → lee la sección "Error: SSH no disponible" más abajo

---

### Paso 2 — Cambiar el PIN (importante)

Abre el archivo `RemoteBridge-PC.ps1` con el Bloc de notas.
En la **línea 14** verás:
```
$PIN = "1234"
```
Cámbialo por un PIN tuyo, por ejemplo:
```
$PIN = "mipin2025"
```
Guarda el archivo.

---

### Paso 3 — Ejecutar el script

1. Abre PowerShell (Win + R → `powershell`)
2. Navega a donde guardaste el script. Por ejemplo:
   ```
   cd C:\Users\TU_USUARIO\Downloads
   ```
3. Ejecuta el script:
   ```
   powershell -ExecutionPolicy Bypass -File RemoteBridge-PC.ps1
   ```
4. Si ves un mensaje de política de ejecución, escribe `S` y presiona Enter.

---

### Paso 4 — Leer la URL del túnel

Cuando el script esté activo, verás algo así en la pantalla:

```
┌─────────────────────────────────────────────────┐
│  TUNEL ACTIVO                                   │
│  URL: https://abc123xyz.serveo.net              │
│  Copia esta URL en tu app Android               │
└─────────────────────────────────────────────────┘
```

**Copia esa URL** — la necesitas en el siguiente paso.
> ⚠️ La URL cambia cada vez que reinicias el script.

---

## PARTE 2 — Configurar el Android (solo la primera vez)

### Paso 1 — Abrir la app

1. Pasa el archivo `RemoteBridge-Android.html` a tu teléfono
   - Por WhatsApp, Telegram, email, cable USB, o Google Drive
2. Abre el archivo con **Chrome** en tu Android
3. En Chrome, toca el menú (los 3 puntos) → **Añadir a pantalla de inicio**
   - Así tendrás un ícono directo como si fuera una app

### Paso 2 — Conectar con la PC

1. Al abrir la app verás la pantalla de configuración
2. En **URL del servidor** pega la URL que viste en la PC: `https://abc123xyz.serveo.net`
3. En **PIN de acceso** escribe el PIN que pusiste en el script
4. Toca **Conectar**

---

## PARTE 3 — Uso diario

### Rutina de cada día

1. En la PC: abre PowerShell y ejecuta el script
2. Espera a ver la URL en pantalla
3. En el Android: abre RemoteBridge, ve a **Ajustes** (⚙) y actualiza la URL
4. Listo

---

### Funciones disponibles

#### Pestaña "Estado"
Muestra información en tiempo real de la PC: nombre del equipo, usuario, tiempo activo, espacio en disco, uso de CPU y RAM.

#### Pestaña "Texto" (Portapapeles)
- **Leer portapapeles de la PC**: ver qué hay copiado en la PC ahora mismo
- **Enviar texto a la PC**: escribe en el móvil y aparece en el portapapeles de la PC (ya puedes hacer Ctrl+V)

#### Pestaña "Archivos"
- **Subir archivo**: manda un archivo del móvil a la PC. Queda en `C:\Users\TU_USUARIO\RemoteBridge\Archivos\`
- **Descargar archivo**: descarga al móvil cualquier archivo que pongas en esa carpeta desde la PC
- Para pasar algo de la PC al móvil: copia el archivo manualmente a la carpeta `RemoteBridge\Archivos` en la PC, y luego descárgalo desde la app

#### Pestaña "Terminal"
Ejecuta comandos PowerShell desde el móvil. Tiene comandos rápidos de acceso directo.
> ⚠️ Úsala con cuidado — los comandos se ejecutan realmente en la PC

#### Pestaña "Pantalla"
- **Capturar pantalla**: toma una foto de lo que hay en la pantalla de la PC en este momento
- **Botón ⏱**: activa capturas automáticas cada 10 segundos (para monitoreo)
- Toca la imagen para verla en pantalla completa

---

## PARTE 4 — Solución de errores frecuentes

### Error: "SSH no está disponible"

**Causa**: el cliente SSH de OpenSSH no está activado en Windows.

**Solución**:
1. Ve a **Configuración → Aplicaciones → Características opcionales**
2. Busca **"Cliente OpenSSH"**
3. Si no está instalado, haz clic en **Agregar una característica** y búscalo
4. Instala y reinicia PowerShell

---

### Error: "No se obtuvo URL del túnel"

**Posibles causas y soluciones**:

**A) El firewall corporativo bloquea SSH**
El script ya usa el puerto 443 (HTTPS) que casi nunca está bloqueado. Si aun así falla:
1. Prueba este comando alternativo en PowerShell para diagnosticar:
   ```
   Test-NetConnection serveo.net -Port 443
   ```
2. Si dice "TcpTestSucceeded: False" → el firewall bloquea serveo.net
3. Solución alternativa: usa `localhost.run` — cambia en el script la línea del túnel SSH:
   ```powershell
   # Reemplaza "serveo.net" por:
   "-R", "80:localhost:$PORT", "localhost.run"
   ```

**B) El servicio SSH no inicia**
Ejecuta en PowerShell como administrador (si puedes):
```
Start-Service ssh-agent
```

---

### Error: "La PC tardó mucho en responder"

**Causa**: PC lenta, datos móviles inestables, o la PC está ocupada.

**Soluciones**:
- El script de la PC ya tiene timeout de 15 segundos para comandos
- Las capturas de pantalla se comprimen al 60% de calidad para ahorrar datos
- Si el problema persiste, espera unos segundos y vuelve a intentar
- Evita ejecutar comandos pesados (por ejemplo, en horas pico de trabajo)

---

### Error: "PIN incorrecto"

1. Verifica que el PIN en la app Android sea exactamente igual al que pusiste en `$PIN` en el script
2. El PIN distingue mayúsculas y minúsculas
3. Toca ⚙ en la app y corrígelo

---

### La URL cambia cada vez que reinicio el script

Esto es normal. Para tener siempre la misma URL, modifica la línea del túnel SSH en el script:

```powershell
# Línea actual (URL aleatoria):
"-R", "80:localhost:$PORT", "serveo.net"

# Reemplaza por (URL fija con tu subdominio elegido):
"-R", "mipc-trabajo:80:localhost:$PORT", "serveo.net"
```

Así tu URL siempre será `https://mipc-trabajo.serveo.net`

> Nota: el subdominio solo funciona si no lo está usando nadie más en serveo.net

---

### El túnel se desconecta solo

- El script reconecta automáticamente — espera hasta 30 segundos
- Verás el mensaje "Reconectando..." en la app del móvil
- Si pasa muy seguido, puede ser que la red corporativa cierra conexiones SSH inactivas
- El script ya envía "keepalives" cada 20 segundos para evitarlo

---

### No puedo pasar el archivo .html al móvil

Opciones que no requieren instalar nada:
1. **WhatsApp Web**: ábrelo en la PC, envíate el archivo por tu propio chat
2. **Telegram**: envíate el archivo por "Mensajes guardados"
3. **Gmail**: envíatelo como adjunto
4. **Google Drive / OneDrive**: súbelo desde la PC, descárgalo en el móvil
5. **Cable USB**: conéctalo y cópialo manualmente

---

## PARTE 5 — Seguridad y recomendaciones

- **Cambia el PIN** por defecto `1234` antes de usar
- El túnel SSH está cifrado de extremo a extremo
- La app solo expone los archivos en la carpeta `RemoteBridge\Archivos`
- Cuando no uses el sistema, cierra el script con **Ctrl+C** en PowerShell
- No compartas la URL del túnel con nadie
- Para máxima seguridad, usa un PIN largo con letras y números

---

## Estructura de archivos en la PC

```
C:\Users\TU_USUARIO\
└── RemoteBridge\
    ├── Archivos\          ← carpeta de intercambio (pón aquí lo que quieres bajar al móvil)
    │   └── LEEME.txt
    └── remotebrige.log    ← log de actividad (útil para diagnosticar)
```

---

*RemoteBridge v2.0 — Construido para Windows 11 + Android*
