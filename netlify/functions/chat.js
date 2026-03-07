// netlify/functions/chat.js
// Proxy ke OpenRouter dengan AUTO-FALLBACK model

// ============================================================
// DAFTAR MODEL — urutan prioritas, semua free & aktif
// ============================================================
const MODELS = [
  'meta-llama/llama-3.1-8b-instruct:free',     // 1. Llama 3.1 8B - stabil
  'meta-llama/llama-3.2-3b-instruct:free',      // 2. Llama 3.2 3B - ringan
  'google/gemma-3-4b-it:free',                  // 3. Gemma 3 4B - Google
  'google/gemma-3-1b-it:free',                  // 4. Gemma 3 1B - paling ringan
  'qwen/qwen2.5-7b-instruct:free',              // 5. Qwen 2.5 7B - backup
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

  // ── AUTO FALLBACK LOOP ──────────────────────────────────
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];

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
          max_tokens: body.max_tokens || 1024,
          messages: body.messages
        })
      });

      const data = await response.json();

      // Skip ke model berikutnya kalau rate limit / not found / unavailable
      if (response.status === 429 || response.status === 503 || response.status === 404) {
        console.log(`Model [${i+1}] ${model} skip (${response.status}), coba berikutnya...`);
        lastError = `${model} → ${response.status}`;
        continue;
      }

      // Skip kalau provider error di body
      if (data.error) {
        const code = data.error.code || data.error.status;
        if (code === 429 || code === 404 || code === 503 || String(code).includes('rate')) {
          console.log(`Model [${i+1}] ${model} error dari provider, coba berikutnya...`);
          lastError = `${model} → ${JSON.stringify(data.error)}`;
          continue;
        }
      }

      // Sukses!
      data._model_used = model;
      data._model_index = i + 1;

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(data)
      };

    } catch (err) {
      console.log(`Model [${i+1}] ${model} catch error: ${err.message}`);
      lastError = `${model} → ${err.message}`;
      continue;
    }
  }

  // Semua model gagal
  return {
    statusCode: 429,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      error: `Semua model sedang sibuk. Coba lagi dalam beberapa menit. Detail: ${lastError}`
    })
  };
};
