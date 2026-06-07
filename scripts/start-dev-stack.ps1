$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

function Stop-ExistingProjectProcesses {
  $processes = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -like "*$projectRoot*" -and
    $_.ProcessId -ne $PID
  }

  foreach ($process in $processes) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
    }
  }
}

function Stop-PortListeners {
  param(
    [Parameter(Mandatory = $true)]
    [int[]]$Ports
  )

  foreach ($port in $Ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      if ($connection.OwningProcess -eq $PID) {
        continue
      }

      try {
        $process = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
        Write-Host "Stopping process $($process.Id) using port $port ($($process.ProcessName))..."
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}

function Wait-ForPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Start-LoggedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Command
  )

  $stdout = Join-Path $projectRoot "$Name.out.log"
  $stderr = Join-Path $projectRoot "$Name.err.log"

  if (Test-Path $stdout) {
    Remove-Item $stdout -Force
  }
  if (Test-Path $stderr) {
    Remove-Item $stderr -Force
  }

  Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList "/c", $Command `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null
}

Stop-ExistingProjectProcesses
Stop-PortListeners -Ports @(8787, 5173)

Write-Host "Starting Claudio services..."
Start-LoggedProcess -Name "server" -Command "npm run dev:server"
Start-LoggedProcess -Name "web" -Command "npm run dev:web"

$allReady =
  (Wait-ForPort -Port 8787) -and
  (Wait-ForPort -Port 5173)

if (-not $allReady) {
  Write-Host "Claudio failed to start. Check server.out.log / web.out.log."
  foreach ($name in @("server", "web")) {
    $stdout = Join-Path $projectRoot "$name.out.log"
    $stderr = Join-Path $projectRoot "$name.err.log"

    if (Test-Path $stdout) {
      Write-Host ""
      Write-Host "==== $name.out.log ===="
      Get-Content $stdout -Tail 20
    }

    if (Test-Path $stderr) {
      $content = Get-Content $stderr
      if ($content) {
        Write-Host ""
        Write-Host "==== $name.err.log ===="
        $content | Select-Object -Last 20
      }
    }
  }
  exit 1
}

Write-Host "Claudio started."
Write-Host "Web:    http://127.0.0.1:5173"
Write-Host "Server: http://127.0.0.1:8787"
