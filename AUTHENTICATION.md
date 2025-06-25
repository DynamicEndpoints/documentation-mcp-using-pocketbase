# PocketBase Authentication Improvements

This document outlines the authentication improvements made to the MCP server based on PocketBase best practices from the official documentation.

## Key Changes Made

### 1. Modern Authentication Method
- **Before**: `pb.admins.authWithPassword()` (deprecated)
- **After**: `pb.collection('_superusers').authWithPassword()` (current standard)

### 2. Improved Error Handling
- Better error messages with specific troubleshooting steps
- Status code-specific error handling (400, 401, 404, etc.)
- Network connectivity error detection

### 3. Token Refresh Implementation
- Automatic token refresh using `pb.collection('_superusers').authRefresh()`
- Proper handling of expired tokens
- Auth store validation before making requests

### 4. Enhanced Authentication Tool
The `authenticate` tool now provides:
- Comprehensive server health checking
- Detailed collection information
- Better error diagnostics
- Step-by-step troubleshooting guides

### 5. Connection Status Tool
New features include:
- Real-time connection status monitoring
- Documents collection existence checking
- Server statistics and health information
- Available tools documentation

## Authentication Flow

```javascript
// 1. Initialize PocketBase client
const pb = new PocketBase('http://127.0.0.1:8090');

// 2. Authenticate as superuser (modern method)
const authData = await pb.collection('_superusers').authWithPassword(email, password);

// 3. Check authentication status
console.log(pb.authStore.isValid); // true
console.log(pb.authStore.token);   // JWT token
console.log(pb.authStore.record);  // User record

// 4. Refresh token when needed
await pb.collection('_superusers').authRefresh();

// 5. Clear authentication
pb.authStore.clear();
```

## Best Practices Implemented

1. **Lazy Loading**: Authentication only occurs when tools are invoked
2. **Error Resilience**: Comprehensive error handling with retry logic
3. **Security**: Passwords never logged or exposed in responses
4. **Modern APIs**: Using latest PocketBase SDK methods
5. **Health Monitoring**: Regular health checks and connection validation

## Tools Available

### Core Tools
- `authenticate`: Test and setup PocketBase credentials
- `connection_status`: Check current connection status
- `ensure_collection`: Create documents collection if needed
- `collection_info`: Get detailed collection statistics

### Document Management
- `extract_document`: Extract content from Microsoft Learn/GitHub URLs
- `list_documents`: List stored documents with pagination
- `search_documents`: Full-text search through document content
- `get_document`: Retrieve specific document by ID
- `delete_document`: Remove document from storage

## Error Handling

The server now provides specific error messages for common issues:

- **Invalid Credentials**: Clear guidance on credential verification
- **Connection Issues**: Network and URL troubleshooting
- **Server Not Found**: PocketBase server accessibility checks
- **Missing Collections**: Automatic collection creation suggestions

## Testing

Run the authentication test to verify proper implementation:

```bash
node test-auth-improvements.js
```

This test verifies:
- Modern authentication methods are available
- Auth store management works correctly
- Health checks function properly
- Collections are properly protected
- Token refresh capabilities exist

## Migration Notes

If upgrading from an older version:

1. **Admin Authentication**: Replace `pb.admins.authWithPassword()` with `pb.collection('_superusers').authWithPassword()`
2. **Token Refresh**: Replace `pb.admins.refresh()` with `pb.collection('_superusers').authRefresh()`
3. **Auth Store**: Use `pb.authStore.record` instead of `pb.authStore.model`

## Troubleshooting

### Common Issues

1. **"Admin user not found"**
   - Ensure admin account exists in PocketBase
   - Check email address spelling
   - Verify admin privileges

2. **"Cannot connect to server"**
   - Verify PocketBase is running
   - Check URL format (include http:// or https://)
   - Ensure no firewall blocking

3. **"Invalid credentials"**
   - Double-check email and password
   - Verify account has admin privileges
   - Try logging in through PocketBase admin UI

### Getting Help

1. Use the `connection_status` tool to diagnose issues
2. Use the `authenticate` tool to test credentials
3. Check PocketBase logs for server-side errors
4. Verify PocketBase version compatibility (v0.23.0+)

## References

- [PocketBase JavaScript SDK](https://github.com/pocketbase/js-sdk)
- [PocketBase Authentication Guide](https://pocketbase.io/docs/authentication)
- [MCP Server Development](https://modelcontextprotocol.io/docs)
- [Smithery Deployment](https://smithery.ai/docs/build/deployments)
