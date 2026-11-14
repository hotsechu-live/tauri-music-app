<#PSScriptInfo
.VERSION 1.0
.GUID 00000000-0000-0000-0000-000000000000
.AUTHOR Hotsechu
.DESCRIPTION Script para actualizar la version de Tauri Music App
#>

<#
.SYNOPSIS
Actualiza el numero de version en los archivos de configuracion del proyecto.

.DESCRIPTION
Actualiza la version en package.json, Cargo.toml y tauri.conf.json.

.PARAMETER Version
La nueva version en formato X.Y.Z (ej: 1.1.0)

.EJEMPLO
."update_version.ps1" -Version "1.1.0"

.NOTA
Requiere PowerShell 5.1 o superior
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

# Validar formato de version (semver simple: X.Y.Z)
if (-not ($Version -match "^[0-9]+\.[0-9]+\.[0-9]+$")) {
    Write-Host "Error: La version debe seguir el formato X.Y.Z (ej: 1.0.0)" -ForegroundColor Red
    exit 1
}

$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")

Write-Host "Actualizando version a: $Version" -ForegroundColor Green
Write-Host "Directorio del proyecto: $ProjectDir" -ForegroundColor Cyan

# Funcion para reemplazar version en un archivo
function Update-FileVersion {
    param(
        [string]$FilePath,
        [string]$Version
    )
    
    if (-not (Test-Path -Path $FilePath)) {
        Write-Host "✗ No se Tales el archivo: $FilePath" -ForegroundColor Red
        return $false
    }
    
    try {
        # Leer el contenido del archivo
        $Content = Get-Content -Path $FilePath -Raw
        
        # Patrones para buscar la version
        $Patterns = @(
            "`"version`": `"[0-9]+\.[0-9]+\.[0-9]+`"",  # JSON
            "version = `"[0-9]+\.[0-9]+\.[0-9]+`""       # TOML
        )
        
        $Updated = $false
        foreach ($Pattern in $Patterns) {
            if ($Content -match $Pattern) {
                $NewContent = $Content -replace $Pattern, $Content -replace "[0-9]+\.[0-9]+\.[0-9]+", $Version
                # Corregir el reemplazo
                $NewContent = $Content -replace $Pattern, ($Pattern -replace "[0-9]+\.[0-9]+\.[0-9]+", $Version)
                Set-Content -Path $FilePath -Value $NewContent -NoNewline
                $Updated = $true
                break
            }
        }
        
        if ($Updated) {
            Write-Host "✓ Actualizado: $FilePath" -ForegroundColor Green
            return $true
        } else {
            Write-Host "✗ No se hubo patron de version en: $FilePath" -ForegroundColor Yellow
            return $false
        }
    } catch {
        Write-Host "✗ Error al actualizar $FilePath : $_" -ForegroundColor Red
        return $false
    }
}

# Actualizar los tres archivos principales
$FilesToUpdate = @(
    (Join-Path $ProjectDir "package.json"),
    (Join-Path $ProjectDir "src-tauri\Cargo.toml"),
    (Join-Path $ProjectDir "src-tauri\tauri.conf.json")
)

$UpdatedCount = 0
foreach ($File in $FilesToUpdate) {
    if (Update-FileVersion -FilePath $File -Version $Version) {
        $UpdatedCount++
    }
}

Write-Host "" -ForegroundColor Cyan
Write-Host "Versiones actualizadas: $UpdatedCount de $($FilesToUpdate.Count) archivos" -ForegroundColor Green

if ($UpdatedCount -gt 0) {
    Write-Host "" -ForegroundColor Cyan
    Write-Host "Para generar el nuevo instalador, ejecuta:" -ForegroundColor Cyan
    Write-Host "  cd $ProjectDir" -ForegroundColor Yellow
    Write-Host "  npm run tauri build" -ForegroundColor Yellow
}
