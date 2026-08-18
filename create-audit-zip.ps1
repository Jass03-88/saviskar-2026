# Create the audit zip
$zipName = "saviskar-2026-audit.zip"

if (Test-Path $zipName) {
    Remove-Item $zipName
}

# Compress the directory excluding the specified folders
Compress-Archive -Path ".\*" -DestinationPath $zipName -Update

# We can't natively exclude with Compress-Archive easily, so it's better to use 7z if available, or just copy to a temp folder first.
$tempDir = New-Item -ItemType Directory -Path ".\temp-audit-zip" -Force

# Copy files, excluding the unwanted directories
Get-ChildItem -Path . -Exclude "node_modules", ".next", ".vercel", ".git", ".env*", "temp-audit-zip", "*.zip" | Copy-Item -Destination $tempDir -Recurse

# Exclude supabase/.temp manually
if (Test-Path "$tempDir\supabase\.temp") {
    Remove-Item -Recurse -Force "$tempDir\supabase\.temp"
}

# Create the zip
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipName -Force

# Clean up
Remove-Item -Recurse -Force $tempDir

Write-Host "Created $zipName successfully!"
