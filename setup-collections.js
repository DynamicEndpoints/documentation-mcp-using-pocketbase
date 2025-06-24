#!/usr/bin/env node

/**
 * Setup script to create the required collections for Doc-MCP server
 */

import PocketBase from 'pocketbase';
import dotenv from 'dotenv';

dotenv.config();

const pb = new PocketBase(process.env.POCKETBASE_URL);
const DOCUMENTS_COLLECTION = process.env.DOCUMENTS_COLLECTION || 'documents';
const REPOSITORIES_COLLECTION = process.env.REPOSITORIES_COLLECTION || 'repositories';

async function setupCollections() {
  console.log('🔧 Setting up Doc-MCP Collections...\n');
  
  try {
    // Authenticate
    await pb.admins.authWithPassword(
      process.env.POCKETBASE_ADMIN_EMAIL,
      process.env.POCKETBASE_ADMIN_PASSWORD
    );
    console.log('✅ Authenticated with PocketBase');
    
    // Documents collection schema
    const documentsSchema = {
      name: DOCUMENTS_COLLECTION,
      type: 'base',
      schema: [
        {
          name: 'title',
          type: 'text',
          required: true,
          options: { max: 500 }
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
          name: 'repository',
          type: 'text',
          required: false,
          options: {}
        },
        {
          name: 'file_path',
          type: 'text',
          required: false,
          options: {}
        },
        {
          name: 'file_type',
          type: 'text',
          required: false,
          options: {}
        },
        {
          name: 'embeddings',
          type: 'json',
          required: false,
          options: {}
        },
        {
          name: 'processed_at',
          type: 'date',
          required: false,
          options: {}
        }
      ]
    };
    
    // Repositories collection schema
    const repositoriesSchema = {
      name: REPOSITORIES_COLLECTION,
      type: 'base',
      schema: [
        {
          name: 'name',
          type: 'text',
          required: true,
          options: { max: 255 }
        },
        {
          name: 'full_name',
          type: 'text',
          required: true,
          options: {}
        },
        {
          name: 'url',
          type: 'url',
          required: true,
          options: {}
        },
        {
          name: 'description',
          type: 'text',
          required: false,
          options: {}
        },
        {
          name: 'stats',
          type: 'json',
          required: false,
          options: {}
        },
        {
          name: 'status',
          type: 'text',
          required: true,
          options: {}
        },
        {
          name: 'ingested_at',
          type: 'date',
          required: false,
          options: {}
        }
      ]
    };
    
    // Setup documents collection
    console.log(`\n📋 Setting up ${DOCUMENTS_COLLECTION} collection...`);
    try {
      const existingDocs = await pb.collections.getOne(DOCUMENTS_COLLECTION);
      console.log(`✅ Documents collection already exists: ${existingDocs.name}`);
      
      // Update schema if needed
      try {
        await pb.collections.update(existingDocs.id, documentsSchema);
        console.log('🔄 Documents collection schema updated');
      } catch (updateError) {
        console.log('⚠️  Could not update documents schema:', updateError.message);
      }
      
    } catch (error) {
      if (error.status === 404) {
        const newDocs = await pb.collections.create(documentsSchema);
        console.log(`✅ Documents collection created: ${newDocs.name}`);
      } else {
        throw error;
      }
    }
    
    // Setup repositories collection
    console.log(`\n📋 Setting up ${REPOSITORIES_COLLECTION} collection...`);
    try {
      const existingRepos = await pb.collections.getOne(REPOSITORIES_COLLECTION);
      console.log(`✅ Repositories collection already exists: ${existingRepos.name}`);
      
      // Update schema if needed
      try {
        await pb.collections.update(existingRepos.id, repositoriesSchema);
        console.log('🔄 Repositories collection schema updated');
      } catch (updateError) {
        console.log('⚠️  Could not update repositories schema:', updateError.message);
      }
      
    } catch (error) {
      if (error.status === 404) {
        const newRepos = await pb.collections.create(repositoriesSchema);
        console.log(`✅ Repositories collection created: ${newRepos.name}`);
      } else {
        throw error;
      }
    }
    
    console.log('\n🎉 Collection setup completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`✅ ${DOCUMENTS_COLLECTION} collection: Ready`);
    console.log(`✅ ${REPOSITORIES_COLLECTION} collection: Ready`);
    
    console.log('\n💡 You can now:');
    console.log('• Run the enhanced server: node server-enhanced.js');
    console.log('• Test GitHub ingestion: node test-enhanced-features.js');
    console.log('• Use the MCP tools for AI-powered documentation queries');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error('Error details:', error.data || error);
  }
}

setupCollections().catch(error => {
  console.error('💥 Setup crashed:', error);
  process.exit(1);
});
