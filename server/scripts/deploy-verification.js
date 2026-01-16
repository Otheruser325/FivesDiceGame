#!/usr/bin/env node

/**
 * Final Deployment Verification Script
 * Tests all components before deploying to Render.com
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import ws from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🚀 Starting deployment verification...\n');

// Test 1: Check required files
console.log('📁 Checking required files...');
const requiredFiles = [
  'package.json',
  'index.js',
  'auth.js',
  'lobbyManager.js',
  'utils/lobbyStorage.js',
  'utils/userStorage.js',
  'Dockerfile',
  '.dockerignore'
];

let filesOk = true;
for (const file of requiredFiles) {
  const filePath = join(projectRoot, file);
  if (existsSync(filePath)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - MISSING`);
    filesOk = false;
  }
}

if (!filesOk) {
  console.log('\n❌ Some required files are missing!');
  process.exit(1);
}

// Test 2: Check package.json dependencies
console.log('\n📦 Checking package.json...');
const packageJson = JSON.parse(await import('fs').then(fs => fs.readFileSync(join(projectRoot, 'package.json'), 'utf8')));
const requiredDeps = ['express', 'socket.io', 'ws', 'passport', 'passport-discord', 'cors', 'cookie-parser', 'dotenv', '@supabase/supabase-js'];
const requiredDevDeps = ['nodemon'];

let depsOk = true;
for (const dep of requiredDeps) {
  if (packageJson.dependencies && packageJson.dependencies[dep]) {
    console.log(`  ✅ ${dep}@${packageJson.dependencies[dep]}`);
  } else {
    console.log(`  ❌ ${dep} - MISSING from dependencies`);
    depsOk = false;
  }
}

for (const dep of requiredDevDeps) {
  if (packageJson.devDependencies && packageJson.devDependencies[dep]) {
    console.log(`  ✅ ${dep}@${packageJson.devDependencies[dep]} (dev)`);
  } else {
    console.log(`  ⚠️  ${dep} - MISSING from devDependencies (optional)`);
  }
}

if (!depsOk) {
  console.log('\n❌ Some required dependencies are missing!');
  console.log('Run: npm install express socket.io ws passport passport-discord cors cookie-parser dotenv @supabase/supabase-js');
  process.exit(1);
}

// Test 3: Test module imports
console.log('\n🔍 Testing module imports...');
const modules = [
  { name: 'express', path: 'express' },
  { name: 'socket.io', path: 'socket.io' },
  { name: 'ws', path: 'ws' },
  { name: 'passport', path: 'passport' },
  { name: 'cors', path: 'cors' },
  { name: 'cookie-parser', path: 'cookie-parser' },
  { name: 'dotenv', path: 'dotenv' },
  { name: '@supabase/supabase-js', path: '@supabase/supabase-js' }
];

let importsOk = true;
for (const module of modules) {
  try {
    await import(module.path);
    console.log(`  ✅ ${module.name}`);
  } catch (error) {
    console.log(`  ❌ ${module.name} - ${error.message}`);
    importsOk = false;
  }
}

// Test 4: Test local module imports
console.log('\n📂 Testing local module imports...');
const localModules = [
  { name: 'auth.js', path: '../auth.js' },
  { name: 'lobbyManager.js', path: '../lobbyManager.js' },
  { name: 'lobbyStorage.js', path: '../utils/lobbyStorage.js' },
  { name: 'userStorage.js', path: '../utils/userStorage.js' }
];

for (const module of localModules) {
  try {
    const mod = await import(module.path);
    console.log(`  ✅ ${module.name}`);
    
    // Check for required exports
    if (module.name === 'auth.js') {
      if (mod.authMiddleware && mod.authRouter) {
        console.log(`    ✅ authMiddleware and authRouter exports found`);
      } else {
        console.log(`    ❌ Missing authMiddleware or authRouter exports`);
        importsOk = false;
      }
    }
  } catch (error) {
    console.log(`  ❌ ${module.name} - ${error.message}`);
    importsOk = false;
  }
}

if (!importsOk) {
  console.log('\n❌ Some modules failed to import!');
  process.exit(1);
}

// Test 5: Test WebSocket engine
console.log('\n🔌 Testing WebSocket engine...');
try {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    wsEngine: ws,
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  
  console.log('  ✅ WebSocket engine configured successfully');
  httpServer.close();
} catch (error) {
  console.log(`  ❌ WebSocket engine failed: ${error.message}`);
  process.exit(1);
}

// Test 6: Check environment variables template
console.log('\n🔧 Checking environment configuration...');
const envExamplePath = join(projectRoot, '.env.example');
if (existsSync(envExamplePath)) {
  console.log('  ✅ .env.example exists');
} else {
  console.log('  ⚠️  .env.example not found (optional)');
}

// Test 7: Check Docker configuration
console.log('\n🐳 Checking Docker configuration...');
const dockerfilePath = join(projectRoot, 'Dockerfile');
const dockerignorePath = join(projectRoot, '.dockerignore');

if (existsSync(dockerfilePath)) {
  console.log('  ✅ Dockerfile exists');
} else {
  console.log('  ❌ Dockerfile missing');
  process.exit(1);
}

if (existsSync(dockerignorePath)) {
  console.log('  ✅ .dockerignore exists');
} else {
  console.log('  ⚠️  .dockerignore missing (optional)');
}

// Final results
console.log('\n🎉 Deployment verification completed!');
console.log('\n📋 Summary:');
console.log('  ✅ All required files present');
console.log('  ✅ All dependencies installed');
console.log('  ✅ All modules import successfully');
console.log('  ✅ WebSocket engine configured');
console.log('  ✅ Docker configuration ready');

console.log('\n🚀 Ready for Render.com deployment!');
console.log('\n📝 Next steps:');
console.log('  1. Push code to GitHub repository');
console.log('  2. Connect repository to Render.com');
console.log('  3. Configure environment variables in Render dashboard');
console.log('  4. Deploy and test the application');

console.log('\n🔧 Required environment variables for Render.com:');
console.log('  - NODE_ENV=production');
console.log('  - PORT=10000 (Render assigns this automatically)');
console.log('  - DISCORD_CLIENT_ID');
console.log('  - DISCORD_CLIENT_SECRET');
console.log('  - DISCORD_CALLBACK_URL');
console.log('  - JWT_SECRET');
console.log('  - SUPABASE_URL');
console.log('  - SUPABASE_ANON_KEY');
console.log('  - REDIS_URL (optional, for session persistence)');

console.log('\n✨ Your server is ready for production deployment!');