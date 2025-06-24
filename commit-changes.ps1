# Script to commit changes to the GitHub repository
# Repository: https://github.com/DynamicEndpoints/documentation-mcp-using-pocketbase

Write-Host "Setting up git repository and committing changes..." -ForegroundColor Green

# Navigate to the project directory
Set-Location "c:\powershell_scripts\pocketbase_document_mcp\document-extractor-mcp"

# Initialize git if not already done
if (!(Test-Path ".git")) {
    Write-Host "Initializing git repository..." -ForegroundColor Yellow
    git init
}

# Add the remote origin if not already added
$remoteExists = git remote get-url origin 2>$null
if (!$remoteExists) {
    Write-Host "Adding remote origin..." -ForegroundColor Yellow
    git remote add origin https://github.com/DynamicEndpoints/documentation-mcp-using-pocketbase.git
}

# Check current status
Write-Host "Current git status:" -ForegroundColor Cyan
git status

# Add all files (respecting .gitignore)
Write-Host "Adding files to staging area..." -ForegroundColor Yellow
git add .

# Show what will be committed
Write-Host "Files to be committed:" -ForegroundColor Cyan
git status --staged

# Commit with a descriptive message
$commitMessage = "Add document extractor MCP server with PocketBase integration

- Added MCP server implementation for document extraction and storage
- Integrated PocketBase for persistent document storage
- Added comprehensive test suite
- Configured Docker support
- Added Smithery deployment configuration
- Implemented PowerShell documentation extraction capabilities"

Write-Host "Committing changes..." -ForegroundColor Yellow
git commit -m $commitMessage

# Push to GitHub (you may need to authenticate)
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
Write-Host "Note: You may need to authenticate with GitHub" -ForegroundColor Red
git push -u origin main

Write-Host "Done! Changes have been committed and pushed to GitHub." -ForegroundColor Green
