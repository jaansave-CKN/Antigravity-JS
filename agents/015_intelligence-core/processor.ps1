function Process-Intelligence {
    param([string]$FilePath)
    Write-Host ">>> ANALIZANDO DOCUMENTO: $FilePath" -ForegroundColor Yellow
    # Aquí el agente vinculará el contenido al contexto de Modular Building
    Get-Content $FilePath | Out-String
}
