$ie = New-Object -ComObject InternetExplorer.Application
$ie.Visible = $true
$ie.Navigate("http://localhost:5000/proyecto01.html")
while ($ie.Busy -or $ie.ReadyState -ne 4) {
    Start-Sleep -Milliseconds 100
}