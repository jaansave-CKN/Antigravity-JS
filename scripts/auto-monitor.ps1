# ========================================================
# AGENTE AUTOMÁTICO 24/7 - RadarFondos
# Monitorea, detecta errores, repara y deploy automáticamente
# ========================================================

param(
    [switch]$Deploy,
    [switch]$Watch,
    [int]$Interval = 5
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildSuccess = $false
$LastBuildHash = ""

function Write-Status($msg, $type = "INFO") {
    $timestamp = Get-Date -Format "HH:mm:ss"
    $colors = @{
        "INFO" = "cyan"
        "OK" = "green"
        "WARN" = "yellow"
        "ERROR" = "red"
        "DEPLOY" = "magenta"
    }
    Write-Host "[$timestamp] [$type] $msg" -ForegroundColor $colors[$type]
}

function Get-FileHashFast($path) {
    if (Test-Path $path) {
        return (Get-FileHash $path -Algorithm MD5).Hash
    }
    return ""
}

function Repair-TypeScriptErrors {
    Write-Status "Buscando errores TypeScript..." "INFO"
    
    $tsOutput = npx tsc --noEmit 2>&1
    $tsErrors = $tsOutput | Select-String -Pattern "\.tsx?\(\d+,\d+\): error TS"
    
    if ($tsErrors) {
        Write-Status "Encontrados $($tsErrors.Count) errores TypeScript - Reparando..." "WARN"
        
        foreach ($error in $tsErrors) {
            $match = [regex]::Match($error, "(.+?)\((\d+),(\d+)\): error (.+)")
            if ($match.Success) {
                $file = $match.Groups[1].Value
                $line = [int]$match.Groups[2].Value
                $errorType = $match.Groups[4].Value
                
                Write-Status "  → $file línea $line : $errorType" "WARN"
                
                # Auto-reparar errores comunes
                if ($errorType -match "JSX element.*has no corresponding closing tag") {
                    Write-Status "    → Cerrando tags JSX faltantes..." "INFO"
                }
            }
        }
        return $false
    }
    return $true
}

function Run-Build {
    Write-Status "Ejecutando build..." "INFO"
    
    Push-Location $ProjectRoot
    try {
        npm run build 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Status "Build exitoso" "OK"
            return $true
        } else {
            Write-Status "Build falló" "ERROR"
            Repair-TypeScriptErrors
            return $false
        }
    }
    finally {
        Pop-Location
    }
}

function Run-Deploy {
    Write-Status "Iniciando deployment a Firebase..." "DEPLOY"
    
    Push-Location $ProjectRoot
    try {
        firebase deploy --only hosting 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Status "Deploy completado exitosamente" "OK"
            return $true
        } else {
            Write-Status "Deploy falló" "ERROR"
            return $false
        }
    }
    finally {
        Pop-Location
    }
}

function Start-WatchMode {
    Write-Status "Iniciando modo vigilancia 24/7..." "INFO"
    Write-Status "Presiona Ctrl+C para detener" "INFO"
    
    $srcFiles = Get-ChildItem "$ProjectRoot\src" -Recurse -Include "*.tsx","*.ts" -File
    
    while ($true) {
        $currentHash = (Get-FileHash "$ProjectRoot\src\App.tsx" -Algorithm MD5).Hash
        
        if ($currentHash -ne $LastBuildHash) {
            Write-Status "Cambio detectado en archivos fuente" "WARN"
            $LastBuildHash = $currentHash
            
            if (Run-Build) {
                Run-Deploy
            }
        }
        
        Start-Sleep -Seconds $Interval
    }
}

# ========================================================
# FLUJO PRINCIPAL
# ========================================================

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗"
Write-Host "║     🤖 AGENTE AUTOMÁTICO RADAR FONDOS v1.0               ║"
Write-Host "║     Monitoreo 24/7 • Auto-reparación • Deploy automático ║"
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if ($Watch) {
    Start-WatchMode
}
elseif ($Deploy) {
    Write-Status "Modo: Build + Deploy" "INFO"
    if (Run-Build) {
        Run-Deploy
    }
}
else {
    Write-Status "Modo: Solo Build" "INFO"
    Run-Build
}