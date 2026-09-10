#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0

<#
.SYNOPSIS
    Installs the Fieldwork Ownership Explorer internal pilot for the current user.
.DESCRIPTION
    Copies the offline application to a versioned user-writable program directory.
    Operational data remains under LOCALAPPDATA outside the installation directory.
.PARAMETER Destination
    Application installation directory.
.EXAMPLE
    ./Install.ps1
.NOTES
    Run from the extracted release artifact while the application is stopped.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Programs\Fieldwork Ownership Explorer')
)

$ErrorActionPreference = 'Stop'

#region Functions

function Assert-FieldworkStopped {
    <#
    .SYNOPSIS
        Refuses installation while the local application lock exists.
    .OUTPUTS
        None.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param()

    $LockPath = Join-Path $env:LOCALAPPDATA 'Fieldwork Ownership Explorer\.fieldwork-server.lock'
    if (Test-Path -LiteralPath $LockPath) {
        throw "Fieldwork may be running. Confirm it is stopped and resolve the runtime lock at $LockPath before installing."
    }
}

function Install-FieldworkApplication {
    <#
    .SYNOPSIS
        Copies release files into the selected application directory.
    .OUTPUTS
        System.IO.DirectoryInfo.
    #>
    [CmdletBinding()]
    [OutputType([System.IO.DirectoryInfo])]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Target
    )

    $Source = $PSScriptRoot
    $ResolvedSource = [IO.Path]::GetFullPath($Source)
    $ResolvedTarget = [IO.Path]::GetFullPath($Target)
    if ($ResolvedSource.Equals($ResolvedTarget, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Install destination must differ from the extracted artifact directory.'
    }
    New-Item -ItemType Directory -Path $ResolvedTarget -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force |
        Where-Object Name -NotIn @('Install.ps1') |
        Copy-Item -Destination $ResolvedTarget -Recurse -Force
    return Get-Item -LiteralPath $ResolvedTarget
}

#endregion Functions

#region Main Execution

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Assert-FieldworkStopped
        $Installed = Install-FieldworkApplication -Target $Destination
        Write-Host "Installed Fieldwork Ownership Explorer at $($Installed.FullName)" -ForegroundColor Green
        Write-Host 'User data is preserved separately under LOCALAPPDATA\Fieldwork Ownership Explorer.'
        exit 0
    }
    catch {
        Write-Error -ErrorAction Continue "Installation failed: $($_.Exception.Message)"
        exit 1
    }
}

#endregion Main Execution