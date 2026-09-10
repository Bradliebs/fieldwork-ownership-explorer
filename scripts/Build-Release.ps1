#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0

<#
.SYNOPSIS
    Builds the versioned offline Windows internal-pilot artifact.
.DESCRIPTION
    Compiles frontend and server code, installs production dependencies in staging,
    copies the pinned Node runtime, and emits SBOM, audit, notices and checksums.
.PARAMETER RepoRoot
    Repository root to build.
.PARAMETER OutputDirectory
    Directory that receives the unpacked artifact and ZIP file.
.EXAMPLE
    ./scripts/Build-Release.ps1
.NOTES
    Runs via npm run build:release on Windows with Node 24.13.1 and PowerShell 7.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),

    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts')
)

$ErrorActionPreference = 'Stop'

#region Functions

function Invoke-CheckedCommand {
    <#
    .SYNOPSIS
        Runs an external command and fails when it returns a nonzero exit code.
    .OUTPUTS
        System.String[].
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList
    )

    $Output = & $FilePath @ArgumentList 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath $($ArgumentList -join ' ') failed:`n$($Output -join [Environment]::NewLine)"
    }
    return $Output
}

function New-ThirdPartyNotice {
    <#
    .SYNOPSIS
        Creates a machine-readable inventory of packaged production dependencies.
    .OUTPUTS
        System.Object[].
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$LockPath
    )

    $Lock = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json -AsHashtable
    $Packages = $Lock.packages.GetEnumerator() |
        Where-Object { $_.Key -Like 'node_modules/*' -and $_.Value.dev -ne $true } |
        ForEach-Object {
            $Name = ($_.Key -Split 'node_modules/')[-1]
            [pscustomobject]@{ Name = $Name; Version = [string]$_.Value.version; License = [string]$_.Value.license }
        } |
        Sort-Object Name, Version -Unique
    return @($Packages)
}

function Copy-ThirdPartyLicense {
    <#
    .SYNOPSIS
        Copies available production dependency licence texts into the artifact.
    .OUTPUTS
        None.
    #>
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$NodeModulesPath,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Destination,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$LockPath
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $Lock = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json -AsHashtable
    $Lock.packages.GetEnumerator() |
        Where-Object { $_.Key -Like 'node_modules/*' -and $_.Value.dev -ne $true } |
        ForEach-Object {
        $Entry = $_
        $PackagePath = Join-Path (Split-Path -Parent $NodeModulesPath) $Entry.Key
        if (Test-Path -LiteralPath $PackagePath) {
            $License = Get-ChildItem -LiteralPath $PackagePath -File |
                Where-Object Name -Match '^(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$' |
                Select-Object -First 1
            if ($License) {
                $Name = ($Entry.Key -Split 'node_modules/')[-1]
                $SafeName = "$Name-$($Entry.Value.version)" -Replace '[^A-Za-z0-9._-]', '_'
                Copy-Item -LiteralPath $License.FullName -Destination (Join-Path $Destination "$SafeName-$($License.Name)") -Force
            }
        }
    }
}

function New-ReleaseArtifact {
    <#
    .SYNOPSIS
        Builds and packages one Windows artifact.
    .OUTPUTS
        System.IO.FileInfo.
    #>
    [CmdletBinding()]
    [OutputType([System.IO.FileInfo])]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Root,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Destination
    )

    Set-Location -LiteralPath $Root
    $Package = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
    $ExpectedNodeVersion = 'v24.13.1'
    $ActualNodeVersion = (& node --version).Trim()
    if ($ActualNodeVersion -ne $ExpectedNodeVersion) {
        throw "Release builds require Node $ExpectedNodeVersion; found $ActualNodeVersion"
    }
    if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
        throw 'This release script currently produces only Windows x64 artifacts.'
    }

    Invoke-CheckedCommand -FilePath 'npm' -ArgumentList @('run', 'build') | Write-Host
    Invoke-CheckedCommand -FilePath 'npm' -ArgumentList @('run', 'build:server') | Write-Host

    $ArtifactName = "fieldwork-ownership-explorer-$($Package.version)-windows-x64"
    $Stage = Join-Path $Destination $ArtifactName
    Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $Stage -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $Stage 'runtime') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Root 'dist') -Destination (Join-Path $Stage 'assets') -Recurse
    Copy-Item -LiteralPath (Join-Path $Root 'build\server') -Destination (Join-Path $Stage 'app') -Recurse
    foreach ($SourceFile in @(
        'package.json',
        'package-lock.json',
        'README.md',
        'packaging\Fieldwork Ownership Explorer.cmd',
        'packaging\launcher.cjs',
        'packaging\Install.ps1',
        'packaging\Operations.ps1',
        'packaging\Stop.ps1',
        'packaging\Uninstall.ps1'
    )) {
        Copy-Item -LiteralPath (Join-Path $Root $SourceFile) -Destination $Stage
    }
    Copy-Item -LiteralPath (Get-Command node).Source -Destination (Join-Path $Stage 'runtime\node.exe')
    Set-Content -LiteralPath (Join-Path $Stage 'runtime\VERSION.txt') -Value $ActualNodeVersion -Encoding utf8
    $NodeLicensePath = Join-Path $Stage 'runtime\LICENSE.txt'
    Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/nodejs/node/v24.13.1/LICENSE' -OutFile $NodeLicensePath
    $NodeLicenseHash = Get-FileHash -LiteralPath $NodeLicensePath -Algorithm SHA256 | Select-Object -ExpandProperty Hash
    if ($NodeLicenseHash -ne '9EF8D3FA97D90D93543EE9E2B71394DE59C09D8057625FD355D45303243527A3') {
        throw 'The downloaded Node 24.13.1 licence did not match its pinned SHA-256.'
    }
    Set-Content -LiteralPath (Join-Path $Stage 'INTERNAL-PILOT.txt') -Value 'Internal pilot build. Authenticode signing is not configured; verify SHA256SUMS.txt before installation.' -Encoding utf8

    $LockPath = Join-Path $Root 'package-lock.json'
    $Notices = New-ThirdPartyNotice -LockPath $LockPath
    $Notices | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Stage 'THIRD-PARTY-NOTICES.json') -Encoding utf8
    Copy-ThirdPartyLicense -NodeModulesPath (Join-Path $Root 'node_modules') -Destination (Join-Path $Stage 'THIRD-PARTY-LICENSES') -LockPath $LockPath

    $SbomOutput = Invoke-CheckedCommand -FilePath 'npm' -ArgumentList @('sbom', '--omit=dev', '--sbom-format', 'cyclonedx')
    $SbomOutput | Set-Content -LiteralPath (Join-Path $Stage 'sbom.cdx.json') -Encoding utf8
    $AuditOutput = & npm audit --omit=dev --audit-level=high --json 2>&1
    $AuditExit = $LASTEXITCODE
    $AuditOutput | Set-Content -LiteralPath (Join-Path $Stage 'npm-audit.json') -Encoding utf8
    if ($AuditExit -ne 0) {
        throw 'Production dependency audit reported a high or critical vulnerability.'
    }

    $ChecksumPath = Join-Path $Stage 'SHA256SUMS.txt'
    Get-ChildItem -LiteralPath $Stage -File -Recurse |
        Where-Object FullName -ne $ChecksumPath |
        ForEach-Object {
            $Relative = [IO.Path]::GetRelativePath($Stage, $_.FullName).Replace('\', '/')
            "$(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256 | Select-Object -ExpandProperty Hash)  $Relative"
        } |
        Sort-Object |
        Set-Content -LiteralPath $ChecksumPath -Encoding ascii

    $ZipPath = Join-Path $Destination "$ArtifactName.zip"
    Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
    Compress-Archive -LiteralPath $Stage -DestinationPath $ZipPath -CompressionLevel Optimal
    $ZipHash = Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256 | Select-Object -ExpandProperty Hash
    "$ZipHash  $([IO.Path]::GetFileName($ZipPath))" | Set-Content -LiteralPath "$ZipPath.sha256" -Encoding ascii
    return Get-Item -LiteralPath $ZipPath
}

#endregion Functions

#region Main Execution

if ($MyInvocation.InvocationName -ne '.') {
    try {
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
        $Artifact = New-ReleaseArtifact -Root ([IO.Path]::GetFullPath($RepoRoot)) -Destination ([IO.Path]::GetFullPath($OutputDirectory))
        Write-Host "Release artifact created: $($Artifact.FullName)" -ForegroundColor Green
        exit 0
    }
    catch {
        Write-Error -ErrorAction Continue "Release build failed: $($_.Exception.Message)"
        exit 1
    }
}

#endregion Main Execution