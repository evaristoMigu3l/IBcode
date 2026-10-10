// test-zen-free.mjs
import crypto from 'node:crypto';

const apiKey = process.env.OPENCODE_API_KEY || 'oc_sk_7e463331942b_mloOhopCmakBcv7OGQGUjXGaGdjOk36Z';

async function testEndpoint(name, url, headers, body) {
  console.log(`\n=============================================`);
  console.log(`Testing: ${name}`);
  console.log(`URL: ${url}`);
  console.log(`Model: ${body.model || 'N/A'}`);
  console.log(`---------------------------------------------`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body)
    });

    console.log(`HTTP Status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    try {
      console.log('Body:', JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      console.log('Body (raw):', text);
    }
  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

async function run() {
  const modelToTest = 'mimo-v2.5-free';

  // 1. Standard OpenAI Chat Completions (Default headers)
  await testEndpoint(
    'Standard OpenAI Chat Completion',
    'https://opencode.ai/zen/v1/chat/completions',
    {},
    {
      model: modelToTest,
      messages: [{ role: 'user', content: 'Say hello in 3 words' }]
    }
  );

  // 2. OpenCode Client Headers emulation
  await testEndpoint(
    'OpenCode Client Headers Emulation',
    'https://opencode.ai/zen/v1/chat/completions',
    {
      'User-Agent': 'opencode/1.18.31',
      'x-opencode-session': crypto.randomUUID(),
      'x-opencode-request': crypto.randomUUID(),
      'x-opencode-client': 'cli'
    },
    {
      model: modelToTest,
      messages: [{ role: 'user', content: 'Say hello in 3 words' }]
    }
  );

  // 3. OpenCode Zen Go Gateway
  await testEndpoint(
    'OpenCode Zen Go Endpoint',
    'https://opencode.ai/zen/go/v1/chat/completions',
    {
      'x-opencode-session': crypto.randomUUID()
    },
    {
      model: 'space-bunny-free',
      messages: [{ role: 'user', content: 'Say hello in 3 words' }]
    }
  );

  // 4. OpenCode SystemOne Task Endpoint
  await testEndpoint(
    'OpenCode SystemOne Endpoint',
    'https://opencode.ai/zen/v1/systemone',
    {},
    {
      model: 'jev-1.13',
      state: 'Test healthcheck state query.',
      questions: {
        is_ok: { type: 'bool', prompt: 'Is this working?' }
      }
    }
  );
}

run();
