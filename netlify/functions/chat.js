// netlify/functions/chat.js
// Proxy ke OpenRouter — API key aman di environment variable Netlify
// Tidak pernah terekspos ke client/browser

exports.handler = async (event) => {
  // Hanya terima POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Ambil API key dari environment variable Netlify
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'API key not configured on server.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  // Validasi field yang dibutuhkan
  if (!body.messages || !Array.isArray(body.messages)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'messages array is required' })
    };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': event.headers['referer'] || 'https://alzy-ai.netlify.app',
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to reach OpenRouter: ' + err.message })
    };
  }
};
