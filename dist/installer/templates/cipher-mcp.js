#!/usr/bin/env node
// Wrapper for cipher MCP that:
// 1. Filters stray non-JSON stdout lines (cipher v0.3.0 prints "storeType qdrant")
// 2. Points to user config (~/.cipher/cipher.yml) with correct local embedding model
// 3. Injects HTTP-level fix for OpenAI SDK base64 encoding_format issue via NODE_OPTIONS
const { spawn } = require('child_process');
const path = require('path');

const userConfig = path.join(process.env.HOME, '.cipher', 'cipher.yml');
const httpFix = path.join(process.env.HOME, '.local', 'lib', 'fix-openai-embeddings.js');

const child = spawn('cipher', ['--mode', 'mcp', '--agent', userConfig], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS || '',
      `--require ${httpFix}`
    ].filter(Boolean).join(' ')
  }
});

// Forward stdin to child
process.stdin.pipe(child.stdin);

// Filter stdout: only pass through lines starting with '{'
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (line.startsWith('{')) {
      process.stdout.write(line + '\n');
    }
  }
});

child.stdout.on('end', () => {
  if (buffer && buffer.startsWith('{')) {
    process.stdout.write(buffer + '\n');
  }
});

child.on('exit', (code) => process.exit(code || 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
