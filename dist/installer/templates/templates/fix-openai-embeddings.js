// Patches OpenAI SDK's Embeddings.create() to inject encoding_format: "float"
// into the body BEFORE the SDK checks hasUserProvidedEncodingFormat.
// This makes the SDK skip its base64 response decoding, fixing vllm-mlx compat.
//
// The SDK flow: create(body) -> checks body.encoding_format -> if absent, adds "base64"
// and decodes response. By injecting "float" into body, the SDK treats it as
// user-provided and returns the response as-is.

const path = require('path');
const fs = require('fs');

// Find the openai module inside cipher's node_modules.
// Uses require.resolve() for version-resilient dynamic discovery.
function findOpenAIRoot() {
  // Strategy 1: Walk up from cipher's main entry point
  try {
    const cipherMain = require.resolve('@byterover/cipher');
    let dir = path.dirname(cipherMain);
    while (dir !== path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', 'openai');
      if (fs.existsSync(path.join(candidate, 'resources', 'embeddings.js'))) {
        return candidate;
      }
      dir = path.dirname(dir);
    }
  } catch {}

  // Strategy 2: Well-known global install paths as fallback
  const HOME = process.env.HOME || '';
  const candidates = [
    '/opt/homebrew/lib/node_modules/@byterover/cipher/node_modules/openai',
    path.join(HOME, '.npm-global/lib/node_modules/@byterover/cipher/node_modules/openai'),
    path.join(HOME, 'node_modules/@byterover/cipher/node_modules/openai'),
    '/usr/local/lib/node_modules/@byterover/cipher/node_modules/openai',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, 'resources', 'embeddings.js'))) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

const OPENAI_ROOT = findOpenAIRoot();

if (OPENAI_ROOT) {
  try {
    const embeddings = require(OPENAI_ROOT + '/resources/embeddings.js');
    if (embeddings && embeddings.Embeddings && embeddings.Embeddings.prototype) {
      const origCreate = embeddings.Embeddings.prototype.create;
      embeddings.Embeddings.prototype.create = function(body, options) {
        if (!body.encoding_format) {
          body = { ...body, encoding_format: 'float' };
        }
        return origCreate.call(this, body, options);
      };
      process.stderr.write('[fix-openai-embeddings] Patched Embeddings.create (encoding_format: float)\n');
    }
  } catch (e) {
    process.stderr.write('[fix-openai-embeddings] Failed to patch: ' + e.message + '\n');
  }
} else {
  process.stderr.write('[fix-openai-embeddings] OpenAI SDK not found in cipher node_modules — skipping patch\n');
}
