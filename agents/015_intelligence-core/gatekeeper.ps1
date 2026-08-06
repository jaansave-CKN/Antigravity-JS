function Test-Consistency {
    param([string]$Output)
    Write-Host ">>> GATEKEEPER: Verificando reglas de oro..." -ForegroundColor Magenta
    if ($Output -match "columna" -or $Output -match "soporte vertical") {
        Write-Warning "ALERTA: Se detectó un posible error estructural (Columnas prohibidas)."
    }
    if ($Output -match "50%" -or $Output -match "socio mayoritario") {
        Write-Warning "ALERTA: Inconsistencia en participación (Recordar: 5% Diseñador)."
    }
    Write-Host ">>> VERIFICACIÓN COMPLETADA." -ForegroundColor Green
}


$vigilancia
