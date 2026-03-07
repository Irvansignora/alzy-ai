// netlify/functions/chat.js
// Proxy ke OpenRouter dengan AUTO-FALLBACK model

const MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'google/gemma-3-12b-it:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'deepseek/deepseek-r1-distill-llama-70b:free',
  'deepseek/deepseek-chat-v3-0324:free',
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

  // ── Pisahkan system message dari conversation ─────────────
  // Kirim sebagai field `system` terpisah — format resmi OpenRouter
  // yang support semua model, bukan dimasukin ke messages array
  let systemPrompt = null;
  let chatMessages = body.messages;

  if (body.messages[0]?.role === 'system') {
    systemPrompt = body.messages[0].content;
    chatMessages = body.messages.slice(1);
  }

  // Pastikan ada minimal 1 pesan user
  if (chatMessages.length === 0) {
    chatMessages = [{ role: 'user', content: 'Hello' }];
  }

  const referer = event.headers?.referer || event.headers?.origin || 'https://alzy-ai.netlify.app';
  let lastError = null;

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    console.log(`[Alzy] Trying model ${i+1}/${MODELS.length}: ${model}`);

    try {
      // Build request body — kirim system sebagai field terpisah
      const reqBody = {
        model: model,
        max_tokens: 512,
        messages: chatMessages,
      };
      // Tambahkan system prompt sebagai top-level field jika ada
      if (systemPrompt) {
        reqBody.system = systemPrompt;
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': referer,
          'X-Title': 'Alzy AI'
        },
        body: JSON.stringify(reqBody)
      });

      const rawText = await response.text();
      console.log(`[Alzy] Model ${model} status: ${response.status}, preview: ${rawText.slice(0, 200)}`);

      let data;
      try { data = JSON.parse(rawText); }
      catch (e) {
        lastError = `${model} → invalid JSON`;
        continue;
      }

      // Skip error HTTP status
      if (response.status === 400 || response.status === 429 || response.status === 404 || response.status === 503) {
        lastError = `${model} → HTTP ${response.status}: ${data?.error?.message || ''}`;
        continue;
      }

      // Skip error dalam body
      if (data.error) {
        lastError = `${model} → ${data.error.message || JSON.stringify(data.error)}`;
        continue;
      }

      // Cek ada isi response
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        lastError = `${model} → empty content`;
        continue;
      }

      // SUCCESS
      console.log(`[Alzy] SUCCESS: ${model}`);
      data._model_used = model;
      data._model_index = i + 1;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data)
      };

    } catch (err) {
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
