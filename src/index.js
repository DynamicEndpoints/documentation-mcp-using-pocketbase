#!/usr/bin/env node

/**
 * Document Extractor MCP Server with PocketBase Integration
 * 
 * This server implements LAZY LOADING of configurations as per Smithery requirements:
 * https://smithery.ai/docs/build/deployments#tool-lists
 * 
 * Key features:
 * - Configurations are only loaded when tools are first invoked
 * - PocketBase connection is established lazily
 * - Environment variables are read on-demand
 * - Smithery query parameters override configurations dynamically
 * 
 * This ensures optimal performance during discovery/deployment phases.
 */

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

// Lazy initialization flag for dotenv
let dotenvInitialized = false;

// Initialize dotenv lazily
function initializeDotenv() {
  if (!dotenvInitialized) {
    dotenv.config();
    dotenvInitialized = true;
    console.error('🔧 Environment configuration loaded lazily');
  }
}

// Parse Smithery configuration from query parameters (dot-notation support)
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

// Override environment variables with Smithery config
function applySmitheryConfig(config) {
  if (config.pocketbaseUrl) {
    process.env.POCKETBASE_URL = config.pocketbaseUrl;
  }
  if (config.pocketbaseEmail) {
    process.env.POCKETBASE_EMAIL = config.pocketbaseEmail;
  }
  if (config.pocketbasePassword) {
    process.env.POCKETBASE_PASSWORD = config.pocketbasePassword;
  }
  if (config.defaultCollection) {
    process.env.DOCUMENTS_COLLECTION = config.defaultCollection;
  }
}

// Lazy initialization variables - will be set when first needed
let pb = null;
let DOCUMENTS_COLLECTION = null;
let DEBUG = null;
let HTTP_PORT = null;
let configInitialized = false;

// Initialize configuration lazily
function initializeConfig() {
  if (configInitialized) return;
  
  // Initialize dotenv first
  initializeDotenv();
  
  pb = new PocketBase(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090');
  DOCUMENTS_COLLECTION = process.env.DOCUMENTS_COLLECTION || 'documents';
  DEBUG = process.env.DEBUG === 'true';
  HTTP_PORT = process.env.PORT || process.env.HTTP_PORT || 3000; // Smithery uses PORT
  
  configInitialized = true;
  debugLog('🔧 Configuration initialized lazily');
}

// Debug logging with lazy config initialization
function debugLog(message, data = null) {
  if (DEBUG === null) {
    DEBUG = process.env.DEBUG === 'true';
  }
  if (DEBUG) {
    console.error(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

// Global server instance for dynamic tool management
let globalServer = null;

// Collection schema for documents (lazy loaded)
function getDocumentsCollectionSchema() {
  if (!DOCUMENTS_COLLECTION) {
    initializeConfig();
  }
  
  return {
    name: DOCUMENTS_COLLECTION,
    type: 'base',
    schema: [
      {
        name: 'title',
        type: 'text',
        required: true,
        options: {
          max: 255
        }
      },
      {
        name: 'content',
        type: 'text',
        required: true,
        options: {}
      },
      {
        name: 'metadata',
        type: 'json',
        required: false,
        options: {}
      },
      {
        name: 'created',
        type: 'date',
        required: false,
        options: {}
      },
      {
        name: 'updated',
        type: 'date',
        required: false,
        options: {}
      }
    ],
    indexes: [
      'CREATE INDEX idx_documents_title ON documents (title)',
      'CREATE INDEX idx_documents_created ON documents (created)',
      'CREATE INDEX idx_documents_metadata_url ON documents (json_extract(metadata, "$.url"))'
    ]
  };
}

// Authenticate with PocketBase (with lazy initialization)
async function authenticatePocketBase() {
  return await authenticateWhenNeeded();
}

// Actual authentication function - only called when really needed
async function authenticateWhenNeeded() {
  try {
    // Initialize config if not already done
    if (!pb) {
      initializeConfig();
    }
    
    // Check if we already have a valid authentication
    if (pb.authStore.isValid) {
      try {
        // Try to refresh the token to ensure it's still valid
        await pb.collection('_superusers').authRefresh();
        debugLog('✅ Authentication refreshed successfully');
        return true;
      } catch (refreshError) {
        debugLog('🔄 Auth refresh failed, re-authenticating...', { error: refreshError.message });
        // Clear invalid auth and proceed to re-authenticate
        pb.authStore.clear();
      }
    }
    
    // Authenticate as superuser (admin)
    const email = process.env.POCKETBASE_EMAIL || process.env.POCKETBASE_ADMIN_EMAIL;
    const password = process.env.POCKETBASE_PASSWORD || process.env.POCKETBASE_ADMIN_PASSWORD;
    
    if (!email || !password) {
      throw new Error('PocketBase credentials not configured. Please provide POCKETBASE_EMAIL and POCKETBASE_PASSWORD environment variables.');
    }
    
    // Use the new authentication method for superusers
    const authData = await pb.collection('_superusers').authWithPassword(email, password);
    
    debugLog('✅ Authenticated with PocketBase as superuser', { 
      userId: authData.record.id,
      email: authData.record.email,
      tokenValid: pb.authStore.isValid
    });
    
    return true;
  } catch (error) {
    console.error('❌ PocketBase authentication failed:', error.message);
    
    // Provide more specific error messages
    if (error.status === 400) {
      throw new Error(`Authentication failed: Invalid credentials. Please check your email and password.`);
    } else if (error.status === 404) {
      throw new Error(`Authentication failed: Admin user not found. Please ensure the admin account exists.`);
    } else if (error.message.includes('fetch')) {
      throw new Error(`Authentication failed: Cannot connect to PocketBase server at ${pb.baseUrl}. Please check the server URL and ensure PocketBase is running.`);
    } else {
      throw new Error(`PocketBase authentication failed: ${error.message}`);
    }
  }
}

// Check if collection exists and create if needed (with lazy initialization)
async function ensureCollectionExists() {
  try {
    await authenticateWhenNeeded();
    
    // Ensure we have the collection name
    if (!DOCUMENTS_COLLECTION) {
      initializeConfig();
    }
    
    // Try to get the collection
    try {
      const collection = await pb.collections.getOne(DOCUMENTS_COLLECTION);
      debugLog('✅ Collection exists', { name: DOCUMENTS_COLLECTION, id: collection.id });
      return { exists: true, collection, created: false };
    } catch (error) {
      if (error.status === 404) {
        // Collection doesn't exist, create it
        debugLog('📝 Creating collection', { name: DOCUMENTS_COLLECTION });
        
        const newCollection = await pb.collections.create(getDocumentsCollectionSchema());
        debugLog('✅ Collection created successfully', { 
          name: DOCUMENTS_COLLECTION, 
          id: newCollection.id 
        });
        
        return { exists: true, collection: newCollection, created: true };
      } else {
        throw error;
      }
    }
  } catch (error) {
    debugLog('❌ Error managing collection', { error: error.message });
    throw new Error(`Failed to ensure collection exists: ${error.message}`);
  }
}

// Get collection info (with lazy initialization)
async function getCollectionInfo() {
  try {
    await authenticateWhenNeeded();
    
    if (!DOCUMENTS_COLLECTION) {
      initializeConfig();
    }
    
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

// Extract content from Microsoft Learn
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
    
    // Extract title with multiple fallbacks
    const title = $('h1').first().text().trim() || 
                  $('[data-bi-name="title"]').text().trim() || 
                  $('.content h1').first().text().trim() ||
                  $('title').text().trim() ||
                  'Untitled Microsoft Learn Document';
    
    // Extract main content with multiple selectors
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
        if (content.length > 100) break; // Ensure we got substantial content
      }
    }
    
    // Clean up content
    content = content.replace(/\s+/g, ' ').trim();
    
    if (!content || content.length < 50) {
      throw new Error('Insufficient content extracted from the page');
    }
    
    // Extract additional metadata
    const description = $('meta[name="description"]').attr('content') || '';
    const keywords = $('meta[name="keywords"]').attr('content') || '';
    const author = $('meta[name="author"]').attr('content') || '';
    
    // Extract table of contents or section headers
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
      headers: headers.slice(0, 10), // Limit headers
      contentLength: content.length,
      domain: 'learn.microsoft.com'
    };
    
    return {
      title: title.substring(0, 255), // Limit title length
      content,
      metadata
    };
  } catch (error) {
    debugLog('Error extracting from Microsoft Learn', { error: error.message, url });
    throw new Error(`Failed to extract from Microsoft Learn: ${error.message}`);
  }
}

// Extract content from GitHub
async function extractFromGitHub(url) {
  try {
    debugLog('Extracting from GitHub', { url });
    
    // Handle different GitHub URL formats
    let rawUrl;
    
    if (url.includes('/blob/')) {
      // Convert blob URL to raw URL
      rawUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    } else if (url.includes('/tree/')) {
      throw new Error('Directory URLs not supported. Please provide a direct file link.');
    } else if (url.includes('raw.githubusercontent.com')) {
      rawUrl = url;
    } else {
      // Try to extract repo info and assume README
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
      // Try alternative branches if main doesn't work
      if (rawUrl.includes('/main/')) {
        const masterUrl = rawUrl.replace('/main/', '/master/');
        const masterResponse = await fetch(masterUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
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
    
    // Extract filename for title
    const filename = rawUrl.split('/').pop() || 'GitHub Document';
    const title = filename.replace(/\.[^/.]+$/, ''); // Remove file extension
    
    // Extract repo info
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
      title: title.substring(0, 255), // Limit title length
      content,
      metadata
    };
  } catch (error) {
    debugLog('Error extracting from GitHub', { error: error.message, url });
    throw new Error(`Failed to extract from GitHub: ${error.message}`);
  }
}

// Store document in PocketBase (with lazy initialization)
async function storeDocument(docData) {
  try {
    await authenticateWhenNeeded();
    
    // Ensure configuration is initialized
    if (!DOCUMENTS_COLLECTION) {
      initializeConfig();
    }
    
    // Check if document already exists
    const existingDocs = await pb.collection(DOCUMENTS_COLLECTION).getList(1, 1, {
      filter: `metadata.url = "${docData.metadata.url}"`
    });
    
    if (existingDocs.items.length > 0) {
      // Update existing document
      const record = await pb.collection(DOCUMENTS_COLLECTION).update(existingDocs.items[0].id, {
        title: docData.title,
        content: docData.content,
        metadata: docData.metadata,
        updated: new Date().toISOString()
      });
      
      debugLog('Document updated in PocketBase', { id: record.id });
      return { ...record, isUpdate: true };
    } else {
      // Create new document
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

// Get documents from PocketBase (with lazy initialization)
async function getDocuments(limit = 50, page = 1) {
  try {
    await authenticateWhenNeeded();
    
    if (!DOCUMENTS_COLLECTION) {
      initializeConfig();
    }
    
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

// Search documents in PocketBase (with lazy initialization)
async function searchDocuments(query, limit = 50) {
  try {
    await authenticateWhenNeeded();
    
    if (!DOCUMENTS_COLLECTION) {
      initializeConfig();
    }
    
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

// Get single document from PocketBase (with lazy initialization)
async function getDocument(id) {
  try {
    await authenticateWhenNeeded();
    
    if (!DOCUMENTS_COLLECTION) {
      initializeConfig();
    }
    
    const doc = await pb.collection(DOCUMENTS_COLLECTION).getOne(id);
    
    debugLog('Document retrieved from PocketBase', { id });
    return doc;
  } catch (error) {
    debugLog('Error getting document', { error: error.message, id });
    throw new Error(`Failed to retrieve document: ${error.message}`);
  }
}

// Delete document from PocketBase (with lazy initialization)
async function deleteDocument(id) {
  try {
    await authenticateWhenNeeded();
    
    if (!DOCUMENTS_COLLECTION) {
      initializeConfig();
    }
    
    await pb.collection(DOCUMENTS_COLLECTION).delete(id);
    
    debugLog('Document deleted from PocketBase', { id });
    return true;
  } catch (error) {
    debugLog('Error deleting document', { error: error.message, id });
    throw new Error(`Failed to delete document: ${error.message}`);
  }
}

// Create the MCP server using the modern SDK
export function createServer() {
  const server = new McpServer({
    name: 'document-extractor-mcp',
    version: '1.0.0',
  });

  // Store server reference for dynamic tool management
  globalServer = server;

  // Register extract_document tool with lazy loading capability
  const extractDocumentTool = server.tool(
    'extract_document',
    'Extract document content from Microsoft Learn or GitHub URL and store in PocketBase',
    {
      url: z.string().url('Invalid URL format').describe('Microsoft Learn or GitHub URL to extract content from')
    },    async ({ url }) => {
      try {
        // Only authenticate when tool is actually invoked - no pre-checks
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
          content: [
            {
              type: 'text',
              text: `${record.isUpdate ? '🔄 Document updated' : '✅ Document extracted and stored'} successfully!\n\n` +
                    `**Title:** ${record.title}\n` +
                    `**ID:** ${record.id}\n` +
                    `**Source:** ${docData.metadata.source}\n` +
                    `**URL:** ${docData.metadata.url}\n` +
                    `**Word Count:** ${docData.metadata.wordCount}\n` +
                    `**Content Preview:** ${docData.content.substring(0, 200)}...`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Register authenticate tool - allows users to test their PocketBase connection
  const authenticateTool = server.tool(
    'authenticate',
    'Test authentication with PocketBase using provided credentials',
    {
      pocketbaseUrl: z.string().url('Invalid URL format').describe('PocketBase server URL (e.g., https://your-pb-instance.com)'),
      email: z.string().email('Invalid email format').describe('PocketBase admin email for authentication'),
      password: z.string().min(1, 'Password cannot be empty').describe('PocketBase admin password')
    },
    async ({ pocketbaseUrl, email, password }) => {
      try {
        // Create a temporary PocketBase instance for testing
        const testPb = new PocketBase(pocketbaseUrl);
        
        // Attempt authentication using the correct superuser collection
        const authData = await testPb.collection('_superusers').authWithPassword(email, password);
        
        // Test basic functionality by fetching collections
        const collections = await testPb.collections.getList(1, 10);
        
        // Get server health to verify connectivity
        const healthCheck = await testPb.health.check();
        
        // Update the global configuration if authentication succeeds
        process.env.POCKETBASE_URL = pocketbaseUrl;
        process.env.POCKETBASE_EMAIL = email;
        process.env.POCKETBASE_PASSWORD = password;
        
        // Reset configuration to force reload with new credentials
        configInitialized = false;
        pb = null;
        initializeConfig();
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ **Authentication Successful!**\n\n` +
                    `**PocketBase Server:** ${pocketbaseUrl}\n` +
                    `**Admin Email:** ${email}\n` +
                    `**Admin ID:** ${authData.record.id}\n` +
                    `**Created:** ${new Date(authData.record.created).toLocaleString()}\n` +
                    `**Token Valid:** ${testPb.authStore.isValid}\n\n` +
                    `**Server Info:**\n` +
                    `- Server Status: ${healthCheck?.message || 'Healthy'}\n` +
                    `- Collections Available: ${collections.totalItems}\n` +
                    `- Sample Collections: ${collections.items.slice(0, 3).map(c => c.name).join(', ')}\n\n` +
                    `🔧 **Configuration Updated** - You can now use other tools that require PocketBase access.\n\n` +
                    `**Available Tools:**\n` +
                    `- \`extract_document\`: Extract and store documents\n` +
                    `- \`list_documents\`: List stored documents\n` +
                    `- \`search_documents\`: Search document content\n` +
                    `- \`get_document\`: Get specific document by ID\n` +
                    `- \`delete_document\`: Delete a document\n` +
                    `- \`ensure_collection\`: Create documents collection if needed\n` +
                    `- \`collection_info\`: Get collection statistics\n` +
                    `- \`connection_status\`: Check current connection status`
            }
          ]
        };
      } catch (error) {
        let errorMessage = error.message;
        let troubleshooting = '';
        let statusCode = error.status || 0;
        
        if (statusCode === 400) {
          errorMessage = 'Invalid credentials - please check your email and password';
          troubleshooting = '\n\n**Troubleshooting:**\n' +
                           '• Verify email and password are correct\n' +
                           '• Ensure the account has admin/superuser privileges\n' +
                           '• Check if the admin account exists in PocketBase';
        } else if (statusCode === 404) {
          errorMessage = 'Admin user not found - account may not exist';
          troubleshooting = '\n\n**Troubleshooting:**\n' +
                           '• Create an admin account in PocketBase\n' +
                           '• Ensure you\'re using the correct email address\n' +
                           '• Check PocketBase admin dashboard for existing accounts';
        } else if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
          errorMessage = 'Cannot connect to PocketBase server - please check the URL';
          troubleshooting = '\n\n**Troubleshooting:**\n' +
                           '• Verify the PocketBase URL is correct\n' +
                           '• Ensure PocketBase is running and accessible\n' +
                           '• Check for network connectivity issues\n' +
                           '• Verify firewall settings allow connections';
        } else if (statusCode === 401) {
          errorMessage = 'Unauthorized - authentication rejected by server';
          troubleshooting = '\n\n**Troubleshooting:**\n' +
                           '• Check if admin authentication is enabled\n' +
                           '• Verify account credentials are correct\n' +
                           '• Ensure PocketBase server is properly configured';
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `❌ **Authentication Failed**\n\n` +
                    `**Error:** ${errorMessage}\n` +
                    `**Server:** ${pocketbaseUrl}\n` +
                    `**Email:** ${email}\n` +
                    `**Status Code:** ${statusCode || 'Unknown'}${troubleshooting}\n\n` +
                    `**Common Solutions:**\n` +
                    `• Make sure PocketBase is running and accessible\n` +
                    `• Verify admin credentials in PocketBase dashboard\n` +
                    `• Check server URL format (include http:// or https://)\n` +
                    `• Ensure no trailing slash in the URL`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Register list_documents tool
  const listDocumentsTool = server.tool(
    'list_documents',
    'List stored documents from PocketBase with pagination',
    {
      limit: z.number().min(1).max(100).optional().default(20).describe('Maximum number of documents to return (default: 20, max: 100)'),
      page: z.number().min(1).optional().default(1).describe('Page number for pagination (default: 1)')
    },    async ({ limit = 20, page = 1 }) => {
      try {
        // Only authenticate when tool is actually invoked
        await authenticateWhenNeeded();
        
        const result = await getDocuments(limit, page);
        
        if (result.items.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: '📚 No documents found in the database.'
              }
            ]
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
          content: [
            {
              type: 'text',
              text: `📚 Found ${result.items.length} documents (Page ${page} of ${Math.ceil(result.totalItems / limit)}):\n` +
                    `Total: ${result.totalItems} documents\n\n${documentList}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Register search_documents tool
  const searchDocumentsTool = server.tool(
    'search_documents',
    'Search documents by title or content using full-text search',
    {
      query: z.string().min(1, 'Query cannot be empty').describe('Search query to find documents (searches title and content)'),
      limit: z.number().min(1).max(100).optional().default(50).describe('Maximum number of results to return (default: 50)')
    },    async ({ query, limit = 50 }) => {
      try {
        // Only authenticate when tool is actually invoked
        await authenticateWhenNeeded();
        
        const result = await searchDocuments(query, limit);
        
        if (result.items.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `🔍 No documents found matching "${query}"`
              }
            ]
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
          content: [
            {
              type: 'text',
              text: `🔍 Found ${result.items.length} documents matching "${query}":\n\n${searchResults}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Register get_document tool
  const getDocumentTool = server.tool(
    'get_document',
    'Get a specific document by ID with full content',
    {
      id: z.string().min(1, 'Document ID is required').describe('Document ID to retrieve')
    },    async ({ id }) => {
      try {
        // Only authenticate when tool is actually invoked
        await authenticateWhenNeeded();
        
        const doc = await getDocument(id);
        
        return {
          content: [
            {
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
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  );
  // Register delete_document tool
  const deleteDocumentTool = server.tool(
    'delete_document',
    'Delete a document from PocketBase by ID',
    {
      id: z.string().min(1, 'Document ID is required').describe('Document ID to delete')
    },    async ({ id }) => {
      try {
        // Only authenticate when tool is actually invoked
        await authenticateWhenNeeded();
        
        await deleteDocument(id);
        
        return {
          content: [
            {
              type: 'text',
              text: `🗑️ Document with ID "${id}" has been deleted successfully.`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Register ensure_collection tool
  const ensureCollectionTool = server.tool(
    'ensure_collection',
    'Check if the documents collection exists and create it if needed',
    {},    async () => {
      try {
        // Only authenticate when tool is actually invoked
        await authenticateWhenNeeded();
        
        const result = await ensureCollectionExists();
        
        return {
          content: [
            {
              type: 'text',
              text: result.created 
                ? `✅ Documents collection "${DOCUMENTS_COLLECTION || 'documents'}" created successfully!\n\n` +
                  `**Collection Details:**\n` +
                  `- ID: ${result.collection.id}\n` +
                  `- Name: ${result.collection.name}\n` +
                  `- Type: ${result.collection.type}\n` +
                  `- Schema Fields: ${result.collection.schema?.length || 0}\n` +
                  `- Created: ${new Date(result.collection.created).toLocaleString()}`
                : `✅ Documents collection "${DOCUMENTS_COLLECTION || 'documents'}" already exists.\n\n` +
                  `**Collection Details:**\n` +
                  `- ID: ${result.collection.id}\n` +
                  `- Name: ${result.collection.name}\n` +
                  `- Type: ${result.collection.type}\n`+
                  `- Schema Fields: ${result.collection.schema?.length || 0}\n` +
                  `- Created: ${new Date(result.collection.created).toLocaleString()}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error checking/creating collection: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Register collection_info tool
  const collectionInfoTool = server.tool(
    'collection_info',
    'Get detailed information about the documents collection including statistics',
    {},    async () => {
      try {
        // Only authenticate when tool is actually invoked
        await authenticateWhenNeeded();
        
        const info = await getCollectionInfo();
        
        const schemaInfo = info.collection.schema?.map(field => 
          `- **${field.name}** (${field.type})${field.required ? ' *required*' : ''}`
        ).join('\n') || 'No schema information available';
        
        return {
          content: [
            {
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
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error getting collection info: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  );
  // Register connection_status tool - shows current PocketBase connection info
  const connectionStatusTool = server.tool(
    'connection_status',
    'Check the current PocketBase connection status and configuration',
    {},
    async () => {
      try {
        // Initialize config to get current settings
        initializeConfig();
        
        // Get current environment settings (without revealing password)
        const pocketbaseUrl = process.env.POCKETBASE_URL || 'Not configured';
        const pocketbaseEmail = process.env.POCKETBASE_EMAIL || 'Not configured';
        const collection = DOCUMENTS_COLLECTION || 'documents';
        
        let connectionStatus = 'Not tested';
        let serverInfo = {};
        let authInfo = {};
        let errorDetails = '';
        
        // Test connection if credentials are available
        if (pocketbaseUrl !== 'Not configured' && pocketbaseEmail !== 'Not configured') {
          try {
            await authenticateWhenNeeded();
            connectionStatus = '✅ Connected';
            
            // Get server info
            if (pb && pb.authStore.isValid) {
              authInfo = {
                email: pb.authStore.record?.email || 'Unknown',
                id: pb.authStore.record?.id || 'Unknown',
                avatar: pb.authStore.record?.avatar || 'None',
                created: pb.authStore.record?.created ? new Date(pb.authStore.record.created).toLocaleString() : 'Unknown',
                tokenValid: pb.authStore.isValid,
                recordType: 'superuser'
              };
              
              // Try to get some basic server stats
              try {
                const collections = await pb.collections.getList(1, 5);
                const healthCheck = await pb.health.check();
                
                serverInfo.totalCollections = collections.totalItems;
                serverInfo.sampleCollections = collections.items.map(c => c.name).slice(0, 3);
                serverInfo.health = healthCheck?.message || 'Healthy';
                serverInfo.version = healthCheck?.version || 'Unknown';
              } catch (e) {
                serverInfo.error = 'Could not fetch server statistics: ' + e.message;
              }
              
              // Check if documents collection exists
              try {
                const docsCollection = await pb.collections.getOne(collection);
                serverInfo.documentsCollection = {
                  exists: true,
                  id: docsCollection.id,
                  created: new Date(docsCollection.created).toLocaleString(),
                  fieldsCount: docsCollection.schema?.length || 0
                };
              } catch (e) {
                serverInfo.documentsCollection = {
                  exists: false,
                  error: 'Collection not found - use "ensure_collection" tool to create it'
                };
              }
            }
          } catch (error) {
            connectionStatus = `❌ Connection failed: ${error.message}`;
            errorDetails = `\n**Error Details:** ${error.message}`;
            
            if (error.message.includes('credentials not configured')) {
              errorDetails += '\n**Solution:** Use the "authenticate" tool to set up your credentials.';
            } else if (error.message.includes('Invalid credentials')) {
              errorDetails += '\n**Solution:** Check your email and password, then use the "authenticate" tool.';
            } else if (error.message.includes('Cannot connect')) {
              errorDetails += '\n**Solution:** Verify PocketBase server URL and ensure it\'s running.';
            }
          }
        }
        
        // Build status report
        let statusReport = `🔌 **PocketBase Connection Status**\n\n` +
                          `**Configuration:**\n` +
                          `- Server URL: ${pocketbaseUrl}\n` +
                          `- Admin Email: ${pocketbaseEmail}\n` +
                          `- Password: ${process.env.POCKETBASE_PASSWORD ? '✅ Configured' : '❌ Not configured'}\n` +
                          `- Default Collection: ${collection}\n\n` +
                          `**Connection Status:** ${connectionStatus}`;
        
        if (errorDetails) {
          statusReport += errorDetails;
        }
        
        if (authInfo.email) {
          statusReport += `\n\n**Authentication Details:**\n` +
                         `- Email: ${authInfo.email}\n` +
                         `- Admin ID: ${authInfo.id}\n` +
                         `- Account Created: ${authInfo.created}\n` +
                         `- Avatar: ${authInfo.avatar}\n` +
                         `- Token Valid: ${authInfo.tokenValid}\n` +
                         `- Account Type: ${authInfo.recordType}`;
        }
        
        if (serverInfo.totalCollections) {
          statusReport += `\n\n**Server Statistics:**\n` +
                         `- Server Health: ${serverInfo.health}\n` +
                         `- Total Collections: ${serverInfo.totalCollections}\n` +
                         `- Sample Collections: ${serverInfo.sampleCollections?.join(', ') || 'None'}`;
          
          if (serverInfo.documentsCollection) {
            const docCol = serverInfo.documentsCollection;
            statusReport += `\n\n**Documents Collection:**\n` +
                           `- Exists: ${docCol.exists ? 'Yes' : 'No'}`;
            if (docCol.exists) {
              statusReport += `\n- Collection ID: ${docCol.id}\n` +
                             `- Created: ${docCol.created}\n` +
                             `- Schema Fields: ${docCol.fieldsCount}`;
            } else {
              statusReport += `\n- Status: ${docCol.error}`;
            }
          }
        }
        
        if (serverInfo.error) {
          statusReport += `\n\n**Server Info:** ${serverInfo.error}`;
        }
        
        statusReport += `\n\n**Available Tools:**\n` +
                       `- \`authenticate\`: Test/update PocketBase credentials\n` +
                       `- \`ensure_collection\`: Create documents collection if needed\n` +
                       `- \`collection_info\`: Get detailed collection statistics\n` +
                       `- \`extract_document\`: Extract and store documents from URLs\n` +
                       `- \`list_documents\`: List stored documents with pagination\n` +
                       `- \`search_documents\`: Search document content\n` +
                       `- \`get_document\`: Retrieve specific document by ID\n` +
                       `- \`delete_document\`: Remove a document from storage`;
        
        return {
          content: [
            {
              type: 'text',
              text: statusReport
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Error checking connection status: ${error.message}\n\n` +
                    `**Troubleshooting:**\n` +
                    `- Use the 'authenticate' tool to set up your PocketBase credentials\n` +
                    `- Verify your PocketBase server is running and accessible\n` +
                    `- Check the server URL format (include http:// or https://)`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Example of dynamic tool management - disable write tools in read-only mode
  if (process.env.READ_ONLY_MODE === 'true') {
    deleteDocumentTool.disable();
    extractDocumentTool.disable();
    ensureCollectionTool.disable();
    console.error('🔒 Running in read-only mode - write operations disabled');
  }

  // Add a statistics resource that shows server metrics
  server.registerResource(
    'stats',
    'stats://server',
    {
      title: 'Server Statistics',
      description: 'Current server statistics and metrics',
      mimeType: 'application/json'
    },    async (uri) => {
      try {
        await authenticateWhenNeeded();
        
        // Ensure configuration is initialized
        if (!DOCUMENTS_COLLECTION) {
          initializeConfig();
        }
        
        const totalDocs = await pb.collection(DOCUMENTS_COLLECTION).getList(1, 1);
        
        const stats = {
          timestamp: new Date().toISOString(),
          totalDocuments: totalDocs.totalItems,
          server: {
            name: 'document-extractor-mcp',
            version: '1.0.0',
            uptime: process.uptime(),
            memory: process.memoryUsage()
          },
          environment: {
            nodeVersion: process.version,
            debugMode: DEBUG || process.env.DEBUG === 'true',
            readOnlyMode: process.env.READ_ONLY_MODE === 'true'
          }
        };
        
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify(stats, null, 2),
            mimeType: 'application/json'
          }]
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({ error: error.message }, null, 2),
            mimeType: 'application/json'
          }]
        };
      }
    }
  );

  return server;
}

// HTTP Server for Streamable HTTP and SSE support
export function createHttpServer() {
  const app = express();
  app.use(express.json());

  // Store transports for each session type
  const transports = {
    streamable: {},
    sse: {}
  };
  // Modern Streamable HTTP endpoint (protocol version 2025-03-26)
  app.all('/mcp', async (req, res) => {
    try {
      debugLog('MCP request received', { 
        method: req.method, 
        headers: req.headers, 
        query: req.query,
        body: req.body 
      });

      // Handle Smithery configuration via query parameters
      if (Object.keys(req.query).length > 0) {
        const smitheryConfig = parseSmitheryConfig(req.query);
        applySmitheryConfig(smitheryConfig);
        debugLog('Applied Smithery configuration', smitheryConfig);
        
        // Force reinitialize configuration with new settings
        configInitialized = false;
        initializeConfig();
      }
      
      const sessionId = req.headers['mcp-session-id'];
      let transport;

      if (sessionId && transports.streamable[sessionId]) {
        // Reuse existing transport
        transport = transports.streamable[sessionId];
        debugLog('Reusing existing transport', { sessionId });
      } else {
        // Create new transport - handle both new sessions and tool discovery
        const newSessionId = sessionId || randomUUID();
        
        try {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId
          });

          // Store transport in session map
          transports.streamable[newSessionId] = transport;

          // Clean up transport when closed
          transport.onclose = () => {
            if (newSessionId) {
              delete transports.streamable[newSessionId];
              debugLog('Streamable HTTP session closed', { sessionId: newSessionId });
            }
          };

          // Create and connect server
          const server = createServer();
          await server.connect(transport);
          
          debugLog('Server connected to transport', { sessionId: newSessionId });
        } catch (transportError) {
          console.error('Transport creation error:', transportError);
          throw new Error(`Failed to create transport: ${transportError.message}`);
        }
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
      
    } catch (error) {
      console.error('Error handling Streamable HTTP request:', error);
      debugLog('Streamable HTTP error details', { 
        error: error.message, 
        stack: error.stack,
        request: {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: req.body
        }
      });
      
      if (!res.headersSent) {
        // Provide more specific error messages
        let errorCode = -32603;
        let errorMessage = 'Internal server error';
        
        if (error.message.includes('transport')) {
          errorCode = -32001;
          errorMessage = 'Transport initialization failed';
        } else if (error.message.includes('Server not initialized')) {
          errorCode = -32000;
          errorMessage = 'Server initialization error';
        } else {
          errorMessage = error.message;
        }
        
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: errorCode,
            message: errorMessage,
          },
          id: req.body?.id || null,
        });
      }
    }
  });

  // Legacy SSE endpoint for backwards compatibility (protocol version 2024-11-05)
  app.get('/sse', async (req, res) => {
    try {
      debugLog('SSE connection request', { query: req.query });
      
      // Handle Smithery configuration via query parameters
      if (Object.keys(req.query).length > 0) {
        const smitheryConfig = parseSmitheryConfig(req.query);
        applySmitheryConfig(smitheryConfig);
        debugLog('Applied Smithery configuration for SSE', smitheryConfig);
        
        // Force reinitialize configuration with new settings
        configInitialized = false;
        initializeConfig();
      }
      
      const sessionId = randomUUID();
      const transport = new SSEServerTransport('/messages', res);
      
      // Store transport
      transports.sse[sessionId] = transport;
      
      // Clean up on connection close
      res.on('close', () => {
        delete transports.sse[sessionId];
        debugLog('SSE session closed', { sessionId });
      });
      
      res.on('error', (error) => {
        delete transports.sse[sessionId];
        debugLog('SSE session error', { sessionId, error: error.message });
      });
      
      // Create and connect server
      const server = createServer();
      await server.connect(transport);
      
      debugLog('SSE session created and server connected', { sessionId });
      
    } catch (error) {
      console.error('Error handling SSE request:', error);
      debugLog('SSE error details', { 
        error: error.message, 
        stack: error.stack 
      });
      
      if (!res.headersSent) {
        res.status(500).send('Internal server error: ' + error.message);
      }
    }
  });

  // Legacy message endpoint for SSE clients
  app.post('/messages', async (req, res) => {
    try {
      const sessionId = req.query.sessionId;
      debugLog('SSE message received', { sessionId, body: req.body });
      
      if (!sessionId) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32602,
            message: 'Missing sessionId parameter'
          },
          id: req.body?.id || null
        });
        return;
      }
      
      const transport = transports.sse[sessionId];
      if (transport) {
        await transport.handlePostMessage(req, res, req.body);
        debugLog('SSE message handled', { sessionId });
      } else {
        debugLog('SSE transport not found', { sessionId, availableSessions: Object.keys(transports.sse) });
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Session not found'
          },
          id: req.body?.id || null
        });
      }
    } catch (error) {
      console.error('Error handling SSE message:', error);
      debugLog('SSE message error', { error: error.message, stack: error.stack });
      
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error: ' + error.message
          },
          id: req.body?.id || null
        });
      }
    }
  });
  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      // Don't require authentication for health checks - just test basic connectivity
      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        server: 'document-extractor-mcp',
        version: '1.0.0',
        uptime: process.uptime(),
        environment: {
          nodeVersion: process.version,
          transportMode: process.env.TRANSPORT_MODE || 'stdio',
          port: process.env.PORT || process.env.HTTP_PORT || 3000
        },
        configuration: {
          initialized: configInitialized,
          lazyLoadingEnabled: true
        },
        sessions: {
          streamableHttp: Object.keys(transports.streamable).length,
          sse: Object.keys(transports.sse).length
        }
      };
      
      res.json(healthData);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        uptime: process.uptime()
      });
    }
  });

  // Server info endpoint
  app.get('/info', (req, res) => {
    res.json({
      name: 'document-extractor-mcp',
      version: '1.0.0',
      description: 'MCP server for extracting documents from Microsoft Learn and GitHub',
      protocols: {
        streamableHttp: '/mcp',
        sse: '/sse'
      },
      features: [
        'Document extraction from Microsoft Learn',
        'Document extraction from GitHub',
        'PocketBase storage',
        'Full-text search',
        'Dynamic tool management',
        'Session management',
        'Server-Sent Events support'
      ]
    });
  });

  return app;
}

// Start the server
async function main() {  try {
    // Lazy loading: Do NOT test PocketBase connection on startup
    // Connection will be established when tools are first invoked
    console.error('⚡ Lazy loading enabled - PocketBase connection deferred until first tool use');
    
    // Ensure the documents collection exists (if auto-create is enabled)
    const autoCreate = process.env.AUTO_CREATE_COLLECTION !== 'false';
    if (autoCreate) {
      console.error(`📝 Auto-create collection enabled for: ${DOCUMENTS_COLLECTION || process.env.DOCUMENTS_COLLECTION || 'documents'}`);
    } else {
      console.error(`⚠️  Auto-create collection disabled. Use 'ensure_collection' tool if needed.`);
    }

    const mode = process.env.TRANSPORT_MODE || 'stdio';
      if (mode === 'http') {
      // HTTP mode with Streamable HTTP and SSE support
      const app = createHttpServer();
      
      // Initialize config for HTTP port
      if (!HTTP_PORT) {
        initializeConfig();
      }
      
      const port = HTTP_PORT;
      
      app.listen(port, () => {
        console.error(`🚀 Document Extractor MCP Server started on port ${port}`);
        console.error(`📡 Streamable HTTP endpoint: http://localhost:${port}/mcp`);
        console.error(`📡 SSE endpoint (legacy): http://localhost:${port}/sse`);
        console.error(`🏥 Health check: http://localhost:${port}/health`);
        console.error(`ℹ️  Server info: http://localhost:${port}/info`);
        console.error(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.error(`🔧 Debug mode: ${DEBUG || process.env.DEBUG === 'true' ? 'enabled' : 'disabled'}`);
        console.error(`📚 Collection: ${DOCUMENTS_COLLECTION || process.env.DOCUMENTS_COLLECTION || 'documents'}`);
      });
    } else {
      // STDIO mode (default)
      const server = createServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('🚀 Document Extractor MCP Server started (STDIO mode)');
      console.error(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.error(`🔧 Debug mode: ${DEBUG || process.env.DEBUG === 'true' ? 'enabled' : 'disabled'}`);
      console.error(`📚 Collection: ${DOCUMENTS_COLLECTION || process.env.DOCUMENTS_COLLECTION || 'documents'}`);
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.error('🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('🛑 Shutting down gracefully...');
  process.exit(0);
});

main().catch((error) => {
  console.error('💥 Server crashed:', error);
  process.exit(1);
});
