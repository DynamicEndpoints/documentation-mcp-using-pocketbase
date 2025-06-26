#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import PocketBase from 'pocketbase';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { z } from 'zod';
import express from 'express';
import { randomUUID } from 'node:crypto';

// --- LAZY LOADING IMPLEMENTATION ---
// All configurations are deferred until actually needed

let pb = null;
let DOCUMENTS_COLLECTION = null;
let DEBUG = null;
let HTTP_PORT = null;
let READ_ONLY_MODE = false;
let configInitialized = false;
let isAuthenticated = false;

function debugLog(message, data = null) {
  // Safe early debug logging without initialization
  const isDebug = process.env.DEBUG === 'true' || DEBUG;
  if (isDebug) {
    console.error(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

function initializeConfig() {
  if (configInitialized) return;
  
  // Load environment variables only when needed
  dotenv.config();
  
  pb = new PocketBase(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090');
  DOCUMENTS_COLLECTION = process.env.DOCUMENTS_COLLECTION || 'documents';
  DEBUG = process.env.DEBUG === 'true';
  READ_ONLY_MODE = process.env.READ_ONLY_MODE === 'true';
  HTTP_PORT = process.env.PORT || process.env.HTTP_PORT || 3000;
  
  configInitialized = true;
  debugLog('Configuration initialized lazily');
}

async function authenticateWhenNeeded() {
  initializeConfig();

  if (isAuthenticated && pb.authStore.isValid) {
    return;
  }

  try {
    const email = process.env.POCKETBASE_EMAIL || process.env.POCKETBASE_ADMIN_EMAIL;
    const password = process.env.POCKETBASE_PASSWORD || process.env.POCKETBASE_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error('PocketBase authentication credentials are not configured. Please provide POCKETBASE_EMAIL and POCKETBASE_PASSWORD.');
    }

    await pb.admins.authWithPassword(email, password);
    isAuthenticated = true;
    debugLog('✅ Authenticated with PocketBase');
  } catch (error) {
    isAuthenticated = false;
    console.error('❌ PocketBase authentication failed:', error.message);
    throw new Error(`PocketBase authentication failed: ${error.message}`);
  }
}

// Parse Smithery configuration from query parameters
function parseSmitheryConfig(query) {
  const config = {};
  for (const [key, value] of Object.entries(query)) {
    const keys = key.split('.');
    let current = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  }
  return config;
}

// Apply Smithery configuration
function applySmitheryConfig(config) {
  if (config.pocketbaseUrl) process.env.POCKETBASE_URL = config.pocketbaseUrl;
  if (config.pocketbaseEmail) process.env.POCKETBASE_EMAIL = config.pocketbaseEmail;
  if (config.pocketbasePassword) process.env.POCKETBASE_PASSWORD = config.pocketbasePassword;
  if (config.defaultCollection) process.env.DOCUMENTS_COLLECTION = config.defaultCollection;
  if (config.debugMode !== undefined) process.env.DEBUG = config.debugMode.toString();
  
  // Force re-initialization with new config
  configInitialized = false;
  isAuthenticated = false;
  debugLog('Applied Smithery configuration, forcing re-initialization');
}

// Collection schema
function getDocumentsCollectionSchema() {
  initializeConfig();
  return {
    name: DOCUMENTS_COLLECTION,
    type: 'base',
    schema: [
      { name: 'title', type: 'text', required: true, options: { max: 255 } },
      { name: 'content', type: 'text', required: true, options: {} },
      { name: 'metadata', type: 'json', required: false, options: {} },
      { name: 'created', type: 'date', required: false, options: {} },
      { name: 'updated', type: 'date', required: false, options: {} }
    ],
    indexes: [
      'CREATE INDEX idx_documents_title ON documents (title)',
      'CREATE INDEX idx_documents_created ON documents (created)',
      'CREATE INDEX idx_documents_metadata_url ON documents (json_extract(metadata, "$.url"))'
    ]
  };
}

// Ensure collection exists
async function ensureCollectionExists() {
  await authenticateWhenNeeded();
  try {
    const collection = await pb.collections.getOne(DOCUMENTS_COLLECTION);
    debugLog('✅ Collection exists', { name: DOCUMENTS_COLLECTION, id: collection.id });
    return { exists: true, collection, created: false };
  } catch (error) {
    if (error.status === 404) {
      debugLog('📝 Creating collection', { name: DOCUMENTS_COLLECTION });
      const newCollection = await pb.collections.create(getDocumentsCollectionSchema());
      debugLog('✅ Collection created successfully', { name: DOCUMENTS_COLLECTION, id: newCollection.id });
      return { exists: true, collection: newCollection, created: true };
    } else {
      throw error;
    }
  }
}

// Get collection info
async function getCollectionInfo() {
  await authenticateWhenNeeded();
  try {
    const collection = await pb.collections.getOne(DOCUMENTS_COLLECTION);
    const stats = await pb.collection(DOCUMENTS_COLLECTION).getList(1, 1);
    return {
      collection,
      totalRecords: stats.totalItems,
      recordsPerPage: stats.perPage,
      totalPages: stats.totalPages
    };
  } catch (error) {
    debugLog('❌ Error getting collection info', { error: error.message });
    throw new Error(`Failed to get collection info: ${error.message}`);
  }
}

// Extract from Microsoft Learn
async function extractFromMicrosoftLearn(url) {
  try {
    debugLog('Extracting from Microsoft Learn', { url });
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 30000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract title with fallbacks
    const title = $('h1').first().text().trim() || 
                  $('[data-bi-name="title"]').text().trim() || 
                  $('.content h1').first().text().trim() ||
                  $('title').text().trim() ||
                  'Untitled Microsoft Learn Document';
    
    // Extract main content
    let content = '';
    const contentSelectors = [
      '[data-bi-name="content"]',
      '.content',
      'main article',
      '.markdown-body',
      'main .content',
      'article',
      'main'
    ];
    
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        content = element.text().trim();
        if (content.length > 100) break;
      }
    }
    
    content = content.replace(/\s+/g, ' ').trim();
    
    if (!content || content.length < 50) {
      throw new Error('Insufficient content extracted from the page');
    }
    
    // Extract metadata
    const description = $('meta[name="description"]').attr('content') || '';
    const keywords = $('meta[name="keywords"]').attr('content') || '';
    const author = $('meta[name="author"]').attr('content') || '';
    
    const headers = [];
    $('h2, h3').each((i, el) => {
      const headerText = $(el).text().trim();
      if (headerText && headerText.length > 0) {
        headers.push({
          level: el.tagName.toLowerCase(),
          text: headerText
        });
      }
    });
    
    const metadata = {
      source: 'Microsoft Learn',
      url,
      originalUrl: url,
      extractedAt: new Date().toISOString(),
      wordCount: content.split(' ').filter(word => word.length > 0).length,
      description,
      keywords,
      author,
      headers: headers.slice(0, 10),
      contentLength: content.length,
      domain: 'learn.microsoft.com'
    };
    
    return {
      title: title.substring(0, 255),
      content,
      metadata
    };
  } catch (error) {
    debugLog('Error extracting from Microsoft Learn', { error: error.message, url });
    throw new Error(`Failed to extract from Microsoft Learn: ${error.message}`);
  }
}

// Extract from GitHub
async function extractFromGitHub(url) {
  try {
    debugLog('Extracting from GitHub', { url });
    
    let rawUrl;
    if (url.includes('/blob/')) {
      rawUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    } else if (url.includes('/tree/')) {
      throw new Error('Directory URLs not supported. Please provide a direct file link.');
    } else if (url.includes('raw.githubusercontent.com')) {
      rawUrl = url;
    } else {
      const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (match) {
        const [, owner, repo] = match;
        rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
      } else {
        throw new Error('Invalid GitHub URL format');
      }
    }
    
    const response = await fetch(rawUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/plain,text/markdown,text/*,*/*;q=0.8'
      },
      timeout: 30000
    });
    
    if (!response.ok) {
      if (rawUrl.includes('/main/')) {
        const masterUrl = rawUrl.replace('/main/', '/master/');
        const masterResponse = await fetch(masterUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (masterResponse.ok) {
          const content = await masterResponse.text();
          rawUrl = masterUrl;
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }
    
    const content = await response.text();
    
    if (!content || content.trim().length === 0) {
      throw new Error('No content found in the GitHub file');
    }
    
    const filename = rawUrl.split('/').pop() || 'GitHub Document';
    const title = filename.replace(/\.[^/.]+$/, '');
    
    const repoMatch = rawUrl.match(/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)/);
    const [, owner, repo] = repoMatch || [];
    
    const metadata = {
      source: 'GitHub',
      url,
      rawUrl,
      extractedAt: new Date().toISOString(),
      repository: owner && repo ? `${owner}/${repo}` : 'Unknown',
      filename,
      fileType: filename.includes('.') ? filename.split('.').pop().toLowerCase() : 'unknown',
      wordCount: content.split(' ').filter(word => word.length > 0).length,
      contentLength: content.length,
      domain: 'github.com'
    };
    
    return {
      title: title.substring(0, 255),
      content,
      metadata
    };
  } catch (error) {
    debugLog('Error extracting from GitHub', { error: error.message, url });
    throw new Error(`Failed to extract from GitHub: ${error.message}`);
  }
}

// Store document
async function storeDocument(docData) {
  await authenticateWhenNeeded();
  try {
    const existingDocs = await pb.collection(DOCUMENTS_COLLECTION).getList(1, 1, {
      filter: `metadata.url = "${docData.metadata.url}"`
    });
    
    if (existingDocs.items.length > 0) {
      const record = await pb.collection(DOCUMENTS_COLLECTION).update(existingDocs.items[0].id, {
        title: docData.title,
        content: docData.content,
        metadata: docData.metadata,
        updated: new Date().toISOString()
      });
      debugLog('Document updated in PocketBase', { id: record.id });
      return { ...record, isUpdate: true };
    } else {
      const record = await pb.collection(DOCUMENTS_COLLECTION).create({
        title: docData.title,
        content: docData.content,
        metadata: docData.metadata,
        created: new Date().toISOString()
      });
      debugLog('Document created in PocketBase', { id: record.id });
      return { ...record, isUpdate: false };
    }
  } catch (error) {
    debugLog('Error storing document', { error: error.message });
    throw new Error(`Failed to store document: ${error.message}`);
  }
}

// Get documents
async function getDocuments(limit = 50, page = 1) {
  await authenticateWhenNeeded();
  try {
    const records = await pb.collection(DOCUMENTS_COLLECTION).getList(page, limit, {
      sort: '-created',
      fields: 'id,title,metadata,created,updated'
    });
    debugLog('Documents retrieved from PocketBase', { count: records.items.length });
    return records;
  } catch (error) {
    debugLog('Error getting documents', { error: error.message });
    throw new Error(`Failed to retrieve documents: ${error.message}`);
  }
}

// Search documents
async function searchDocuments(query, limit = 50) {
  await authenticateWhenNeeded();
  try {
    const records = await pb.collection(DOCUMENTS_COLLECTION).getList(1, limit, {
      filter: `title ~ "${query}" || content ~ "${query}"`,
      sort: '-created'
    });
    debugLog('Documents searched in PocketBase', { query, count: records.items.length });
    return records;
  } catch (error) {
    debugLog('Error searching documents', { error: error.message });
    throw new Error(`Failed to search documents: ${error.message}`);
  }
}

// Get single document
async function getDocument(id) {
  await authenticateWhenNeeded();
  try {
    const doc = await pb.collection(DOCUMENTS_COLLECTION).getOne(id);
    debugLog('Document retrieved from PocketBase', { id });
    return doc;
  } catch (error) {
    debugLog('Error getting document', { error: error.message, id });
    throw new Error(`Failed to retrieve document: ${error.message}`);
  }
}

// Delete document
async function deleteDocument(id) {
  await authenticateWhenNeeded();
  try {
    await pb.collection(DOCUMENTS_COLLECTION).delete(id);
    debugLog('Document deleted from PocketBase', { id });
    return true;
  } catch (error) {
    debugLog('Error deleting document', { error: error.message, id });
    throw new Error(`Failed to delete document: ${error.message}`);
  }
}

// Create MCP server
function createServer() {
  const server = new McpServer({
    name: 'document-extractor-mcp',
    version: '1.0.0',
  });

  // Error handler for tools
  const toolErrorHandler = (error) => ({
    content: [{ type: 'text', text: `❌ Error: ${error.message}` }],
    isError: true
  });

  // Extract document tool
  server.tool(
    'extract_document',
    'Extract document content from Microsoft Learn or GitHub URL and store in PocketBase',
    {
      url: z.string().url('Invalid URL format').describe('Microsoft Learn or GitHub URL to extract content from')
    },
    async ({ url }) => {
      try {
        await authenticateWhenNeeded();
        
        let docData;
        if (url.includes('learn.microsoft.com')) {
          docData = await extractFromMicrosoftLearn(url);
        } else if (url.includes('github.com') || url.includes('raw.githubusercontent.com')) {
          docData = await extractFromGitHub(url);
        } else {
          throw new Error('Unsupported URL. Only Microsoft Learn and GitHub URLs are supported.');
        }
        
        const record = await storeDocument(docData);
        
        return {
          content: [{
            type: 'text',
            text: `${record.isUpdate ? '🔄 Document updated' : '✅ Document extracted and stored'} successfully!\n\n` +
                  `**Title:** ${record.title}\n` +
                  `**ID:** ${record.id}\n` +
                  `**Source:** ${docData.metadata.source}\n` +
                  `**URL:** ${docData.metadata.url}\n` +
                  `**Word Count:** ${docData.metadata.wordCount}\n` +
                  `**Content Preview:** ${docData.content.substring(0, 200)}...`
          }]
        };
      } catch (error) {
        return toolErrorHandler(error);
      }
    }
  );

  // List documents tool
  server.tool(
    'list_documents',
    'List stored documents from PocketBase with pagination',
    {
      limit: z.number().min(1).max(100).optional().default(20).describe('Maximum number of documents to return (default: 20, max: 100)'),
      page: z.number().min(1).optional().default(1).describe('Page number for pagination (default: 1)')
    },
    async ({ limit = 20, page = 1 }) => {
      try {
        await authenticateWhenNeeded();
        
        const result = await getDocuments(limit, page);
        
        if (result.items.length === 0) {
          return {
            content: [{ type: 'text', text: '📚 No documents found in the database.' }]
          };
        }
        
        const documentList = result.items.map(doc => 
          `**${doc.title}** (ID: ${doc.id})\n` +
          `Source: ${doc.metadata?.source || 'Unknown'}\n` +
          `Domain: ${doc.metadata?.domain || 'Unknown'}\n` +
          `Created: ${new Date(doc.created).toLocaleString()}\n` +
          `${doc.updated ? `Updated: ${new Date(doc.updated).toLocaleString()}\n` : ''}` +
          `${doc.metadata?.url ? `URL: ${doc.metadata.url}\n` : ''}`
        ).join('\n---\n');
        
        return {
          content: [{
            type: 'text',
            text: `📚 Found ${result.items.length} documents (Page ${page} of ${Math.ceil(result.totalItems / limit)}):\n` +
                  `Total: ${result.totalItems} documents\n\n${documentList}`
          }]
        };
      } catch (error) {
        return toolErrorHandler(error);
      }
    }
  );

  // Search documents tool
  server.tool(
    'search_documents',
    'Search documents by title or content using full-text search',
    {
      query: z.string().min(1, 'Query cannot be empty').describe('Search query to find documents (searches title and content)'),
      limit: z.number().min(1).max(100).optional().default(50).describe('Maximum number of results to return (default: 50)')
    },
    async ({ query, limit = 50 }) => {
      try {
        await authenticateWhenNeeded();
        
        const result = await searchDocuments(query, limit);
        
        if (result.items.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `🔍 No documents found matching "${query}"`
            }]
          };
        }
        
        const searchResults = result.items.map(doc => 
          `**${doc.title}** (ID: ${doc.id})\n` +
          `Source: ${doc.metadata?.source || 'Unknown'}\n` +
          `Domain: ${doc.metadata?.domain || 'Unknown'}\n` +
          `Created: ${new Date(doc.created).toLocaleString()}\n` +
          `${doc.metadata?.url ? `URL: ${doc.metadata.url}\n` : ''}` +
          `Preview: ${doc.content.substring(0, 150)}...\n`
        ).join('\n---\n');
        
        return {
          content: [{
            type: 'text',
            text: `🔍 Found ${result.items.length} documents matching "${query}":\n\n${searchResults}`
          }]
        };
      } catch (error) {
        return toolErrorHandler(error);
      }
    }
  );

  // Get document tool
  server.tool(
    'get_document',
    'Get a specific document by ID with full content',
    {
      id: z.string().min(1, 'Document ID is required').describe('Document ID to retrieve')
    },
    async ({ id }) => {
      try {
        await authenticateWhenNeeded();
        
        const doc = await getDocument(id);
        
        return {
          content: [{
            type: 'text',
            text: `📄 **${doc.title}**\n\n` +
                  `**ID:** ${doc.id}\n` +
                  `**Source:** ${doc.metadata?.source || 'Unknown'}\n` +
                  `**Domain:** ${doc.metadata?.domain || 'Unknown'}\n` +
                  `**Word Count:** ${doc.metadata?.wordCount || 'Unknown'}\n` +
                  `**Created:** ${new Date(doc.created).toLocaleString()}\n` +
                  `${doc.updated ? `**Updated:** ${new Date(doc.updated).toLocaleString()}\n` : ''}` +
                  `**URL:** ${doc.metadata?.url || 'N/A'}\n` +
                  `${doc.metadata?.description ? `**Description:** ${doc.metadata.description}\n` : ''}` +
                  `\n**Content:**\n${doc.content}`
          }]
        };
      } catch (error) {
        return toolErrorHandler(error);
      }
    }
  );

  // Delete document tool
  server.tool(
    'delete_document',
    'Delete a document from PocketBase by ID',
    {
      id: z.string().min(1, 'Document ID is required').describe('Document ID to delete')
    },
    async ({ id }) => {
      try {
        await authenticateWhenNeeded();
        
        await deleteDocument(id);
        
        return {
          content: [{
            type: 'text',
            text: `🗑️ Document with ID "${id}" has been deleted successfully.`
          }]
        };
      } catch (error) {
        return toolErrorHandler(error);
      }
    }
  );

  // Ensure collection tool
  server.tool(
    'ensure_collection',
    'Check if the documents collection exists and create it if needed',
    {},
    async () => {
      try {
        await authenticateWhenNeeded();
        
        const result = await ensureCollectionExists();
        
        return {
          content: [{
            type: 'text',
            text: result.created 
              ? `✅ Documents collection "${DOCUMENTS_COLLECTION}" created successfully!\n\n` +
                `**Collection Details:**\n` +
                `- ID: ${result.collection.id}\n` +
                `- Name: ${result.collection.name}\n` +
                `- Type: ${result.collection.type}\n` +
                `- Schema Fields: ${result.collection.schema?.length || 0}\n` +
                `- Created: ${new Date(result.collection.created).toLocaleString()}`
              : `✅ Documents collection "${DOCUMENTS_COLLECTION}" already exists.\n\n` +
                `**Collection Details:**\n` +
                `- ID: ${result.collection.id}\n` +
                `- Name: ${result.collection.name}\n` +
                `- Type: ${result.collection.type}\n` +
                `- Schema Fields: ${result.collection.schema?.length || 0}\n` +
                `- Created: ${new Date(result.collection.created).toLocaleString()}`
          }]
        };
      } catch (error) {
        return toolErrorHandler(error);
      }
    }
  );

  // Collection info tool
  server.tool(
    'collection_info',
    'Get detailed information about the documents collection including statistics',
    {},
    async () => {
      try {
        await authenticateWhenNeeded();
        
        const info = await getCollectionInfo();
        
        const schemaInfo = info.collection.schema?.map(field => 
          `- **${field.name}** (${field.type})${field.required ? ' *required*' : ''}`
        ).join('\n') || 'No schema information available';
        
        return {
          content: [{
            type: 'text',
            text: `📊 **Collection Information: ${info.collection.name}**\n\n` +
                  `**Basic Details:**\n` +
                  `- ID: ${info.collection.id}\n` +
                  `- Name: ${info.collection.name}\n` +
                  `- Type: ${info.collection.type}\n` +
                  `- Created: ${new Date(info.collection.created).toLocaleString()}\n` +
                  `- Updated: ${new Date(info.collection.updated).toLocaleString()}\n\n` +
                  `**Statistics:**\n` +
                  `- Total Records: ${info.totalRecords}\n` +
                  `- Total Pages: ${info.totalPages}\n` +
                  `- Records Per Page: ${info.recordsPerPage}\n\n` +
                  `**Schema Fields:**\n${schemaInfo}\n\n` +
                  `**Indexes:**\n${info.collection.indexes?.length ? 
                    info.collection.indexes.map(idx => `- ${idx}`).join('\n') : 
                    'No custom indexes defined'}`
          }]
        };
      } catch (error) {
        return toolErrorHandler(error);
      }
    }
  );

  return server;
}

// HTTP Server for Streamable HTTP and SSE support
function createHttpServer() {
  initializeConfig(); // Only initialize when HTTP server is needed
  
  const app = express();
  app.use(express.json());

  // Store transports for each session type
  const transports = {
    streamable: {},
    sse: {}
  };

  // Modern Streamable HTTP endpoint
  app.all('/mcp', async (req, res) => {
    try {
      // Handle Smithery configuration via query parameters
      if (Object.keys(req.query).length > 0) {
        const smitheryConfig = parseSmitheryConfig(req.query);
        applySmitheryConfig(smitheryConfig);
        debugLog('Applied Smithery configuration', smitheryConfig);
      }
      
      const sessionId = req.headers['mcp-session-id'];
      let transport;

      if (sessionId && transports.streamable[sessionId]) {
        transport = transports.streamable[sessionId];
      } else {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.streamable[sid] = transport;
            debugLog('New Streamable HTTP session created', { sessionId: sid });
          }
        });
        
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports.streamable[transport.sessionId];
            debugLog('Streamable HTTP session closed', { sessionId: transport.sessionId });
          }
        };
        
        const server = createServer();
        await server.connect(transport);
      }
      
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling Streamable HTTP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  });

  // Legacy SSE endpoint
  app.get('/sse', async (req, res) => {
    try {
      const transport = new SSEServerTransport('/messages', res);
      transports.sse[transport.sessionId] = transport;
      
      res.on('close', () => {
        delete transports.sse[transport.sessionId];
        debugLog('SSE session closed', { sessionId: transport.sessionId });
      });
      
      const server = createServer();
      await server.connect(transport);
      debugLog('New SSE session created', { sessionId: transport.sessionId });
    } catch (error) {
      console.error('Error handling SSE request:', error);
      if (!res.headersSent) {
        res.status(500).send('Internal server error');
      }
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  return app;
}

// Main function
async function main() {
  const transportMode = process.env.TRANSPORT_MODE || 'http';
  
  console.error(`🚀 Starting document-extractor-mcp with transport: ${transportMode}`);
  console.error('⚡ Using lazy loading - configurations will be loaded on-demand');

  if (transportMode === 'stdio') {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('✅ MCP server connected to stdio transport');
  } else {
    const app = createHttpServer();
    app.listen(HTTP_PORT || 3000, () => {
      console.error(`✅ HTTP server listening on port ${HTTP_PORT || 3000}`);
    });
  }
}

// Start the server
main().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
