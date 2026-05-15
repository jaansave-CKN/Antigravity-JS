$ErrorActionPreference = "SilentlyContinue"
$port = 5000

function Get-CdpErrors($port, $sec) {
    $err = @()
    try {
        $r = Invoke-WebRequest "http://localhost:$port/api/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    return $false
}

$running = Get-CdpErrors $port 2
if ($running) {
    Write-Host "[OK] Servidor ya corriendo en puerto $port"
    exit 0
}

Write-Host "[START] Iniciando servidor API en puerto $port..."
Set-Location "C:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos"
python main.py