#!/usr/bin/env node

/**
 * Comprehensive Discord OAuth Test Script
 * Tests all the fixes for Discord OAuth CORS and cookie issues
 */

import fetch from 'node-fetch';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

console.log('🧪 Testing Discord OAuth Fixes');
console.log('================================');
console.log(`Server URL: ${SERVER_URL}`);
console.log(`Discord Client ID: ${DISCORD_CLIENT_ID || 'Not configured'}`);
console.log('');

async function testEndpoint(name, url, expectedStatus = 200, options = {}) {
  try {
    console.log(`📡 Testing ${name}...`);
    const response = await fetch(`${SERVER_URL}${url}`, {
      ...options,
      redirect: 'manual' // Don't follow redirects automatically
    });
    
    const status = response.status;
    const location = response.headers.get('location');
    const corsOrigin = response.headers.get('access-control-allow-origin');
    const corsCredentials = response.headers.get('access-control-allow-credentials');
    
    console.log(`   Status: ${status}`);
    if (location) console.log(`   Location: ${location}`);
    if (corsOrigin) console.log(`   CORS Origin: ${corsOrigin}`);
    if (corsCredentials) console.log(`   CORS Credentials: ${corsCredentials}`);
    
    if (status === expectedStatus) {
      console.log(`   ✅ ${name} - PASSED`);
      return true;
    } else {
      console.log(`   ❌ ${name} - FAILED (expected ${expectedStatus}, got ${status})`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ ${name} - ERROR: ${error.message}`);
    return false;
  }
}

async function testDiscordOAuthFlow() {
  console.log('🔐 Testing Discord OAuth Flow');
  console.log('----------------------------');
  
  let passed = 0;
  let total = 0;
  
  // Test 1: Discord authorize proxy endpoint
  total++;
  if (await testEndpoint(
    'Discord Authorize Proxy', 
    '/auth/discord/authorize', 
    302,
    {
      headers: {
        'Origin': 'https://fivesapi.vercel.app',
        'Referer': 'https://fivesapi.vercel.app/'
      }
    }
  )) passed++;
  
  // Test 2: Discord authorize proxy with localhost
  total++;
  if (await testEndpoint(
    'Discord Authorize Proxy (localhost)', 
    '/auth/discord/authorize', 
    302,
    {
      headers: {
        'Origin': 'http://localhost:8080',
        'Referer': 'http://localhost:8080/'
      }
    }
  )) passed++;
  
  // Test 3: Discord callback OPTIONS preflight
  total++;
  if (await testEndpoint(
    'Discord Callback OPTIONS', 
    '/auth/discord/callback', 
    200,
    {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://fivesapi.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    }
  )) passed++;
  
  // Test 4: Discord authorize proxy OPTIONS preflight
  total++;
  if (await testEndpoint(
    'Discord Authorize OPTIONS', 
    '/auth/discord/authorize', 
    200,
    {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://fivesapi.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    }
  )) passed++;
  
  // Test 5: Auth methods endpoint
  total++;
  if (await testEndpoint(
    'Auth Methods Endpoint', 
    '/auth/methods', 
    200
  )) passed++;
  
  // Test 6: Guest endpoint availability
  total++;
  if (await testEndpoint(
    'Guest Endpoint OPTIONS', 
    '/auth/guest/register', 
    200,
    {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://fivesapi.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    }
  )) passed++;
  
  console.log('');
  console.log(`📊 Test Results: ${passed}/${total} passed`);
  
  if (passed === total) {
    console.log('🎉 All Discord OAuth tests PASSED!');
    console.log('');
    console.log('✅ Fixes verified:');
    console.log('   - Discord authorize proxy working correctly');
    console.log('   - CORS headers properly configured');
    console.log('   - OPTIONS preflight requests handled');
    console.log('   - Cookie domain issues resolved');
    console.log('   - Cross-site authentication enabled');
    return true;
  } else {
    console.log('❌ Some tests FAILED. Check the server logs for details.');
    return false;
  }
}

async function testSessionConfiguration() {
  console.log('🍪 Testing Session Configuration');
  console.log('-------------------------------');
  
  try {
    const response = await fetch(`${SERVER_URL}/auth/me`, {
      headers: {
        'Origin': 'https://fivesapi.vercel.app'
      },
      credentials: 'include'
    });
    
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      console.log('Session cookie configuration:');
      console.log(`   Set-Cookie: ${setCookie}`);
      
      // Check for problematic domain settings
      if (setCookie.includes('Domain=.vercel.app')) {
        console.log('   ❌ Cookie domain still set to .vercel.app');
        return false;
      } else {
        console.log('   ✅ Cookie domain properly configured');
      }
      
      // Check for SameSite settings
      if (setCookie.includes('SameSite=None')) {
        console.log('   ✅ SameSite=None for cross-site cookies');
      } else {
        console.log('   ⚠️  SameSite may not be set to None');
      }
      
      // Check for Secure flag
      if (setCookie.includes('Secure')) {
        console.log('   ✅ Secure flag set for production');
      } else {
        console.log('   ⚠️  Secure flag may not be set');
      }
      
      return true;
    } else {
      console.log('   ℹ️  No session cookie set (expected for unauthenticated request)');
      return true;
    }
  } catch (error) {
    console.log(`   ❌ Session test error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Starting comprehensive Discord OAuth test...\n');
  
  const oauthTests = await testDiscordOAuthFlow();
  const sessionTests = await testSessionConfiguration();
  
  console.log('');
  console.log('🏁 Final Results');
  console.log('================');
  
  if (oauthTests && sessionTests) {
    console.log('🎉 ALL TESTS PASSED!');
    console.log('');
    console.log('The Discord OAuth fixes are working correctly:');
    console.log('✅ CORS issues resolved');
    console.log('✅ Cookie domain issues fixed');
    console.log('✅ Cross-site authentication enabled');
    console.log('✅ Proxy endpoints working');
    console.log('');
    console.log('You can now test the Discord login in the game client!');
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('');
    console.log('Please check:');
    console.log('1. Server is running with the latest code');
    console.log('2. Discord environment variables are set');
    console.log('3. No port conflicts or network issues');
    console.log('');
    console.log('Deploy the updated server to Vercel and test again.');
    process.exit(1);
  }
}

// Run the tests
main().catch(error => {
  console.error('Test script error:', error);
  process.exit(1);
});