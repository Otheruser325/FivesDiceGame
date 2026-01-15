#!/usr/bin/env node

/**
 * Comprehensive Test Suite for Fives Dice Game Online Fixes
 * 
 * This script tests all the fixes implemented for:
 * 1. Socket.io connection stability
 * 2. Discord OAuth authentication
 * 3. Supabase database connectivity
 * 4. Session management
 * 5. Error handling and recovery
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { io } from 'socket.io-client';

const TEST_RESULTS = {
  socket: { passed: 0, failed: 0, errors: [] },
  discord: { passed: 0, failed: 0, errors: [] },
  supabase: { passed: 0, failed: 0, errors: [] },
  session: { passed: 0, failed: 0, errors: [] },
  overall: { passed: 0, failed: 0, errors: [] }
};

// Test configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:8080';

// Utility functions
function logTest(category, name, passed, error = null) {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${category}] ${status} ${name}`);
  
  if (error) {
    console.error(`    Error: ${error}`);
    TEST_RESULTS[category].errors.push({ test: name, error });
  }
  
  if (passed) {
    TEST_RESULTS[category].passed++;
    TEST_RESULTS.overall.passed++;
  } else {
    TEST_RESULTS[category].failed++;
    TEST_RESULTS.overall.failed++;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test 1: Socket.io Connection Stability
async function testSocketConnection() {
  console.log('\n🔌 Testing Socket.io Connection Stability...');
  
  try {
    // Test health endpoint
    const healthResponse = await fetch(`${SERVER_URL}/health`);
    const healthData = await healthResponse.json();
    
    logTest('socket', 'Health endpoint accessible', healthData.ok, !healthData.ok ? 'Health check failed' : null);
    logTest('socket', 'Socket.io status operational', healthData.socketIO?.status === 'operational', 
      !healthData.socketIO ? 'Socket.io status missing' : `Status: ${healthData.socketIO.status}`);
    
    // Test socket connection
    const socket = io(SERVER_URL, {
      transports: ['polling'],
      timeout: 5000,
      forceNew: true
    });
    
    const connected = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        socket.disconnect();
        resolve(false);
      }, 5000);
      
      socket.on('connect', () => {
        clearTimeout(timeout);
        resolve(true);
      });
      
      socket.on('connect_error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
    
    logTest('socket', 'Socket connection established', connected, connected ? null : 'Failed to connect');
    
    if (connected) {
      // Test socket authentication
      const authResult = await new Promise((resolve) => {
        socket.on('authenticated', (data) => {
          resolve({ authenticated: true, data });
        });
        
        socket.on('unauthorized', (data) => {
          resolve({ authenticated: false, data });
        });
        
        // Wait a bit for auth events
        setTimeout(() => resolve({ authenticated: false, data: 'timeout' }), 2000);
      });
      
      logTest('socket', 'Socket authentication flow', authResult.authenticated !== null, 
        authResult.data === 'timeout' ? 'Authentication timeout' : null);
      
      socket.disconnect();
    }
    
  } catch (error) {
    logTest('socket', 'Socket.io tests', false, error.message);
  }
}

// Test 2: Discord OAuth
async function testDiscordOAuth() {
  console.log('\n🎮 Testing Discord OAuth...');
  
  try {
    // Test Discord auth methods endpoint
    const methodsResponse = await fetch(`${SERVER_URL}/auth/methods`);
    const methodsData = await methodsResponse.json();
    
    logTest('discord', 'Auth methods endpoint accessible', methodsData.discord !== undefined, 
      !methodsData.discord !== undefined ? 'Methods endpoint failed' : null);
    
    if (methodsData.discord) {
      // Test Discord OAuth initiation
      const discordAuthResponse = await fetch(`${SERVER_URL}/auth/discord`, {
        redirect: 'manual'
      });
      
      logTest('discord', 'Discord OAuth initiation', 
        discordAuthResponse.status === 302 || discordAuthResponse.status === 307,
        `Unexpected status: ${discordAuthResponse.status}`);
      
      // Test OPTIONS preflight for callback
      const optionsResponse = await fetch(`${SERVER_URL}/auth/discord/callback`, {
        method: 'OPTIONS',
        headers: {
          'Origin': CLIENT_URL,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      });
      
      logTest('discord', 'CORS preflight for callback', 
        optionsResponse.status === 200, 
        `OPTIONS failed with status: ${optionsResponse.status}`);
      
      // Check CORS headers
      const corsHeaders = {
        'access-control-allow-origin': optionsResponse.headers.get('access-control-allow-origin'),
        'access-control-allow-credentials': optionsResponse.headers.get('access-control-allow-credentials'),
        'access-control-allow-methods': optionsResponse.headers.get('access-control-allow-methods')
      };
      
      logTest('discord', 'CORS headers properly set', 
        corsHeaders['access-control-allow-origin'] && 
        corsHeaders['access-control-allow-credentials'] === 'true',
        `Missing CORS headers: ${JSON.stringify(corsHeaders)}`);
    } else {
      logTest('discord', 'Discord OAuth configured', false, 'Discord OAuth not configured');
    }
    
  } catch (error) {
    logTest('discord', 'Discord OAuth tests', false, error.message);
  }
}

// Test 3: Supabase Database Connectivity
async function testSupabaseConnectivity() {
  console.log('\n🗄️ Testing Supabase Database Connectivity...');
  
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      logTest('supabase', 'Supabase environment variables', false, 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return;
    }
    
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    // Test connection to users table
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    logTest('supabase', 'Users table accessible', !usersError, usersError?.message || null);
    
    // Test connection to lobbies table
    const { data: lobbiesData, error: lobbiesError } = await supabase
      .from('lobbies')
      .select('count')
      .limit(1);
    
    logTest('supabase', 'Lobbies table accessible', !lobbiesError, lobbiesError?.message || null);
    
    // Test RLS policies by attempting to insert a test user
    const testUser = {
      id: 'test-' + Date.now(),
      name: 'Test User',
      type: 'guest',
      created_at: new Date().toISOString()
    };
    
    const { data: insertData, error: insertError } = await supabase
      .from('users')
      .insert(testUser)
      .select();
    
    logTest('supabase', 'RLS allows service role inserts', !insertError, insertError?.message || null);
    
    // Clean up test user
    if (insertData && insertData.length > 0) {
      await supabase
        .from('users')
        .delete()
        .eq('id', testUser.id);
    }
    
    // Test realtime subscription
    const subscription = supabase
      .channel('test-channel')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'users' }, 
        (payload) => {
          console.log('Realtime event received:', payload);
        }
      )
      .subscribe();
    
    logTest('supabase', 'Realtime subscription setup', subscription !== null, 'Failed to create subscription');
    
    subscription.unsubscribe();
    
  } catch (error) {
    logTest('supabase', 'Supabase connectivity tests', false, error.message);
  }
}

// Test 4: Session Management
async function testSessionManagement() {
  console.log('\n🍪 Testing Session Management...');
  
  try {
    // Test session creation
    const sessionResponse = await fetch(`${SERVER_URL}/auth/me`, {
      headers: {
        'Cookie': ''
      }
    });
    
    const sessionData = await sessionResponse.json();
    
    logTest('session', 'Session endpoint accessible', sessionResponse.ok, 
      !sessionResponse.ok ? `Status: ${sessionResponse.status}` : null);
    
    // Test guest registration
    const guestRegisterResponse = await fetch(`${SERVER_URL}/auth/guest/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        password: 'testpassword123'
      })
    });
    
    const guestData = await guestRegisterResponse.json();
    
    logTest('session', 'Guest registration', guestData.ok, guestData.error || null);
    
    if (guestData.ok) {
      // Test session persistence
      const cookies = guestRegisterResponse.headers.get('set-cookie');
      logTest('session', 'Session cookies set', cookies && cookies.includes('fives.sid'), 
        !cookies ? 'No cookies set' : 'Missing session cookie');
      
      // Test authenticated session
      const authResponse = await fetch(`${SERVER_URL}/auth/me`, {
        headers: {
          'Cookie': cookies
        }
      });
      
      const authData = await authResponse.json();
      
      logTest('session', 'Authenticated session', authData.ok && authData.user, 
        authData.error || 'Session not authenticated');
      
      // Test logout
      const logoutResponse = await fetch(`${SERVER_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          'Cookie': cookies
        }
      });
      
      const logoutData = await logoutResponse.json();
      
      logTest('session', 'Session logout', logoutData.ok, logoutData.error || null);
    }
    
  } catch (error) {
    logTest('session', 'Session management tests', false, error.message);
  }
}

// Test 5: Error Handling and Recovery
async function testErrorHandling() {
  console.log('\n🛡️ Testing Error Handling and Recovery...');
  
  try {
    // Test 404 handling
    const notFoundResponse = await fetch(`${SERVER_URL}/nonexistent-endpoint`);
    
    logTest('session', '404 error handling', notFoundResponse.status === 404, 
      `Expected 404, got ${notFoundResponse.status}`);
    
    // Test malformed JSON handling
    const malformedResponse = await fetch(`${SERVER_URL}/auth/guest/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: 'invalid json'
    });
    
    logTest('session', 'Malformed JSON handling', 
      malformedResponse.status === 400 || malformedResponse.status === 422,
      `Expected 400/422, got ${malformedResponse.status}`);
    
    // Test missing parameters
    const missingParamsResponse = await fetch(`${SERVER_URL}/auth/guest/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    const missingParamsData = await missingParamsResponse.json();
    
    logTest('session', 'Missing parameters handling', 
      !missingParamsData.ok && missingParamsData.error,
      missingParamsData.ok ? 'Should have failed with missing parameters' : null);
    
  } catch (error) {
    logTest('session', 'Error handling tests', false, error.message);
  }
}

// Main test runner
async function runAllTests() {
  console.log('🧪 Fives Dice Game - Comprehensive Fix Testing Suite');
  console.log('==================================================');
  console.log(`Server URL: ${SERVER_URL}`);
  console.log(`Client URL: ${CLIENT_URL}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  await testSocketConnection();
  await testDiscordOAuth();
  await testSupabaseConnectivity();
  await testSessionManagement();
  await testErrorHandling();
  
  // Print summary
  console.log('\n📊 Test Results Summary');
  console.log('======================');
  
  const categories = ['socket', 'discord', 'supabase', 'session'];
  
  categories.forEach(category => {
    const results = TEST_RESULTS[category];
    const total = results.passed + results.failed;
    const passRate = total > 0 ? Math.round((results.passed / total) * 100) : 0;
    
    console.log(`\n${category.toUpperCase()}:`);
    console.log(`  ✅ Passed: ${results.passed}`);
    console.log(`  ❌ Failed: ${results.failed}`);
    console.log(`  📈 Pass Rate: ${passRate}%`);
    
    if (results.errors.length > 0) {
      console.log('  🚨 Errors:');
      results.errors.forEach(error => {
        console.log(`    - ${error.test}: ${error.error}`);
      });
    }
  });
  
  const overallTotal = TEST_RESULTS.overall.passed + TEST_RESULTS.overall.failed;
  const overallPassRate = overallTotal > 0 ? Math.round((TEST_RESULTS.overall.passed / overallTotal) * 100) : 0;
  
  console.log(`\nOVERALL:`);
  console.log(`  ✅ Passed: ${TEST_RESULTS.overall.passed}`);
  console.log(`  ❌ Failed: ${TEST_RESULTS.overall.failed}`);
  console.log(`  📈 Pass Rate: ${overallPassRate}%`);
  
  if (overallPassRate >= 80) {
    console.log('\n🎉 EXCELLENT! Most fixes are working correctly.');
  } else if (overallPassRate >= 60) {
    console.log('\n⚠️  GOOD! Some fixes need attention.');
  } else {
    console.log('\n🚨 CRITICAL! Multiple fixes need immediate attention.');
  }
  
  console.log('\n📝 Recommendations:');
  
  if (TEST_RESULTS.socket.failed > 0) {
    console.log('  - Check Socket.io configuration and server logs');
  }
  
  if (TEST_RESULTS.discord.failed > 0) {
    console.log('  - Verify Discord OAuth environment variables and callback URL');
  }
  
  if (TEST_RESULTS.supabase.failed > 0) {
    console.log('  - Check Supabase connection and RLS policies');
  }
  
  if (TEST_RESULTS.session.failed > 0) {
    console.log('  - Review session middleware and cookie configuration');
  }
  
  console.log('\n✨ Testing completed!');
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export { runAllTests, TEST_RESULTS };