param(
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = Join-Path $repoRoot ".runtime"
$logRoot = Join-Path $runtimeRoot "logs"
$pidRoot = Join-Path $runtimeRoot "pids"
$nginxPrefix = Join-Path $runtimeRoot "nginx"
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$mediamtxConfigPath = Join-Path $repoRoot "mediamtx.yml"
$nginxConfigPath = Join-Path $repoRoot "config\nginx\runtime-nginx.conf"
$mediamtxPidPath = Join-Path $pidRoot "mediamtx.pid"
$nginxPidPath = Join-Path $pidRoot "nginx.pid"
$backendPidPath = Join-Path $pidRoot "backend.pid"
$frontendPidPath = Join-Path $pidRoot "frontend.pid"
$backendEnvPath = Join-Path $backendDir ".env"

function Load-EnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()

        if ($line -eq "" -or $line.StartsWith("#")) {
            continue
        }

        $equalsIndex = $line.IndexOf("=")
        if ($equalsIndex -lt 1) {
            continue
        }

        $key = $line.Substring(0, $equalsIndex).Trim()
        $value = $line.Substring($equalsIndex + 1).Trim()

        if ($value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        } elseif ($value.StartsWith("'") -and $value.EndsWith("'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if ([string]::IsNullOrWhiteSpace($key)) {
            continue
        }

        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) {
            [Environment]::SetEnvironmentVariable($key, $value)
            Set-Item -Path "Env:$key" -Value $value
        }
    }
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-ProcessIdFromFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    $raw = (Get-Content -LiteralPath $Path -Raw).Trim()
    if ($raw -match '^\d+$') {
        return [int]$raw
    }

    return $null
}

function Test-ProcessAlive {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Write-ProcessId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    Set-Content -LiteralPath $Path -Value $ProcessId -NoNewline
}

function Remove-ProcessFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Force
    }
}

function Stop-ProcessTree {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    $taskkill = Get-Command taskkill.exe -ErrorAction SilentlyContinue
    if ($taskkill) {
        try {
            & $taskkill.Source /PID $ProcessId /T /F | Out-Null
        } catch {
            # Fall back to Stop-Process below.
        }
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    } catch {
        # Ignore if the process has already exited.
    }
}

function Get-ConfiguredPort {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [int]$DefaultPort
    )

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultPort
    }

    $parsed = 0
    if ([int]::TryParse($value, [ref]$parsed) -and $parsed -gt 0) {
        return $parsed
    }

    return $DefaultPort
}

function Get-ListeningProcessId {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    try {
        $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $connection) {
            return [int]$connection.OwningProcess
        }
    } catch {
        return $null
    }

    return $null
}

function Resolve-Executable {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Candidates,
        [Parameter(Mandatory = $true)]
        [string]$DisplayName
    )

    $filteredCandidates = @($Candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

    foreach ($candidate in $filteredCandidates) {

        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }

        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            if ($command.Source) {
                return $command.Source
            }

            if ($command.Path) {
                return $command.Path
            }

            return $candidate
        }
    }

    $candidateList = $filteredCandidates -join ", "
    throw "Could not find $DisplayName. Tried: $candidateList"
}

function Start-ManagedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$StdOutPath,
        [Parameter(Mandatory = $true)]
        [string]$StdErrPath,
        [Parameter(Mandatory = $true)]
        [string]$PidPath
    )

    $existingProcessId = Get-ProcessIdFromFile -Path $PidPath
    if ($existingProcessId -and (Test-ProcessAlive -ProcessId $existingProcessId)) {
        Write-Host "$Name already running (pid $existingProcessId)"
        return $existingProcessId
    }

    if (Test-Path -LiteralPath $PidPath) {
        Remove-ProcessFile -Path $PidPath
    }

    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput $StdOutPath `
        -RedirectStandardError $StdErrPath

    Write-ProcessId -Path $PidPath -ProcessId $process.Id
    Write-Host "Started $Name (pid $($process.Id))"
    return $process.Id
}

function Stop-ManagedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$PidPath,
        [scriptblock]$GracefulStop = $null,
        [int]$ListenPort = 0
    )

    $processId = Get-ProcessIdFromFile -Path $PidPath
    if (-not $processId) {
        if ($ListenPort -gt 0) {
            $processId = Get-ListeningProcessId -Port $ListenPort
        }

        if (-not $processId) {
            return
        }
    }

    if (-not (Test-ProcessAlive -ProcessId $processId)) {
        Remove-ProcessFile -Path $PidPath
        Write-Host "$Name is not running; removed stale pid file"
        return
    }

    if ($GracefulStop) {
        try {
            & $GracefulStop
        } catch {
            Write-Warning "$Name graceful stop command failed: $($_.Exception.Message)"
        }
    }

    Stop-ProcessTree -ProcessId $processId

    if ($ListenPort -gt 0) {
        $listenProcessId = Get-ListeningProcessId -Port $ListenPort
        if ($listenProcessId -and $listenProcessId -ne $processId) {
            Stop-ProcessTree -ProcessId $listenProcessId
        }
    }

    Start-Sleep -Milliseconds 500
    if (-not (Test-ProcessAlive -ProcessId $processId)) {
        Remove-ProcessFile -Path $PidPath
        Write-Host "Stopped $Name (pid $processId)"
        return
    }

    Write-Warning "$Name is still running after stop attempt (pid $processId)"
}

function Show-Status {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$PidPath,
        [int]$ListenPort = 0
    )

    $processId = Get-ProcessIdFromFile -Path $PidPath
    if (-not $processId -and $ListenPort -gt 0) {
        $processId = Get-ListeningProcessId -Port $ListenPort
    }

    if ($processId -and (Test-ProcessAlive -ProcessId $processId)) {
        Write-Host ("{0,-10} running (pid {1})" -f $Name, $processId)
        return
    }

    if ($processId) {
        Write-Host ("{0,-10} stopped (stale pid {1})" -f $Name, $processId)
        return
    }

    Write-Host ("{0,-10} stopped" -f $Name)
}

function Start-Stack {
    Load-EnvFile -Path $backendEnvPath
    Ensure-Directory -Path $runtimeRoot
    Ensure-Directory -Path $logRoot
    Ensure-Directory -Path $pidRoot
    Ensure-Directory -Path $nginxPrefix
    Ensure-Directory -Path (Join-Path $nginxPrefix "logs")
    Ensure-Directory -Path (Join-Path $nginxPrefix "temp")
    Ensure-Directory -Path (Join-Path $nginxPrefix "temp\client_body_temp")
    Ensure-Directory -Path (Join-Path $nginxPrefix "temp\proxy_temp")
    Ensure-Directory -Path (Join-Path $nginxPrefix "temp\fastcgi_temp")
    Ensure-Directory -Path (Join-Path $nginxPrefix "temp\uwsgi_temp")
    Ensure-Directory -Path (Join-Path $nginxPrefix "temp\scgi_temp")

    $startedNames = @()
    try {
        $mediamtxCandidates = @(
            $env:MEDIAMTX_BINARY,
            (Join-Path $repoRoot "mediamtx.exe"),
            "mediamtx"
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        $nginxCandidates = @(
            $env:NGINX_BINARY,
            "nginx"
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        $npmCandidates = @(
            "npm.cmd",
            "npm"
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

        $mediamtxBinary = Resolve-Executable -Candidates $mediamtxCandidates -DisplayName "MediaMTX"
        $nginxBinary = Resolve-Executable -Candidates $nginxCandidates -DisplayName "nginx"
        $npmBinary = Resolve-Executable -Candidates $npmCandidates -DisplayName "npm"
        $frontendPort = Get-ConfiguredPort -Name "FRONTEND_PORT" -DefaultPort 5173
        $backendPort = Get-ConfiguredPort -Name "BACKEND_PORT" -DefaultPort 4000

        Start-ManagedProcess `
            -Name "MediaMTX" `
            -FilePath $mediamtxBinary `
            -Arguments @($mediamtxConfigPath) `
            -WorkingDirectory $repoRoot `
            -StdOutPath (Join-Path $logRoot "mediamtx.out.log") `
            -StdErrPath (Join-Path $logRoot "mediamtx.err.log") `
            -PidPath $mediamtxPidPath | Out-Null
        $startedNames += "MediaMTX"

        Start-ManagedProcess `
            -Name "nginx" `
            -FilePath $nginxBinary `
            -Arguments @("-p", $nginxPrefix, "-c", $nginxConfigPath) `
            -WorkingDirectory $repoRoot `
            -StdOutPath (Join-Path $logRoot "nginx.out.log") `
            -StdErrPath (Join-Path $logRoot "nginx.err.log") `
            -PidPath $nginxPidPath | Out-Null
        $startedNames += "nginx"

        Start-ManagedProcess `
            -Name "backend" `
            -FilePath $npmBinary `
            -Arguments @("start") `
            -WorkingDirectory $backendDir `
            -StdOutPath (Join-Path $logRoot "backend.out.log") `
            -StdErrPath (Join-Path $logRoot "backend.err.log") `
            -PidPath $backendPidPath | Out-Null
        $startedNames += "backend"

        Start-ManagedProcess `
            -Name "frontend" `
            -FilePath $npmBinary `
            -Arguments @("run", "dev") `
            -WorkingDirectory $frontendDir `
            -StdOutPath (Join-Path $logRoot "frontend.out.log") `
            -StdErrPath (Join-Path $logRoot "frontend.err.log") `
            -PidPath $frontendPidPath | Out-Null
        $startedNames += "frontend"
    } catch {
        foreach ($name in @("frontend", "backend", "nginx", "MediaMTX")) {
            if ($startedNames -contains $name) {
                switch ($name) {
                    "frontend" { Stop-ManagedProcess -Name "frontend" -PidPath $frontendPidPath }
                    "backend" { Stop-ManagedProcess -Name "backend" -PidPath $backendPidPath }
                    "nginx" {
                        Stop-ManagedProcess `
                            -Name "nginx" `
                            -PidPath $nginxPidPath `
                            -GracefulStop {
                                & $nginxBinary -p $nginxPrefix -c $nginxConfigPath -s stop
                            }
                    }
                    "MediaMTX" { Stop-ManagedProcess -Name "MediaMTX" -PidPath $mediamtxPidPath }
                }
            }
        }

        throw
    }
}

function Stop-Stack {
    Load-EnvFile -Path $backendEnvPath
    $frontendPort = Get-ConfiguredPort -Name "FRONTEND_PORT" -DefaultPort 5173
    $backendPort = Get-ConfiguredPort -Name "BACKEND_PORT" -DefaultPort 4000

    Stop-ManagedProcess -Name "frontend" -PidPath $frontendPidPath -ListenPort $frontendPort
    Stop-ManagedProcess -Name "backend" -PidPath $backendPidPath -ListenPort $backendPort
    Stop-ManagedProcess `
        -Name "nginx" `
        -PidPath $nginxPidPath `
        -GracefulStop {
            $nginxBinary = Resolve-Executable -Candidates (@(
                $env:NGINX_BINARY,
                "nginx"
            ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -DisplayName "nginx"
            & $nginxBinary -p $nginxPrefix -c $nginxConfigPath -s stop
        }
    Stop-ManagedProcess -Name "MediaMTX" -PidPath $mediamtxPidPath
}

switch ($Action) {
    "start" {
        Start-Stack
    }
    "stop" {
        Stop-Stack
    }
    "restart" {
        Stop-Stack
        Start-Stack
    }
    "status" {
        Ensure-Directory -Path $pidRoot
        $frontendPort = Get-ConfiguredPort -Name "FRONTEND_PORT" -DefaultPort 5173
        $backendPort = Get-ConfiguredPort -Name "BACKEND_PORT" -DefaultPort 4000
        Show-Status -Name "MediaMTX" -PidPath $mediamtxPidPath
        Show-Status -Name "nginx" -PidPath $nginxPidPath
        Show-Status -Name "backend" -PidPath $backendPidPath -ListenPort $backendPort
        Show-Status -Name "frontend" -PidPath $frontendPidPath -ListenPort $frontendPort
    }
}
