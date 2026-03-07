// netlify/functions/chat.js
// Proxy ke OpenRouter dengan AUTO-FALLBACK model

const MODELS = [
  'openrouter/auto',                               // OpenRouter auto-select best model
  'meta-llama/llama-3.3-70b-instruct:free',        // Llama 3.3 70B
  'google/gemma-3-27b-it:free',                    // Gemma 3 27B
  'mistralai/mistral-small-3.1-24b-instruct:free', // Mistral Small 3.1
  'openrouter/free',                               // Last resort: OpenRouter random free model
];

exports.handler = async (event) => {

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'OPENROUTER_API_KEY belum diset di Netlify Environment Variables.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'messages array is required' })
    };
  }

  const referer = event.headers?.referer || event.headers?.origin || 'https://alzy-ai.netlify.app';
  let lastError = null;

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    console.log(`[Alzy] Trying model ${i+1}/${MODELS.length}: ${model}`);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': referer,
          'X-Title': 'Alzy AI'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 1024,
          messages: body.messages
        })
      });

      const text = await response.text(); // get raw text first
      console.log(`[Alzy] Model ${model} status: ${response.status}, body preview: ${text.slice(0,200)}`);

      let data;
      try { data = JSON.parse(text); }
      catch(e) {
        lastError = `${model} → invalid JSON response`;
        continue;
      }

      // Skip on rate limit / not found / server error
      if (response.status === 400 || response.status === 429 || response.status === 404 || response.status === 503) {
        lastError = `${model} → HTTP ${response.status}`;
        continue;
      }

      // Skip if error in body
      if (data.error) {
        const code = String(data.error.code || data.error.status || '');
        if (code === '400' || code === '429' || code === '404' || code === '503' || code.includes('rate') || code.includes('valid')) {
          lastError = `${model} → ${data.error.message || code}`;
          continue;
        }
        // Other errors — still return to client with model info
        data._model_used = model;
        return {
          statusCode: response.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(data)
        };
      }

      // Verify there's actual content in the response
      const content = data.choices?.[0]?.message?.content;
      if (!content && content !== 0) {
        console.log(`[Alzy] Model ${model} returned empty content, trying next...`);
        lastError = `${model} → empty content`;
        continue;
      }

      // SUCCESS
      console.log(`[Alzy] SUCCESS with model: ${model}`);
      data._model_used = model;
      data._model_index = i + 1;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data)
      };

    } catch (err) {
      console.log(`[Alzy] Model ${model} threw: ${err.message}`);
      lastError = `${model} → ${err.message}`;
      continue;
    }
  }

  return {
    statusCode: 429,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      error: `Semua model sedang sibuk. Coba lagi dalam beberapa menit. (${lastError})`
    })
  };
};
