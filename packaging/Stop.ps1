#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0

<#
.SYNOPSIS
    Gracefully stops the installed Fieldwork Ownership Explorer server.
.DESCRIPTION
    Verifies the runtime lock belongs to this installation, then writes an
    instance-bound shutdown request and waits for Fastify and SQLite to close.
.PARAMETER DataPath
    Operational data directory containing the runtime lock.
.EXAMPLE
    ./Stop.ps1
.NOTES
    Run from the installed application directory before backup or maintenance.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$DataPath = (Join-Path $env:LOCALAPPDATA 'Fieldwork Ownership Explorer')
)

$ErrorActionPreference = 'Stop'

#region Functions

function Stop-FieldworkServer {
    <#
    .SYNOPSIS
        Requests shutdown of the verified server instance.
    .OUTPUTS
        None.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$OperationalDataPath
    )

    $LockPath = Join-Path $OperationalDataPath '.fieldwork-server.lock'
    if (-not (Test-Path -LiteralPath $LockPath)) {
        Write-Host 'Fieldwork is not running.'
        return
    }
    $Lock = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json
    $InstanceId = [Guid]::Parse($Lock.id).ToString()
    $ProcessId = [int]$Lock.pid
    $StartedAtValue = $Lock.startedAt
    $StartedAt = if ($StartedAtValue -is [DateTime]) {
        ([DateTimeOffset]$StartedAtValue).UtcDateTime
    }
    else {
        [DateTimeOffset]::Parse(
            [string]$StartedAtValue,
            [Globalization.CultureInfo]::InvariantCulture
        ).UtcDateTime
    }
    $LoopbackUri = [Uri]$Lock.url
    if ($LoopbackUri.Scheme -ne 'http' -or $LoopbackUri.Host -ne '127.0.0.1') {
        throw "Runtime lock contains an invalid loopback URL at $LockPath"
    }
    $ServerProcess = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $ServerProcess) {
        throw "Runtime lock names stopped PID $ProcessId. Start the application to recover the stale lock, or inspect it before manual removal."
    }
    $ExpectedExecutable = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runtime\node.exe'))
    if (-not $ServerProcess.Path -or -not $ServerProcess.Path.Equals($ExpectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
        throw "PID $ProcessId is not the Fieldwork runtime from this installation."
    }
    if ([Math]::Abs(($ServerProcess.StartTime.ToUniversalTime() - $StartedAt).TotalSeconds) -gt 60) {
        throw "PID $ProcessId start time does not match the Fieldwork runtime lock."
    }

    New-Item -ItemType Directory -Path $OperationalDataPath -Force | Out-Null
    $RequestPath = Join-Path $OperationalDataPath '.fieldwork-shutdown-request.json'
    $TemporaryPath = "$RequestPath.$([Guid]::NewGuid()).tmp"
    $Request = @{ instanceId = $InstanceId; requestedAt = [DateTimeOffset]::UtcNow.ToString('o') }
    $Request | ConvertTo-Json -Compress | Set-Content -LiteralPath $TemporaryPath -Encoding utf8
    Move-Item -LiteralPath $TemporaryPath -Destination $RequestPath -Force
    Wait-Process -Id $ProcessId -Timeout 15
    if (Test-Path -LiteralPath $LockPath) {
        throw "Fieldwork stopped but did not release its runtime lock at $LockPath"
    }
}

#endregion Functions

#region Main Execution

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Stop-FieldworkServer -OperationalDataPath $DataPath
        Write-Host 'Fieldwork stopped cleanly.' -ForegroundColor Green
        exit 0
    }
    catch {
        Write-Error -ErrorAction Continue "Shutdown failed: $($_.Exception.Message)"
        exit 1
    }
}

#endregion Main Execution