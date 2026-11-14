<#PSScriptInfo
.VERSION 1.0
.AUTHOR Hotsechu
.DESCRIPTION Script para actualizar Tauri Music App en Windows desde el .msi generado
#>

<#
.SYNOPSIS
Actualiza Tauri Music App desde el instalador .msi generado por Tauri

.DESCRIPTION
Este script busca el archivo .msi mas reciente en la carpeta de build de Tauri
y lo instala/actualiza usando msiexec.

.EJEMPLO
."update_tauri_app.ps1"

.NOTA
Requiere ejecutarse como administrador.
Si el script no se ejecuta, primero configura la política:
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
Alternativa para ejecutar sin cambiar la política:
   powershell -ExecutionPolicy Bypass -File .\script\powershell\update_tauri_app.ps1
Códigos de salida de msiexec:
   0 = Éxito
   3010 = Éxito (requiere reinicio)
   1603 = Error fatal
   1618 = Otra instalación en curso   
#>

param()

# Verificar si se esta ejecutando como administrador
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-NOT $IsAdmin) {
    Write-Host "Este script requiere permisos de administrador." -ForegroundColor Red
    Write-Host "Por favor, ejecutalo como administrador." -ForegroundColor Red
    exit 1
}

$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$MsiDir = Join-Path $ProjectDir "src-tauri\target\release\bundle\msi"

# Verificar si existe el directorio
if (-not (Test-Path -Path $MsiDir)) {
    Write-Host "Error: No se intento el directorio $MsiDir" -ForegroundColor Red
    Write-Host "Asegurate de haber ejecutado 'npm run tauri build' primero." -ForegroundColor Yellow
    Write-Host "Nota: En Windows, Tauri genera el .msi, no el .deb" -ForegroundColor Yellow
    exit 1
}

# Buscar el archivo .msi mas reciente
$MsiFiles = Get-ChildItem -Path $MsiDir -Filter "*.msi" -File

if ($MsiFiles.Count -eq 0) {
    Write-Host "Error: No se intento nahi un archivo .msi en $MsiDir" -ForegroundColor Red
    Write-Host "Asegurate de haber generado el instalador para Windows." -ForegroundColor Yellow
    exit 1
}

# Ordenar por fecha de modificacion (el mas reciente primero)
$LatestMsi = $MsiFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1

Write-Host "Encontrado archivo .msi: $($LatestMsi.FullName)" -ForegroundColor Green

# Extraer informacion del paquete desde el nombre del archivo
$PackageName = $LatestMsi.BaseName
$Version = "Desconocida"

# Intentar extraer version del nombre del archivo (formato: Nombre_Version_Arquitectura.msi)
if ($LatestMsi.BaseName -match "_([0-9]+\.[0-9]+\.[0-9]+)") {
    $Version = $matches[1]
}

Write-Host "Instalando: $PackageName version $Version" -ForegroundColor Cyan

# Desinstalar version anterior si existe
function Remove-OldVersion {
    param([string]$ProductName)
    
    try {
        $UninstallKeys = @(
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        )
        
        foreach ($Key in $UninstallKeys) {
            if (Test-Path $Key) {
                $Apps = Get-ChildItem -Path $Key | ForEach-Object {
                    $AppProps = Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue
                    if ($AppProps -and $AppProps.DisplayName -like "*$ProductName*" -and $AppProps.UninstallString) {
                        return $AppProps
                    }
                }
                
                foreach ($App in $Apps) {
                    Write-Host "Desinstalando version anterior: $($App.DisplayName) ($($App.DisplayVersion))" -ForegroundColor Yellow
                    
                    if ($App.UninstallString -match "msiexec") {
                        # Extraer el ProductCode
                        $ProductCode = $App.PSChildName
                        Start-Process -FilePath "msiexec.exe" -ArgumentList "/x $ProductCode /qn" -Wait
                    } else {
                        Start-Process -FilePath $App.UninstallString -ArgumentList "/S" -Wait
                    }
                }
            }
        }
    } catch {
        Write-Host "Advertencia al desinstalar version anterior: $_" -ForegroundColor Yellow
    }
}

# Intentar desinstalar version anterior
Remove-OldVersion -ProductName "Tauri Music App"

# Instalar usando msiexec
Write-Host "Iniciando instalacion..." -ForegroundColor Cyan

$InstallArgs = "/i `"$($LatestMsi.FullName)`" /qn /norestart"
$InstallProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList $InstallArgs -Wait -PassThru

# Codigos de salida de msiexec
$SuccessCodes = @(0, 3010)  # 0 = Exito, 3010 = Exito con reinicio requerido

if ($SuccessCodes -contains $InstallProcess.ExitCode) {
    Write-Host "" -ForegroundColor Green
    Write-Host "Aplicacion actualizada: $PackageName version $Version" -ForegroundColor Green
    Write-Host "Ruta del .msi: $($LatestMsi.FullName)" -ForegroundColor Green
    
    if ($InstallProcess.ExitCode -eq 3010) {
        Write-Host "Reinicio requerido para completar la instalacion." -ForegroundColor Yellow
        
        $Reiniciar = Read-Host "Deseas reiniciar ahora? (s/n)"
        if ($Reiniciar -eq 's' -or $Reiniciar -eq 'S') {
            Restart-Computer -Force
        }
    }
    
    exit 0
} else {
    Write-Host "" -ForegroundColor Red
    Write-Host "Error: No se pudo instalar el paquete .msi (Codigo: $($InstallProcess.ExitCode))" -ForegroundColor Red
    
    # Mensajes de error comunes
    $ErrorMessages = @{
        1602 = "Cancelado por el usuario"
        1603 = "Error fatal durante la instalacion"
        1618 = "Otra instalacion en curso"
        1638 = "Otra version ya esta instalada"
        1708 = "Version anterior ya instalada"
    }
    
    if ($ErrorMessages.ContainsKey($InstallProcess.ExitCode)) {
        Write-Host "Detalle: $($ErrorMessages[$InstallProcess.ExitCode])" -ForegroundColor Yellow
    }
    
    Write-Host "" -ForegroundColor Yellow
    Write-Host "Posibles soluciones:" -ForegroundColor Yellow
    Write-Host "1. Desinstala la version anterior manualmente desde 'Agregar o quitar programas'" -ForegroundColor Yellow
    Write-Host "2. Asegurate de que no hay una instalacion en curso" -ForegroundColor Yellow
    Write-Host "3. Ejecuta este script como administrador" -ForegroundColor Yellow
    
    exit $InstallProcess.ExitCode
}
