// netlify/functions/chat.js
// Proxy ke OpenRouter — API key aman di Netlify Environment Variables

exports.handler = async (event) => {

  // Handle CORS preflight (OPTIONS)
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

  // Hanya terima POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Ambil API key dari Netlify Environment Variable
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

  // Parse body
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

  // Forward ke OpenRouter
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': event.headers?.referer || event.headers?.origin || 'https://alzy-ai.netlify.app',
        'X-Title': 'Alzy AI'
      },
      body: JSON.stringify({
        model: body.model || 'meta-llama/llama-3.3-70b-instruct:free',
        max_tokens: body.max_tokens || 1024,
        messages: body.messages
      })
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Gagal konek ke OpenRouter: ' + err.message })
    };
  }
};
