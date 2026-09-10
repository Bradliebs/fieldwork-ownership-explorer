#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0

<#
.SYNOPSIS
    Runs offline Fieldwork data and source-release operations.
.DESCRIPTION
    Configures the installed asset and data paths, then invokes the bundled,
    validated backup or release command-line entry point.
.PARAMETER Operation
    Backup, restore, recovery or source-release operation to run.
.PARAMETER Argument
    Archive path, candidate directory or release ID required by the operation.
.PARAMETER SafetyArchive
    Optional explicit safety archive path for restore.
.PARAMETER DataPath
    Operational data directory used by the installed application.
.PARAMETER BackupKeyFile
    Authentication key file used by backup, verify and restore.
.EXAMPLE
    ./Operations.ps1 backup C:\FieldworkBackups\fieldwork.zip -BackupKeyFile C:\Keys\fieldwork.key
.NOTES
    Stop Fieldwork before operations that require the exclusive data lock.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('backup', 'verify', 'restore', 'recover', 'release-stage', 'release-activate', 'release-rollback', 'release-status')]
    [string]$Operation,

    [Parameter(Mandatory = $false, Position = 1)]
    [string]$Argument,

    [Parameter(Mandatory = $false)]
    [string]$SafetyArchive,

    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$DataPath = (Join-Path $env:LOCALAPPDATA 'Fieldwork Ownership Explorer'),

    [Parameter(Mandatory = $false)]
    [string]$BackupKeyFile
)

$ErrorActionPreference = 'Stop'

#region Functions

function Invoke-FieldworkOperation {
    <#
    .SYNOPSIS
        Invokes a bundled operator command with installed paths.
    .OUTPUTS
        None.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory = $true)]
        [string]$SelectedOperation,

        [Parameter(Mandatory = $false)]
        [string]$SelectedArgument,

        [Parameter(Mandatory = $false)]
        [string]$SelectedSafetyArchive,

        [Parameter(Mandatory = $true)]
        [string]$OperationalDataPath,

        [Parameter(Mandatory = $false)]
        [string]$AuthenticationKeyFile
    )

    $NodePath = Join-Path $PSScriptRoot 'runtime\node.exe'
    $EntryPoint = if ($SelectedOperation.StartsWith('release-')) {
        Join-Path $PSScriptRoot 'app\release-cli.js'
    }
    else {
        Join-Path $PSScriptRoot 'app\backup-cli.js'
    }
    if (-not (Test-Path -LiteralPath $NodePath) -or -not (Test-Path -LiteralPath $EntryPoint)) {
        throw 'The installed runtime or operation entry point is missing.'
    }

    $Command = $SelectedOperation.Replace('release-', '')
    $Arguments = @($EntryPoint, $Command)
    if ($SelectedArgument) {
        $Arguments += $SelectedArgument
    }
    if ($SelectedSafetyArchive) {
        if ($SelectedOperation -ne 'restore') {
            throw 'SafetyArchive is valid only for restore.'
        }
        $Arguments += $SelectedSafetyArchive
    }

    $PreviousAssetPath = $env:FIELDWORK_ASSET_DIR
    $PreviousDataPath = $env:FIELDWORK_DATA_DIR
    $PreviousKeyFile = $env:FIELDWORK_BACKUP_KEY_FILE
    try {
        $env:FIELDWORK_ASSET_DIR = Join-Path $PSScriptRoot 'assets'
        $env:FIELDWORK_DATA_DIR = [IO.Path]::GetFullPath($OperationalDataPath)
        if ($AuthenticationKeyFile) {
            $env:FIELDWORK_BACKUP_KEY_FILE = [IO.Path]::GetFullPath($AuthenticationKeyFile)
        }
        & $NodePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Fieldwork operation exited with code $LASTEXITCODE."
        }
    }
    finally {
        $env:FIELDWORK_ASSET_DIR = $PreviousAssetPath
        $env:FIELDWORK_DATA_DIR = $PreviousDataPath
        $env:FIELDWORK_BACKUP_KEY_FILE = $PreviousKeyFile
    }
}

#endregion Functions

#region Main Execution

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-FieldworkOperation -SelectedOperation $Operation -SelectedArgument $Argument `
            -SelectedSafetyArchive $SafetyArchive -OperationalDataPath $DataPath `
            -AuthenticationKeyFile $BackupKeyFile
        exit 0
    }
    catch {
        Write-Error -ErrorAction Continue "Operation failed: $($_.Exception.Message)"
        exit 1
    }
}

#endregion Main Execution