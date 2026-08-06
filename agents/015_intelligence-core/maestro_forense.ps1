function Invoke-ForenseAudit {
    param(
        [Parameter(Mandatory=$true)][string]$ProyectoNombre,
        [string]$ArchivoA,
        [string]$ArchivoB
    )
    Write-Host "
=== INICIANDO AUDITORÍA FORENSE: $ProyectoNombre ===" -ForegroundColor Cyan
    $ruta = "PROYECTOS_ACTIVOS\$ProyectoNombre\01_Documentos_Originales"
    
    if (Test-Path "$ruta\$ArchivoA") {
        Write-Host "[?] Archivo A detectado. Analizando patrones..." -ForegroundColor Green
        $alertas = @("marca específica", "único proveedor", "patente exclusiva", "experiencia restrictiva")
        $txt = Get-Content "$ruta\$ArchivoA" -Raw
        foreach ($a in $alertas) { if ($txt -like "*$a*") { Write-Host " [!] ALERTA: $a" -ForegroundColor Red } }
    }

    if ($ArchivoB -and (Test-Path "$ruta\$ArchivoB")) {
        Write-Host "[?] Archivo B detectado. Comparando colusión..." -ForegroundColor Green
        $cA = Get-Content "$ruta\$ArchivoA"; $cB = Get-Content "$ruta\$ArchivoB"
        $sim = (Compare-Object $cA $cB -IncludeEqual | Where-Object { $_.SideIndicator -eq "==" }).Count
        Write-Host " Similitud: $([Math]::Round(($sim/$cA.Count)*100, 2))%" -ForegroundColor Yellow
    }
}
