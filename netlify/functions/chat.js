// netlify/functions/chat.js
// Proxy ke OpenRouter dengan AUTO-FALLBACK model

const MODELS = [
  'meta-llama/llama-3.1-8b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'google/gemma-3-4b-it:free',
  'google/gemma-3-1b-it:free',
  'qwen/qwen2.5-7b-instruct:free',
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

  // ── FIX: Handle system message ────────────────────────────
  // Pisahkan system message dari conversation messages.
  // Banyak free model di OpenRouter TIDAK support role:"system"
  // dan akan return 400. Solusinya: inject system prompt ke
  // awal pesan pertama sebagai role:"user" prefix.

  let systemPrompt = null;
  let conversationMessages = body.messages;

  // Cek apakah ada system message di index 0
  if (body.messages[0]?.role === 'system') {
    systemPrompt = body.messages[0].content;
    conversationMessages = body.messages.slice(1); // buang system msg
  }

  // Kalau ada system prompt, inject ke user message pertama
  let finalMessages = conversationMessages;
  if (systemPrompt && conversationMessages.length > 0) {
    finalMessages = conversationMessages.map((msg, idx) => {
      if (idx === 0 && msg.role === 'user') {
        return {
          role: 'user',
          content: `[SYSTEM INSTRUCTION - follow this throughout the conversation]\n${systemPrompt}\n\n[USER MESSAGE]\n${msg.content}`
        };
      }
      return msg;
    });
  }

  // Fallback: kalau tidak ada pesan setelah system, buat pesan starter
  if (finalMessages.length === 0) {
    finalMessages = [{ role: 'user', content: systemPrompt || 'Hello' }];
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
          messages: finalMessages  // pakai messages yang sudah di-fix
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

      // ── FIX: Tambahkan 400 ke daftar skip ────────────────
      // Error 400 biasanya berarti model tidak support format
      // request (misalnya system role), jadi coba model berikutnya
      if (response.status === 400 || response.status === 429 || response.status === 404 || response.status === 503) {
        lastError = `${model} → HTTP ${response.status}: ${data.error?.message || ''}`;
        console.log(`[Alzy] Skipping model due to HTTP ${response.status}`);
        continue;
      }

      // Skip if error in body
      if (data.error) {
        const code = String(data.error.code || data.error.status || '');
        if (code === '400' || code === '429' || code === '404' || code === '503' || code.includes('rate')) {
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
