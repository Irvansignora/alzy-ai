// netlify/functions/chat.js
// Proxy ke OpenRouter dengan AUTO-FALLBACK model
// Kalau model 1 kena rate limit (429), otomatis coba model berikutnya

// ============================================================
// DAFTAR MODEL — urutan prioritas, free semua
// Tambah / hapus / ubah urutan sesuai kebutuhan
// ============================================================
const MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',   // 1. Llama 3.3 70B - terbaik
  'mistralai/mistral-7b-instruct:free',         // 2. Mistral 7B - cepat
  'google/gemma-3-4b-it:free',                  // 3. Gemma 3 - Google
  'deepseek/deepseek-r1:free',                  // 4. DeepSeek R1 - powerful
  'qwen/qwen2.5-7b-instruct:free',              // 5. Qwen 2.5 - backup
];

exports.handler = async (event) => {

  // CORS preflight
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
      body: JSON.stringify({
        error: 'OPENROUTER_API_KEY belum diset di Netlify. Pergi ke: Site configuration → Environment variables → Add variable → OPENROUTER_API_KEY'
      })
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

      // Kalau 429 (rate limit) atau 503 (unavailable) → coba model berikutnya
      if (response.status === 429 || response.status === 503) {
        console.log(`Model ${model} kena limit (${response.status}), coba model berikutnya...`);
        lastError = `${model} → ${response.status}`;
        continue;
      }

      // Kalau ada error dari provider di response body → coba berikutnya
      if (data.error && (data.error.code === 429 || data.error.code === 'rate_limit_exceeded')) {
        console.log(`Model ${model} rate limit dari provider, coba berikutnya...`);
        lastError = `${model} → provider rate limit`;
        continue;
      }

      // Sukses! Tambahkan info model yang dipakai ke response
      data._model_used = model;
      data._model_index = i + 1;

      return {
        statusCode: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(data)
      };

    } catch (err) {
      console.log(`Model ${model} error: ${err.message}`);
      lastError = `${model} → ${err.message}`;
      continue;
    }
  }

  // Semua model gagal
  return {
    statusCode: 429,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      error: `Semua model sedang kena rate limit. Coba lagi dalam beberapa menit. (${lastError})`
    })
  };
};
