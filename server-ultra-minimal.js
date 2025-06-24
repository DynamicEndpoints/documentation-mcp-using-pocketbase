#!/usr/bin/env node

/**
 * Ultra-minimal MCP server for testing Smithery deployment
 * This version has NO configuration dependencies during startup
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Create server
const server = new McpServer({
  name: 'document-extractor-mcp',
  version: '1.0.0',
});

// Register tools that defer ALL configuration access until invocation
server.tool(
  'extract_document',
  'Extract document content from Microsoft Learn or GitHub URL and store in PocketBase',
  {
    url: z.string().url('Invalid URL format').describe('Microsoft Learn or GitHub URL to extract content from')
  },
  async ({ url }) => {
    try {
      // Only NOW check for configuration
      if (!process.env.POCKETBASE_EMAIL && !process.env.POCKETBASE_ADMIN_EMAIL) {
        throw new Error('PocketBase authentication required. Please configure pocketbaseEmail and pocketbasePassword.');
      }
      
      // Lazy load the actual implementation
      const { default: mainServer } = await import('./src/index.js');
      // This would call the actual extraction logic...
      
      return {
        content: [{
          type: 'text',
          text: `✅ Would extract document from: ${url}\n(Lazy loading - configuration accessed only when tool is invoked)`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  'list_documents',
  'List stored documents from PocketBase with pagination',
  {
    limit: z.number().min(1).max(100).optional().default(20).describe('Maximum number of documents to return'),
    page: z.number().min(1).optional().default(1).describe('Page number for pagination')
  },
  async ({ limit = 20, page = 1 }) => {
    try {
      if (!process.env.POCKETBASE_EMAIL && !process.env.POCKETBASE_ADMIN_EMAIL) {
        throw new Error('PocketBase authentication required. Please configure pocketbaseEmail and pocketbasePassword.');
      }
      
      return {
        content: [{
          type: 'text',
          text: `✅ Would list documents (limit: ${limit}, page: ${page})\n(Lazy loading - configuration accessed only when tool is invoked)`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error: ${error.message}`
        }],
        isError: true
      };
    }
  }
);

// Start server
async function main() {
  try {
    console.error('🚀 Starting ultra-minimal MCP server with perfect lazy loading...');
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('✅ Server started successfully - NO configuration accessed during startup');
    console.error('⚡ All configurations will be loaded lazily when tools are invoked');
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
