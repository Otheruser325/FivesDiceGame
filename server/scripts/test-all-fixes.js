#!/usr/bin/env node

/**
 * Comprehensive test script to verify all fixes for Fives online functionality
 * Tests: 1. Express middleware genid function, 2. Discord OAuth, 3. Socket.io stability, 4. Supabase connectivity
 */

import fetch from 'node-fetch';
import { io } from 'socket.io-client';

const SERVER_URL = process.env.TEST_SERVER || 'http://localhost:8080';

console.log('🧪 Testing Fives Online Fixes...');
console.log('=====================================');
console.log(`📍 Testing server: ${SERVER_URL}`);

let testsPassed = 0;
let testsTotal = 0;

async function test(name, testFn) {
  testsTotal++;
  console.log(`\n📋 Test ${testsTotal}: ${name}`);
  try {
    const result = await testFn();
    if (result) {
      console.log(`✅ PASSED: ${name}`);
      testsPassed++;
    } else {
      console.log(`❌ FAILED: ${name}`);
    }
    return result;
  } catch (err) {
    console.log(`❌ ERROR: ${name} - ${err.message}`);
    return false;
  }
}

async function testServerHealth() {
  const response = await fetch(`${SERVER_URL}/health`, { timeout: 5000 });
  const data = await response.json();
  console.log(`   Health check response:`, data);
  return response.ok && data.ok === true;
}

async function testExpressMiddleware() {
  // Test that the server starts without "require is not defined" errors
  const response = await fetch(`${SERVER_URL}/health`, { timeout: 5000 });
  if (response.ok) {
    const data = await response.json();
    console.log(`   Server responded successfully:`, data);
    return true;
  }
  return false;
}

async function testDiscordOAuthProxy() {
  // Test the new Discord authorize proxy endpoint
  const testParams = {
    response_type: 'code',
    client_id: '1447019610141622475',
    redirect_uri: `${SERVER_URL}/auth/discord/callback`,
    scope: 'identify',
    state: 'test_state_123'
  };
  
  const queryString = new URLSearchParams(testParams).toString();
  const response = await fetch(`${SERVER_URL}/auth/discord/authorize?${queryString}`, { 
    timeout: 5000,
    redirect: 'manual' // Don't follow redirects
  });
  
  // Should return 302 redirect to Discord
  if (response.status === 302 || response.status === 307) {
    const location = response.headers.get('location');
    console.log(`   Discord OAuth proxy redirects to:`, location?.substring(0, 100) + '...');
    return location && location.includes('discord.com/oauth2/authorize');
  }
  
  console.log(`   Unexpected response status:`, response.status);
  return false;
}

async function testSocketConnection() {
  return new Promise((resolve) => {
    const socket = io(SERVER_URL, {
      transports: ['polling'],
      timeout: 5000,
      forceNew: true
    });
    
    let connected = false;
    let timeout = setTimeout(() => {
      if (!connected) {
        console.log(`   Socket connection timeout`);
        socket.disconnect();
        resolve(false);
      }
    }, 5000);
    
    socket.on('connect', () => {
      connected = true;
      console.log(`   Socket connected successfully with ID:`, socket.id);
      clearTimeout(timeout);
      socket.disconnect();
      resolve(true);
    });
    
    socket.on('connect_error', (err) => {
      console.log(`   Socket connection error:`, err.message);
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function testSupabaseConnectivity() {
  // Test guest creation endpoint which uses Supabase
  const guestData = {
    name: 'Test Guest',
    avatar: 'robot.png'
  };
  
  const response = await fetch(`${SERVER_URL}/auth/guest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(guestData),
    timeout: 10000
  });
  
  if (response.ok) {
    const data = await response.json();
    console.log(`   Guest creation response:`, { 
      success: data.ok, 
      userId: data.user?.id?.substring(0, 10) + '...',
      hasSession: !!data.session
    });
    return data.ok === true && data.user && data.user.id;
  } else {
    const errorText = await response.text();
    console.log(`   Guest creation failed:`, response.status, errorText.substring(0, 200));
    return false;
  }
}

async function testCORSHeaders() {
  // Test CORS preflight request
  const response = await fetch(`${SERVER_URL}/auth/discord/authorize`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://fives.vercel.app',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type'
    },
    timeout: 5000
  });
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
    'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
    'Access-Control-Allow-Credentials': response.headers.get('Access-Control-Allow-Credentials')
  };
  
  console.log(`   CORS headers:`, corsHeaders);
  
  return response.ok && 
         corsHeaders['Access-Control-Allow-Origin'] &&
         corsHeaders['Access-Control-Allow-Methods']?.includes('GET');
}

async function runAllTests() {
  console.log(`\n🚀 Starting comprehensive tests...`);
  
  // Test 1: Express middleware (genid function fix)
  await test('Express middleware genid function', testExpressMiddleware);
  
  // Test 2: Server health endpoint
  await test('Server health endpoint', testServerHealth);
  
  // Test 3: Discord OAuth proxy endpoint
  await test('Discord OAuth proxy endpoint', testDiscordOAuthProxy);
  
  // Test 4: Socket.io connection stability
  await test('Socket.io connection stability', testSocketConnection);
  
  // Test 5: Supabase connectivity (guest creation)
  await test('Supabase connectivity (guest creation)', testSupabaseConnectivity);
  
  // Test 6: CORS headers for cross-site requests
  await test('CORS headers for cross-site requests', testCORSHeaders);
  
  console.log('\n📊 Test Results Summary');
  console.log('=======================');
  console.log(`Tests passed: ${testsPassed}/${testsTotal}`);
  console.log(`Success rate: ${Math.round((testsPassed / testsTotal) * 100)}%`);
  
  if (testsPassed === testsTotal) {
    console.log('\n🎉 All tests passed! The fixes are working correctly.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please check the logs above.');
    process.exit(1);
  }
}

// Run the tests
console.log('🚀 Starting comprehensive tests...');
runAllTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});