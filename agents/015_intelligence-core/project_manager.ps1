function New-AntigravityProject {
    param([string]$NombreProyecto)
    $ruta = "PROYECTOS_ACTIVOS\$NombreProyecto"
    New-Item -ItemType Directory -Path "$ruta\01_Documentos_Originales" -Force
    New-Item -ItemType Directory -Path "$ruta\02_Descargas_SECOP" -Force
    New-Item -ItemType Directory -Path "$ruta\03_Resultados_DOCX" -Force
    New-Item -ItemType Directory -Path "$ruta\04_Inteligencia_Local" -Force
    Write-Host ">>> PROYECTO $NombreProyecto CREADO EXITOSAMENTE." -ForegroundColor Green
}
