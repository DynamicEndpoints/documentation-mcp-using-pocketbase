# Lazy Loading Implementation

This MCP server implements **lazy loading of configurations** as required by Smithery for optimal deployment performance.

## 🎯 Smithery Requirements

As per [Smithery documentation](https://smithery.ai/docs/build/deployments#tool-lists), servers should perform lazy loading of configurations to ensure fast discovery and deployment.

## 🔧 Implementation Details

### Before (Eager Loading)
```javascript
// ❌ Configurations loaded immediately at startup
const pb = new PocketBase(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090');
const DOCUMENTS_COLLECTION = process.env.DOCUMENTS_COLLECTION || 'documents';
const DEBUG = process.env.DEBUG === 'true';
```

### After (Lazy Loading) ✅
```javascript
// ✅ Configurations loaded only when needed
let pb = null;
let DOCUMENTS_COLLECTION = null;
let DEBUG = null;
let configInitialized = false;

function initializeConfig() {
  if (configInitialized) return;
  
  pb = new PocketBase(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090');
  DOCUMENTS_COLLECTION = process.env.DOCUMENTS_COLLECTION || 'documents';
  DEBUG = process.env.DEBUG === 'true';
  configInitialized = true;
}
```

## 🚀 Benefits

1. **Fast Startup**: Server starts immediately without waiting for PocketBase connection
2. **Discovery Mode**: Works during Smithery discovery even without credentials
3. **Dynamic Configuration**: Can accept Smithery query parameters at runtime
4. **Resource Efficient**: Only initializes what's needed when needed

## 🔄 Lazy Loading Points

### 1. Tool Invocation
Configurations are loaded when tools are first called:
```javascript
async ({ url }) => {
  // Validate authentication when tool is actually invoked
  const canAuth = await tryAuthenticatePocketBase();
  if (!canAuth) {
    throw new Error('PocketBase authentication required.');
  }
  // ... rest of tool logic
}
```

### 2. HTTP Endpoints
Configurations loaded on first HTTP request:
```javascript
app.all('/mcp', async (req, res) => {
  if (Object.keys(req.query).length > 0) {
    const smitheryConfig = parseSmitheryConfig(req.query);
    applySmitheryConfig(smitheryConfig);
    // Force reinitialize with new settings
    configInitialized = false;
    initializeConfig();
  }
  // ... handle request
});
```

### 3. Resource Access
Configurations loaded when resources are accessed:
```javascript
async (uri) => {
  await authenticatePocketBase();
  if (!DOCUMENTS_COLLECTION) {
    initializeConfig();
  }
  // ... access resource
}
```

## 🧪 Testing

Run the lazy loading test:
```bash
node test-lazy-loading.js
```

This test verifies:
- Server starts without attempting PocketBase connection
- No authentication errors during startup
- Configurations are only loaded when tools are invoked

## 📋 Checklist

- ✅ Server starts without configuration loading
- ✅ PocketBase connection is lazy
- ✅ Environment variables read on-demand
- ✅ Smithery query parameters supported
- ✅ All tools work with lazy loading
- ✅ HTTP endpoints support lazy loading
- ✅ Resources support lazy loading
- ✅ Test coverage for lazy loading

## 🔗 References

- [Smithery Deployment Documentation](https://smithery.ai/docs/build/deployments#tool-lists)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/)
