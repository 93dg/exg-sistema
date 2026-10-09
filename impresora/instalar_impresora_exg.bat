@echo off
chcp 65001 >nul
title Instalar impresora de la oficina - EXG
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f = Get-Content -Raw -LiteralPath '%~f0'; $i = $f.LastIndexOf('#PS-START'); Invoke-Expression $f.Substring($i)"
echo.
pause
exit /b
#PS-START
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Join-Path $env:LOCALAPPDATA 'ExgImpresora'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Host ''
Write-Host '== Impresora de la oficina (EXG) ==' -ForegroundColor Yellow

# 1) Visor que imprime en silencio (SumatraPDF)
$sumatra = $null
$candidatos = @(
  (Join-Path $dir 'SumatraPDF.exe'),
  (Join-Path $env:LOCALAPPDATA 'SumatraPDF\SumatraPDF.exe'),
  (Join-Path $env:ProgramFiles 'SumatraPDF\SumatraPDF.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'SumatraPDF\SumatraPDF.exe')
)
foreach ($c in $candidatos) { if ($c -and (Test-Path $c)) { $sumatra = $c; break } }
if (-not $sumatra) {
  Write-Host 'Descargando SumatraPDF (visor de PDF gratuito)...'
  $urls = @(
    'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip',
    'https://files.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip'
  )
  foreach ($u in $urls) {
    try {
      $zip = Join-Path $env:TEMP 'sumatra_exg.zip'
      Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec 120
      $tmpDir = Join-Path $env:TEMP 'sumatra_exg'
      if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $tmpDir -Force
      $exe = Get-ChildItem $tmpDir -Filter '*.exe' -Recurse | Select-Object -First 1
      Copy-Item $exe.FullName (Join-Path $dir 'SumatraPDF.exe') -Force
      $sumatra = Join-Path $dir 'SumatraPDF.exe'
      break
    } catch { Write-Host ('  no se pudo desde ' + $u) }
  }
}
if (-not $sumatra -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host 'Probando con winget...'
  try {
    winget install --id SumatraPDF.SumatraPDF -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
    foreach ($c in $candidatos) { if ($c -and (Test-Path $c)) { $sumatra = $c; break } }
  } catch {}
}
if (-not $sumatra) {
  Start-Process 'https://www.sumatrapdfreader.org/download-free-pdf-viewer'
  throw 'No he podido descargar SumatraPDF. Instalalo desde la pagina que se acaba de abrir y vuelve a ejecutar este archivo.'
}
Write-Host ('SumatraPDF: ' + $sumatra)

# 2) Impresora (la Brother si esta instalada; si no, la predeterminada)
$impresoras = @(Get-Printer | Select-Object -ExpandProperty Name)
$impresora = $impresoras | Where-Object { $_ -match 'Brother|MFC' } | Select-Object -First 1
if (-not $impresora) {
  $impresora = (Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1).Name
}
if (-not $impresora) { throw 'No hay ninguna impresora instalada en este ordenador. Instala la Brother en Windows y vuelve a ejecutar este archivo.' }
Write-Host ('Impresora: ' + $impresora)

# 3) Programa que vigila la cola
@{ impresora = $impresora; sumatra = $sumatra } | ConvertTo-Json | Set-Content -Path (Join-Path $dir 'config.json') -Encoding UTF8
$agente = @'
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = 'https://sshctqnpuolawtcujxkt.supabase.co/rest/v1'
$key  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzaGN0cW5wdW9sYXd0Y3VqeGt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDMxNDQsImV4cCI6MjEwNDUxOTE0NH0.NgqSwwtdQjKot2kiCabmF6f_kvl-27QU1kWgfzYPFsQ'
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg  = Get-Content (Join-Path $dir 'config.json') -Raw | ConvertFrom-Json
$log  = Join-Path $dir 'agente.log'

function Log($m) {
  try {
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 200KB)) { Remove-Item $log -Force }
    Add-Content -Path $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m)
  } catch {}
}
function Api($method, $path, $body, $prefer) {
  $hh = @{ apikey = $key; Authorization = "Bearer $key" }
  if ($prefer) { $hh['Prefer'] = $prefer }
  $p = @{ Uri = "$base/$path"; Method = $method; Headers = $hh; TimeoutSec = 90 }
  if ($body) {
    $p.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
    $p.ContentType = 'application/json; charset=utf-8'
  }
  Invoke-RestMethod @p
}

Log 'Agente de impresion arrancado'
try { Api 'PATCH' 'cola_impresion?estado=eq.imprimiendo' @{ estado = 'error'; error = 'Interrumpido: el ordenador se reinicio mientras imprimia' } 'return=minimal' | Out-Null } catch {}

$ultimoLatido = [datetime]::MinValue
while ($true) {
  try {
    if (((Get-Date) - $ultimoLatido).TotalSeconds -gt 30) {
      Api 'POST' 'impresora_agente?on_conflict=id' @{ id = 1; last_seen = (Get-Date).ToUniversalTime().ToString('o'); equipo = $env:COMPUTERNAME; impresora = $cfg.impresora; version = '1' } 'resolution=merge-duplicates,return=minimal' | Out-Null
      $ultimoLatido = Get-Date
    }
    $trabajos = Api 'GET' 'cola_impresion?estado=eq.pendiente&order=created_at.asc&limit=1&select=id,nombre,copias,pdf_base64' $null $null
    foreach ($j in @($trabajos)) {
      if (-not $j) { continue }
      $reservado = Api 'PATCH' ("cola_impresion?id=eq.{0}&estado=eq.pendiente" -f $j.id) @{ estado = 'imprimiendo' } 'return=representation'
      if (-not $reservado) { continue }
      $tmp = Join-Path $env:TEMP ('exg_' + $j.id + '.pdf')
      try {
        [IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String($j.pdf_base64))
        $argumentos = '-print-to "{0}" -silent -exit-when-done' -f $cfg.impresora
        if ([int]$j.copias -gt 1) { $argumentos += (' -print-settings "{0}x"' -f $j.copias) }
        $argumentos += (' "{0}"' -f $tmp)
        $proc = Start-Process -FilePath $cfg.sumatra -ArgumentList $argumentos -Wait -PassThru -WindowStyle Hidden
        if ($proc.ExitCode -ne 0) { throw ("SumatraPDF devolvio el codigo " + $proc.ExitCode) }
        Api 'PATCH' ("cola_impresion?id=eq.{0}" -f $j.id) @{ estado = 'impreso'; impreso_at = (Get-Date).ToUniversalTime().ToString('o'); pdf_base64 = '' } 'return=minimal' | Out-Null
        Log ('Impreso: ' + $j.nombre)
      } catch {
        Log ('ERROR imprimiendo ' + $j.nombre + ': ' + $_.Exception.Message)
        try { Api 'PATCH' ("cola_impresion?id=eq.{0}" -f $j.id) @{ estado = 'error'; error = $_.Exception.Message } 'return=minimal' | Out-Null } catch {}
      } finally {
        if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
      }
    }
  } catch {
    Log ('Sin conexion o error: ' + $_.Exception.Message)
    Start-Sleep -Seconds 20
  }
  Start-Sleep -Seconds 5
}
'@
Set-Content -Path (Join-Path $dir 'agente.ps1') -Value $agente -Encoding UTF8

# 4) Que arranque solo al iniciar sesion y se reinicie si falla
$script = Join-Path $dir 'agente.ps1'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'ExgImpresora' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$tareaOk = $false
try {
  $accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '"')
  $disparador = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Unregister-ScheduledTask -TaskName 'EXG Impresora' -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName 'EXG Impresora' -Action $accion -Trigger $disparador -Settings $ajustes -Description 'Imprime lo que se envia desde la app EXG' -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName 'EXG Impresora' -ErrorAction Stop
  $tareaOk = $true
} catch { Write-Host 'No pude crear la tarea programada; uso la carpeta de Inicio de Windows.' }
if (-not $tareaOk) {
  $vbs = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' + $script + '""", 0, False'
  Set-Content -Path (Join-Path ([Environment]::GetFolderPath('Startup')) 'EXG Impresora.vbs') -Value $vbs -Encoding ASCII
  Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '"') -WindowStyle Hidden
}

# 5) Que el ordenador no se suspenda enchufado a la corriente (la pantalla si puede apagarse)
try { powercfg /change standby-timeout-ac 0; powercfg /change hibernate-timeout-ac 0 } catch {}

Write-Host ''
Write-Host 'LISTO. En la app: Configuracion > Impresora de la oficina > Pagina de prueba.' -ForegroundColor Green
Write-Host 'Deja el ordenador encendido (la pantalla puede apagarse).'
