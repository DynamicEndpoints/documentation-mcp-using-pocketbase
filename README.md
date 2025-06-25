# Document Extractor MCP Server

[![smithery badge](https://smithery.ai/badge/@DynamicEndpoints/documentation-mcp-using-pocketbase)](https://smithery.ai/server/@DynamicEndpoints/documentation-mcp-using-pocketbase)

A Model Context Protocol (MCP) server that extracts document content from Microsoft Learn and GitHub URLs, storing them in PocketBase for easy retrieval and search.

## Features

✅ **Latest MCP SDK Features (v1.12.0+)**
- Modern `McpServer` architecture with enhanced capabilities
- Multiple transport protocols: STDIO, Streamable HTTP, SSE
- Dynamic tool management with lazy loading
- Session management for stateful connections
- Server-Sent Events support with backwards compatibility
- Real-time server statistics and metrics

✅ **Content Extraction**
- Microsoft Learn articles with rich metadata
- GitHub files (README, documentation, code files)
- Intelligent content parsing and cleaning
- Duplicate detection and updates

✅ **PocketBase Integration**
- Persistent document storage
- Full-text search capabilities
- Metadata preservation
- CRUD operations

✅ **Advanced Server Features**
- Multiple transport modes (STDIO/HTTP)
- Health check and info endpoints
- Read-only mode support
- Enhanced error handling and debugging
- Resource endpoints for server metrics

✅ **Rich Metadata**
- Word counts and content statistics
- Source attribution and URLs
- Extraction timestamps
- Content headers and descriptions

## Requirements

- Node.js 18+ with ES modules support
- PocketBase server running
- Network access for content extraction

## Installation

### Installing via Smithery

To install Document Extractor for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@DynamicEndpoints/documentation-mcp-using-pocketbase):

```bash
npx -y @smithery/cli install @DynamicEndpoints/documentation-mcp-using-pocketbase --client claude
```

### 1. Install Dependencies

```powershell
# Navigate to the project directory
cd c:\powershell_scripts\pocketbase_document_mcp\document-extractor-mcp

# Install dependencies
npm install
```

### 2. PocketBase Setup

1. **Start PocketBase server:**
   ```powershell
   # Download PocketBase from https://pocketbase.io/docs/
   .\pocketbase.exe serve
   ```

2. **Collection Management (Automatic):**
   - The server will automatically create the required `documents` collection on startup
   - If `AUTO_CREATE_COLLECTION=true` (default), no manual setup needed
   - Use the `ensure_collection` tool to manually verify/create collections
   - Use the `collection_info` tool to check collection status

3. **Manual Collection Setup (if needed):**
   - Access PocketBase Admin UI (usually http://127.0.0.1:8090/_/)
   - Create a new collection named `documents`
   - Add these fields:
     ```
     title (Text, required)
     content (Text, required)
     metadata (JSON, required)
     created (Date, auto-generated)
     updated (Date, optional)
     ```

### 3. Environment Configuration

Create a `.env` file in the project root:

```env
# PocketBase Configuration
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_ADMIN_EMAIL=admin@example.com
POCKETBASE_ADMIN_PASSWORD=your-secure-password

# Collection Settings
DOCUMENTS_COLLECTION=documents

# Transport Configuration
TRANSPORT_MODE=stdio
HTTP_PORT=3000

# Development Settings
DEBUG=false
NODE_ENV=production
READ_ONLY_MODE=false

# Collection Management ✨ New!
AUTO_CREATE_COLLECTION=true
```

## Usage

### Starting the Server

The server supports multiple transport modes:

```powershell
# STDIO mode (default) - for Claude Desktop and CLI clients
npm start
# or explicitly
npm run start:stdio

# HTTP mode - for web clients and testing
npm run start:http

# Development modes with debug logging
npm run dev              # STDIO mode with debugging
npm run dev:http         # HTTP mode with debugging
npm run dev:stdio        # STDIO mode with debugging

# Test the setup
npm run test
```

### Transport Modes

#### STDIO Mode (Default)
Perfect for Claude Desktop and command-line MCP clients:
```powershell
npm start
```

#### HTTP Mode 
Enables web-based clients and testing with multiple protocols:
```powershell
npm run start:http
```

Available endpoints in HTTP mode:
- `POST /mcp` - Streamable HTTP transport (modern protocol 2025-03-26)
- `GET /sse` - Server-Sent Events transport (legacy protocol 2024-11-05)
- `POST /messages` - SSE message endpoint
- `GET /health` - Health check endpoint
- `GET /info` - Server information endpoint

### Available Tools

#### 1. `extract_document`
Extract and store content from URLs.

**Parameters:**
- `url` (string, required): Microsoft Learn or GitHub URL

**Example:**
```json
{
  "url": "https://learn.microsoft.com/en-us/azure/cognitive-services/openai/"
}
```

#### 2. `list_documents`
List stored documents with pagination.

**Parameters:**
- `limit` (number, optional): Max results per page (1-100, default: 20)
- `page` (number, optional): Page number (default: 1)

#### 3. `search_documents`
Search documents by title or content.

**Parameters:**
- `query` (string, required): Search query
- `limit` (number, optional): Max results (1-100, default: 50)

#### 4. `get_document`
Retrieve a specific document by ID.

**Parameters:**
- `id` (string, required): Document ID

#### 5. `delete_document`
Delete a document by ID.

**Parameters:**
- `id` (string, required): Document ID to delete

#### 6. `ensure_collection` ✨ New!
Check if the documents collection exists and create it if needed.

**Parameters:** None

**Description:** Automatically verifies the documents collection exists in PocketBase. If not found, creates the collection with the proper schema including all required fields and indexes.

#### 7. `collection_info` ✨ New!
Get detailed information about the documents collection including statistics.

**Parameters:** None

**Description:** Returns comprehensive collection information including schema details, record counts, indexes, and timestamps.

### Available Resources

#### 1. `stats://server`
Real-time server statistics and metrics.

**Content:**
- Total document count
- Server information (name, version, uptime)
- Memory usage statistics
- Environment information
- Read-only mode status

### Dynamic Tool Management

The server supports dynamic tool management with lazy loading:

```javascript
// Tools can be dynamically enabled/disabled
if (process.env.READ_ONLY_MODE === 'true') {
  // Write operations are disabled in read-only mode
  deleteDocumentTool.disable();
  extractDocumentTool.disable();
}

// Tools can be re-enabled at runtime
tool.enable();
```

### Session Management

In HTTP mode, the server supports session management:
- **Streamable HTTP**: Modern session management with automatic session ID generation
- **SSE (Legacy)**: Backwards compatible session handling
- **Session persistence**: Sessions are maintained across requests
- **Automatic cleanup**: Sessions are cleaned up when connections close

## Supported Sources

### Microsoft Learn
- Full article extraction
- Metadata preservation (description, keywords, author)
- Section headers extraction
- Content cleaning and formatting

**Example URLs:**
- `https://learn.microsoft.com/en-us/azure/cognitive-services/openai/`
- `https://learn.microsoft.com/en-us/dotnet/core/introduction`

### GitHub
- File content extraction (README, docs, code)
- Repository metadata
- Branch handling (main/master fallback)
- File type detection

**Supported URL formats:**
- `https://github.com/owner/repo` (assumes README.md)
- `https://github.com/owner/repo/blob/main/file.md`
- `https://raw.githubusercontent.com/owner/repo/main/file.md`

## Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POCKETBASE_URL` | PocketBase server URL | `http://127.0.0.1:8090` |
| `POCKETBASE_ADMIN_EMAIL` | Admin email for authentication | Required |
| `POCKETBASE_ADMIN_PASSWORD` | Admin password | Required |
| `DOCUMENTS_COLLECTION` | Collection name for documents | `documents` |
| `DEBUG` | Enable debug logging | `false` |
| `NODE_ENV` | Environment mode | `development` |
| `READ_ONLY_MODE` | Disable write operations | `false` |
| `AUTO_CREATE_COLLECTION` | Auto-create collections on startup | `true` |

### Debug Mode

Enable detailed logging:
```powershell
$env:DEBUG="true"; node server.js
```

Debug logs include:
- Authentication status
- Content extraction details
- Database operations
- Error context

## Error Handling

The server implements comprehensive error handling:

- **Network errors**: Timeout and connection issues
- **Authentication errors**: PocketBase connection problems
- **Validation errors**: Invalid input parameters
- **Content errors**: Extraction failures
- **Database errors**: Storage and retrieval issues

All errors are returned as structured MCP responses with appropriate error codes.

## Development

### Scripts

```powershell
# Start in development mode
npm run dev

# Start in production mode
npm start

# Install dependencies
npm run install-deps
```

### Testing the Server

```powershell
# Test basic functionality
$env:DEBUG="true"; node server.js

# In another terminal, you can test with MCP tools or:
# Use Claude Desktop with MCP configuration
# Use other MCP-compatible clients
```

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify PocketBase is running: `http://127.0.0.1:8090`
   - Check admin credentials in `.env`
   - Ensure admin user exists in PocketBase

2. **Content Extraction Errors**
   - Check network connectivity
   - Verify URL accessibility
   - Review debug logs for details

3. **Collection Not Found**
   - Use the `ensure_collection` tool to automatically create the collection
   - Check collection name in environment variables
   - Verify `AUTO_CREATE_COLLECTION` is enabled
   - Check collection permissions

4. **Module Import Errors**
   - Ensure `"type": "module"` in package.json
   - Use Node.js 18+ with ES modules support
   - Check all dependencies are installed

### Debug Information

Enable debug mode to see detailed logs:
```powershell
$env:DEBUG="true"; node server.js
```

### PocketBase Collection Schema

If you need to recreate the collection, use this schema:

```javascript
{
  "name": "documents",
  "type": "base",
  "schema": [
    {
      "name": "title",
      "type": "text",
      "required": true,
      "options": {
        "max": 255
      }
    },
    {
      "name": "content",
      "type": "text",
      "required": true
    },
    {
      "name": "metadata",
      "type": "json",
      "required": true
    },
    {
      "name": "created",
      "type": "date",
      "required": false
    },
    {
      "name": "updated",
      "type": "date",
      "required": false
    }
  ]
}
```

## MCP Client Configuration

### Claude Desktop Configuration

Add this to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "document-extractor": {
      "command": "node",
      "args": ["c:\\powershell_scripts\\pocketbase_document_mcp\\document-extractor-mcp\\server.js"],
      "env": {
        "POCKETBASE_URL": "http://127.0.0.1:8090",
        "POCKETBASE_ADMIN_EMAIL": "your-admin@example.com",
        "POCKETBASE_ADMIN_PASSWORD": "your-password",
        "DEBUG": "false"
      }
    }
  }
}
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Changelog

### v1.1.0 ✨ Latest Update
- **Latest MCP SDK v1.13.1+**: Upgraded to the newest Model Context Protocol SDK
- **Latest PocketBase SDK v0.26.1+**: Updated to the latest PocketBase features
- **Collection Management Tools**: Added `ensure_collection` and `collection_info` tools
- **Auto-Collection Creation**: Automatic database schema setup on startup
- **Enhanced Lazy Loading**: Improved dynamic tool management
- **Latest SSE Features**: Modern Server-Sent Events implementation
- **Improved Error Handling**: Better collection management error recovery
- **Enhanced Documentation**: Comprehensive usage examples and troubleshooting

### v1.0.0
- Updated to latest Anthropic MCP SDK
- Added comprehensive error handling
- Implemented input validation with Zod
- Enhanced metadata extraction
- Added debug logging
- Improved documentation
- Added PocketBase integration
- Support for Microsoft Learn and GitHub

## Deployment

### Smithery Deployment

This MCP server supports deployment on [Smithery](https://smithery.ai), a platform for hosting MCP servers.

#### TypeScript Deploy (Recommended)

The fastest way to deploy this server on Smithery:

1. **Fork or Clone** this repository to your GitHub account
2. **Connect GitHub** to Smithery (or claim your server if already listed)
3. **Navigate** to the Deployments tab on your server page
4. **Click Deploy** - Smithery will automatically build and host your server

The `smithery.yaml` file is already configured for TypeScript/Node.js deployment.

**Note**: Despite being called "TypeScript Deploy", this method works perfectly for Node.js projects with ES modules.

#### Custom Deploy (Docker)

For advanced deployment with full Docker control:

1. **Replace smithery.yaml** with the container configuration:
   ```bash
   cp smithery-container.yaml smithery.yaml
   ```
2. **Push to GitHub** with the updated configuration
3. **Deploy** via Smithery's Deployments tab

The `Dockerfile` is optimized for production deployment with security best practices.

#### Configuration

When deploying on Smithery, you'll configure:

- **PocketBase URL**: Your PocketBase instance URL
- **Admin Credentials**: Email and password for PocketBase admin
- **Collection Settings**: Default collection name and auto-creation
- **Debug Mode**: Enable detailed logging (optional)

#### Best Practices for Smithery

- **Tool Discovery**: All tools are available without authentication for discovery
- **Lazy Authentication**: API validation occurs only when tools are invoked
- **Environment Variables**: Configuration is handled via Smithery's config schema
- **Health Checks**: Built-in health monitoring at `/health` endpoint
