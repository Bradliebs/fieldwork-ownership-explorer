#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0

<#
.SYNOPSIS
    Removes the Fieldwork Ownership Explorer application files.
.DESCRIPTION
    Removes the installed application. User investigations and source releases are
    preserved unless RemoveData is explicitly supplied.
.PARAMETER InstallPath
    Installed application directory.
.PARAMETER RemoveData
    Also removes the operational data directory after explicit confirmation bypass.
.EXAMPLE
    ./Uninstall.ps1
.NOTES
    Stop Fieldwork before uninstalling. The default operation preserves all user data.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$InstallPath = $PSScriptRoot,

    [Parameter(Mandatory = $false)]
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'

#region Functions

function Remove-FieldworkApplication {
    <#
    .SYNOPSIS
        Removes application files and optionally operational data.
    .OUTPUTS
        None.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Target,

        [Parameter(Mandatory = $true)]
        [bool]$DeleteData
    )

    $DataPath = Join-Path $env:LOCALAPPDATA 'Fieldwork Ownership Explorer'
    $LockPath = Join-Path $DataPath '.fieldwork-server.lock'
    if (Test-Path -LiteralPath $LockPath) {
        throw "Fieldwork may be running. Confirm it is stopped and resolve the runtime lock at $LockPath before uninstalling."
    }
    $ResolvedTarget = [IO.Path]::GetFullPath($Target)
    Set-Location -LiteralPath ([IO.Path]::GetTempPath())
    Remove-Item -LiteralPath $ResolvedTarget -Recurse -Force
    if ($DeleteData -and (Test-Path -LiteralPath $DataPath)) {
        Remove-Item -LiteralPath $DataPath -Recurse -Force
    }
}

#endregion Functions

#region Main Execution

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Remove-FieldworkApplication -Target $InstallPath -DeleteData $RemoveData.IsPresent
        Write-Host 'Fieldwork application files removed.' -ForegroundColor Green
        if (-not $RemoveData) {
            Write-Host 'User investigations, backups metadata and source releases were preserved.'
        }
        exit 0
    }
    catch {
        Write-Error -ErrorAction Continue "Uninstallation failed: $($_.Exception.Message)"
        exit 1
    }
}

#endregion Main Execution