# Scripts de Actualización

Esta carpeta contiene scripts para actualizar la versión y la aplicación Tauri Music App en diferentes plataformas.

## Estructura

```
script/
├── bash/              # Scripts para Linux/macOS
│   ├── update_tauri_app.sh      # Instala/actualiza desde el .deb
│   └── update_version.sh         # Actualiza el número de versión
└── powershell/         # Scripts para Windows
    ├── update_tauri_app.ps1     # Instala/actualiza desde el .msi
    └── update_version.ps1        # Actualiza el número de versión
```

---

## Scripts Bash (Linux/macOS)

### update_version.sh

Actualiza el número de versión en los archivos de configuración del proyecto.

**Uso:**
```bash
./script/bash/update_version.sh <versión>
```

**Ejemplo:**
```bash
./script/bash/update_version.sh 1.1.0
```

**Qué hace:**
- Actualiza `package.json`
- Actualiza `src-tauri/Cargo.toml`
- Actualiza `src-tauri/tauri.conf.json`

**Nota:** La versión debe seguir el formato `X.Y.Z` (ej: `1.0.0`, `1.1.0`, `2.0.5`)

---

### update_tauri_app.sh

Instala o actualiza la aplicación desde el archivo .deb generado por Tauri.

**Uso:**
```bash
sudo ./script/bash/update_tauri_app.sh
```

**Requisitos:**
- Haber generado el .deb con `npm run tauri build`
- Permisos de administrador (sudo)

**Qué hace:**
1. Busca el archivo .deb más reciente en `src-tauri/target/release/bundle/deb/`
2. Lo instala con `dpkg -i`
3. Corrige dependencias con `apt-get install -f` si es necesario
4. Muestra la versión del paquete instalado

---

## Scripts PowerShell (Windows)

### update_version.ps1

Actualiza el número de versión en los archivos de configuración del proyecto.

**Uso:**
```powershell
.\script\powershell\update_version.ps1 -Version "1.1.0"
```

**Ejemplo:**
```powershell
.\script\powershell\update_version.ps1 -Version "1.1.0"
```

**Qué hace:**
- Actualiza `package.json`
- Actualiza `src-tauri/Cargo.toml`
- Actualiza `src-tauri/tauri.conf.json`

**Nota:** La versión debe seguir el formato `X.Y.Z` (ej: `1.0.0`, `1.1.0`, `2.0.5`)

**Requisitos:**
- PowerShell 5.1 o superior

---

### update_tauri_app.ps1

Instala o actualiza la aplicación desde el archivo .msi generado por Tauri.

**Uso:**
```powershell
.\script\powershell\update_tauri_app.ps1
```

**Requisitos:**
- Haber generado el .msi con `npm run tauri build`
- Permisos de administrador
- Ejecutar PowerShell como administrador

**Qué hace:**
1. Busca el archivo .msi más reciente en `src-tauri/target/release/bundle/msi/`
2. Desinstala la versión anterior si existe
3. Instala el nuevo .msi con `msiexec /i /qn /norestart`
4. Muestra la versión del paquete instalado
5. Si es necesario reiniciar, pregunta al usuario

**Notas importantes para Windows:**
- Tauri genera archivos .msi para Windows, no .deb
- El nombre del archivo .msi sigue el formato: `Tauri Music App_<versión>_x64.msi`
- Si el código de salida es 3010, se requiere reiniciar para completar la instalación

---

## Flujo de trabajo completo

### Para Linux/macOS:

1. **Actualizar la versión:**
   ```bash
   ./script/bash/update_version.sh 1.1.0
   ```

2. **Generar el .deb:**
   ```bash
   cd /home/hotsechu/Projects/tauri-music-app
   npm run tauri build
   ```

3. **Instalar/actualizar:**
   ```bash
   sudo ./script/bash/update_tauri_app.sh
   ```

### Para Windows:

1. **Actualizar la versión:**
   ```powershell
   .\script\powershell\update_version.ps1 -Version "1.1.0"
   ```

2. **Generar el .msi:**
   ```powershell
   cd C:\Projects\tauri-music-app
   npm run tauri build
   ```

3. **Instalar/actualizar (como administrador):**
   ```powershell
   .\script\powershell\update_tauri_app.ps1
   ```

---

## Solución de problemas

### Linux/macOS:

- **Error: No se encontró ningún archivo .deb**
  - Asegúrate de haber ejecutado `npm run tauri build`
  - Verifica que el build se completó correctamente
  - Revisa que la carpeta `src-tauri/target/release/bundle/deb/` exista

- **Error: Problemas de dependencias**
  - El script intenta corregirlos automáticamente con `apt-get install -f -y`
  - Si persiste, ejecuta manualmente: `sudo apt-get install -f`

### Windows:

- **Error: No se encontró el directorio .msi**
  - Asegúrate de estar construyendo para Windows
  - Verifica que Tauri esté configurado para generar .msi
  - Revisa que la carpeta `src-tauri/target/release/bundle/msi/` exista

- **Error: Se requiere administrador**
  - Ejecuta PowerShell como administrador
  - O ejecuta: `Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File update_tauri_app.ps1"`

- **Error: El script no se ejecuta**
  - Asegúrate de que la política de ejecución permita scripts:
    ```powershell
    Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
    ```
  - O ejecuta con:
    ```powershell
    powershell -ExecutionPolicy Bypass -File update_tauri_app.ps1
    ```

---

## Notas técnicas

### Para update_version.ps1:
- Usa expresiones regulares para encontrar y reemplazar el número de versión
- Soporta formatos JSON y TOML
- Valida que la versión siga el formato semver básico (X.Y.Z)

### Para update_tauri_app.ps1:
- Busca el .msi más reciente por fecha de modificación
- Extrae el nombre del paquete del nombre del archivo
- Desinstala versiones anteriores automáticamente
- Usa `msiexec` con parámetros silenciosos (`/qn`)
- Maneja el código de salida 3010 (reinicio requerido)

### Para update_tauri_app.sh:
- Busca el .deb más reciente usando `find` y `sort`
- Usa `dpkg -i` para instalar
- Corrige dependencias con `apt-get install -f -y`
- Extrae información del paquete con `dpkg-deb -f`

---

## Contribuir

Si necesitas modificar los scripts:

1. **Para Bash:**
   - Usa un editor de texto (nano, vim, VSCode)
   - Asegúrate de que el archivo tenga permisos de ejecución: `chmod +x script/bash/*.sh`

2. **Para PowerShell:**
   - Usa un editor compatible con UTF-8
   - Prueba los scripts en una máquina con PowerShell 5.1+
   - Para depurar: `Set-PSBreakpoint -Script update_version.ps1 -Line 20`

---

## Licencia

Estos scripts son parte de Tauri Music App y se distribuyen bajo la misma licencia que el proyecto principal.
