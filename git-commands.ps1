# Quick Git Setup and Commit Commands
# Copy and paste these commands one by one if the full script doesn't work

# 1. Navigate to project directory
Set-Location "c:\powershell_scripts\pocketbase_document_mcp\document-extractor-mcp"

# 2. Initialize git (if needed)
git init

# 3. Add remote origin
git remote add origin https://github.com/DynamicEndpoints/documentation-mcp-using-pocketbase.git

# 4. Check status
git status

# 5. Add all files
git add .

# 6. Commit changes
git commit -m "Add document extractor MCP server with PocketBase integration"

# 7. Push to GitHub (you'll need to authenticate)
git push -u origin main
