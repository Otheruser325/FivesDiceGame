#!/usr/bin/env node

/**
 * Comprehensive testing script for Fives Dice Game server fixes
 * Tests all the implemented fixes for Socket.io, Discord OAuth, Supabase, and error handling
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import io from 'socket.io-client';
import fetch from 'node-fetch';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🎲 Fives Dice Game - Server Fixes Test Suite');
console.log('==========================================\n');

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

// Helper function to run a test
async function runTest(name, testFn) {
  testResults.total++;
  console.log(`🧪 Running test: ${name}`);
  
  try {
    const result = await testFn();
    if (result.passed) {
      console.log(`✅ ${name} - PASSED`);
      if (result.message) console.log(`   ${result.message}`);
      testResults.passed++;
      testResults.details.push({ name, status: 'PASSED', message: result.message });
    } else {
      console.log(`❌ ${name} - FAILED`);
      console.log(`   ${result.message}`);
      testResults.failed++;
      testResults.details.push({ name, status: 'FAILED', message: result.message });
    }
  } catch (error) {
    console.log(`❌ ${name} - ERROR`);
    console.log(`   ${error.message}`);
    testResults.failed++;
    testResults.details.push({ name, status: 'ERROR', message: error.message });
  }
  
  console.log('');
}

// Test 1: Server Health Check
async function testServerHealth() {
  const response = await fetch(`${SERVER_URL}/health`);
  const health = await response.json();
  
  if (!health.ok) {
    return { passed: false, message: 'Health check failed' };
  }
  
  if (health.socketIO.status !== 'operational') {
    return { passed: false, message: `Socket.io status: ${health.socketIO.status}` };
  }
  
  return { 
    passed: true, 
    message: `Server healthy, ${health.socketIO.connected} clients connected` 
  };
}

// Test 2: Socket.io Connection
async function testSocketConnection() {
  return new Promise((resolve) => {
    const socket = io(SERVER_URL, {
      transports: ['polling'],
      timeout: 5000
    });
    
    const timeout = setTimeout(() => {
      socket.disconnect();
      resolve({ passed: false, message: 'Connection timeout' });
    }, 5000);
    
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.disconnect();
      resolve({ passed: true, message: `Connected with socket ID: ${socket.id}` });
    });
    
    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      resolve({ passed: false, message: `Connection error: ${error.message}` });
    });
  });
}

// Test 3: Supabase Connection
async function testSupabaseConnection() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { passed: false, message: 'Supabase credentials not configured' };
  }
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  try {
    // Test users table access
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (usersError) {
      return { passed: false, message: `Users table error: ${usersError.message}` };
    }
    
    // Test lobbies table access
    const { data: lobbies, error: lobbiesError } = await supabase
      .from('lobbies')
      .select('count')
      .limit(1);
    
    if (lobbiesError) {
      return { passed: false, message: `Lobbies table error: ${lobbiesError.message}` };
    }
    
    return { passed: true, message: 'Supabase connection successful' };
  } catch (error) {
    return { passed: false, message: `Supabase connection failed: ${error.message}` };
  }
}

// Test 4: Discord OAuth Endpoint
async function testDiscordOAuth() {
  try {
    const response = await fetch(`${SERVER_URL}/auth/discord`, {
      redirect: 'manual' // Don't follow redirects
    });
    
    if (response.status === 302) {
      const location = response.headers.get('location');
      if (location && location.includes('discord.com/oauth2/authorize')) {
        return { passed: true, message: 'Discord OAuth redirect working' };
      }
    }
    
    return { passed: false, message: `Unexpected response: ${response.status}` };
  } catch (error) {
    return { passed: false, message: `Discord OAuth test failed: ${error.message}` };
  }
}

// Test 5: CORS Headers
async function testCORSHeaders() {
  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      headers: { Origin: 'https://fivesdicegame.vercel.app' }
    });
    
    const corsHeader = response.headers.get('Access-Control-Allow-Origin');
    if (!corsHeader) {
      return { passed: false, message: 'CORS headers missing' };
    }
    
    return { passed: true, message: `CORS header: ${corsHeader}` };
  } catch (error) {
    return { passed: false, message: `CORS test failed: ${error.message}` };
  }
}

// Test 6: Error Handling
async function testErrorHandling() {
  try {
    const response = await fetch(`${SERVER_URL}/nonexistent-endpoint`);
    
    if (response.status === 404) {
      const error = await response.json();
      if (error.error) {
        return { passed: true, message: 'Proper error response format' };
      }
    }
    
    return { passed: false, message: 'Error handling not working correctly' };
  } catch (error) {
    return { passed: false, message: `Error handling test failed: ${error.message}` };
  }
}

// Test 7: Session Configuration
async function testSessionConfig() {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const cookies = response.headers.get('set-cookie');
    
    // Check if session cookie is configured properly
    if (cookies && cookies.includes('fives.sid')) {
      return { passed: true, message: 'Session cookie configured' };
    }
    
    return { passed: false, message: 'Session cookie not found' };
  } catch (error) {
    return { passed: false, message: `Session test failed: ${error.message}` };
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting comprehensive server tests...\n');
  
  await runTest('Server Health Check', testServerHealth);
  await runTest('Socket.io Connection', testSocketConnection);
  await runTest('Supabase Connection', testSupabaseConnection);
  await runTest('Discord OAuth Endpoint', testDiscordOAuth);
  await runTest('CORS Headers', testCORSHeaders);
  await runTest('Error Handling', testErrorHandling);
  await runTest('Session Configuration', testSessionConfig);
  
  // Print summary
  console.log('📊 Test Results Summary');
  console.log('=======================');
  console.log(`Total tests: ${testResults.total}`);
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`Success rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%\n`);
  
  // Print detailed results
  console.log('📋 Detailed Results');
  console.log('==================');
  testResults.details.forEach(test => {
    const icon = test.status === 'PASSED' ? '✅' : test.status === 'FAILED' ? '❌' : '💥';
    console.log(`${icon} ${test.name}: ${test.message}`);
  });
  
  console.log('\n🎯 Recommendations:');
  if (testResults.failed === 0) {
    console.log('🎉 All tests passed! Your server is ready for deployment.');
  } else {
    console.log('⚠️  Some tests failed. Please review the failed tests and fix the issues.');
    console.log('💡 Make sure to:');
    console.log('   - Check your environment variables (.env file)');
    console.log('   - Ensure Supabase is properly configured');
    console.log('   - Verify Discord OAuth settings');
    console.log('   - Run the Supabase fixes: npm run fix-supabase');
  }
  
  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Handle uncaught errors
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

// Run the tests
runAllTests().catch(console.error);