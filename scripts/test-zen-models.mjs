// test-zen-models.mjs
const apiKey = process.env.OPENCODE_API_KEY || 'oc_sk_7e463331942b_mloOhopCmakBcv7OGQGUjXGaGdjOk36Z';
const endpoint = 'https://opencode.ai/zen/v1/models';

async function getAvailableModels() {
  console.log(`Connecting to ${endpoint} ...\n`);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Status: ${response.status} ${response.statusText}`);
    const data = await response.json();
    
    if (data.data && Array.isArray(data.data)) {
      const freeModels = data.data.filter(m => m.id.includes('free'));
      const allModels = data.data.map(m => m.id);
      
      console.log(`\n=== Total Models: ${allModels.length} ===`);
      console.log(`=== Free Tier Models (${freeModels.length}) ===:`);
      freeModels.forEach(m => console.log(`  - ${m.id}`));
      
      console.log('\n=== Sample Other Models ===:');
      allModels.filter(id => !id.includes('free')).slice(0, 10).forEach(id => console.log(`  - ${id}`));
    } else {
      console.log('Response:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('Fetch error:', error);
  }
}

getAvailableModels();
