# Git Setup and Force Push Commands
# This will overwrite the remote repository with your local changes

# 1. Navigate to project directory
Set-Location "c:\powershell_scripts\pocketbase_document_mcp\document-extractor-mcp"

# 2. Initialize git (if needed)
git init

# 3. Add remote origin (remove existing if needed)
git remote remove origin 2>$null
git remote add origin https://github.com/DynamicEndpoints/documentation-mcp-using-pocketbase.git

# 4. Check status
git status

# 5. Add ALL files (including previously ignored ones if needed)
git add -A

# 6. Commit all changes
git commit -m "Complete document extractor MCP server implementation with PocketBase integration"

# 7. Rename branch to main
git branch -M main

# 8. Force push to GitHub and overwrite remote (you'll need to authenticate)
# WARNING: This will overwrite the remote repository!
git push -u origin main --force
