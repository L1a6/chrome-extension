const CACHE_TTL_MS = 30 * 60 * 1000;
const RATE_LIMIT_MS = 2500;

let lastRequestTime = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isValidMessage(message)) {
    sendResponse({ success: false, error: 'INVALID_MESSAGE' });
    return false;
  }

  if (message.action === 'summarize') {
    handleSummarize(message, sendResponse);
    return true;
  }

  if (message.action === 'testApiKey') {
    testApiKey(message, sendResponse);
    return true;
  }

  if (message.action === 'clearCache') {
    clearUrlCache(message.url)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === 'clearAllCache') {
    clearAllCache()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  return false;
});

function isValidMessage(message) {
  if (!message || typeof message !== 'object') return false;
  const validActions = ['summarize', 'testApiKey', 'clearCache', 'clearAllCache'];
  return validActions.includes(message.action);
}

async function handleSummarize({ content, url, title }, sendResponse) {
  try {
    if (!content || typeof content !== 'string' || content.length < 50) {
      sendResponse({ success: false, error: 'INSUFFICIENT_CONTENT' });
      return;
    }

    const cached = await getCachedSummary(url);
    if (cached) {
      sendResponse({ success: true, data: cached, cached: true });
      return;
    }

    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < RATE_LIMIT_MS) {
      await sleep(RATE_LIMIT_MS - timeSinceLast);
    }
    lastRequestTime = Date.now();

    const settings = await getSettings();
    if (!settings.apiKey || settings.apiKey.trim() === '') {
      sendResponse({ success: false, error: 'NO_API_KEY' });
      return;
    }

    const summary = await callAI(content, title, settings);
    await cacheSummary(url, summary);

    sendResponse({ success: true, data: summary, cached: false });
  } catch (err) {
    const msg = err.message || 'UNKNOWN_ERROR';
    sendResponse({ success: false, error: msg });
  }
}

async function callAI(content, title, settings) {
  const prompt = buildPrompt(content, title);
  const apiKey = normalizeApiKey(settings.apiKey);

  if (settings.provider === 'openai') {
    return await callOpenAICompatible(
      prompt,
      apiKey,
      settings.model || 'gpt-4o-mini',
      'https://api.openai.com/v1',
      'OpenAI',
      true
    );
  }

  if (settings.provider === 'groq') {
    return await callOpenAICompatible(
      prompt,
      apiKey,
      settings.model || 'llama-3.1-70b-versatile',
      'https://api.groq.com/openai/v1',
      'Groq',
      false
    );
  }

  return await callGemini(prompt, apiKey, settings.model || 'gemini-2.5-flash');
}

function buildPrompt(content, title) {
  const truncated = content.slice(0, 8000);
  return `You are an expert content analyst. Analyze the webpage content below and return a JSON object — no markdown, no code fences, just raw valid JSON.

Page Title: ${title}

Content:
${truncated}

Return exactly this JSON structure:
{
  "summary": ["concise point 1", "concise point 2", "concise point 3", "concise point 4", "concise point 5"],
  "keyInsights": ["analytical insight 1", "analytical insight 2", "analytical insight 3"],
  "readingTime": 5,
  "wordCount": 1200,
  "highlights": ["exact short phrase 1", "exact short phrase 2", "exact short phrase 3"],
  "title": "Clean readable title"
}

Requirements:
- summary: 5 to 7 concise bullet points covering the main content. Each should be a complete thought under 25 words.
- keyInsights: 3 to 4 deeper analytical observations that go beyond surface-level summary.
- readingTime: estimated minutes to read the original article (integer).
- wordCount: approximate word count of the original content (integer).
- highlights: 3 to 5 short phrases (under 6 words each) that appear verbatim or near-verbatim in the content, suitable for in-page highlighting.
- title: clean, concise title for the content.
Respond with ONLY the JSON object.`;
}

async function callGemini(prompt, apiKey, model) {
  const candidates = [
    model,
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ].filter(Boolean);

  const versions = ['v1', 'v1beta'];
  let lastError = 'Gemini API error';

  for (const candidate of [...new Set(candidates)]) {
    for (const version of versions) {
      const endpoint = `https://generativelanguage.googleapis.com/${version}/models/${candidate}:generateContent?key=${apiKey}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            candidateCount: 1,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty response from Gemini');
        return parseAIResponse(text);
      }

      const errBody = await res.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || `Gemini API error (${res.status})`;
      lastError = errMsg;

      if (res.status === 401 || res.status === 403) {
        throw new Error(`GEMINI_AUTH: Gemini rejected the API key. Open Settings, replace the key, and save again.`);
      }

      if (res.status === 404 || /not found|not supported|model/i.test(errMsg)) {
        continue;
      }
    }
  }

  throw new Error(lastError);
}

async function callOpenAICompatible(prompt, apiKey, model, baseUrl, providerName, useResponseFormat) {
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a precise content analyst. Always respond with raw JSON only — no markdown, no code fences.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 1024,
  };

  if (useResponseFormat) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errMsg = errBody?.error?.message?.trim() || '';
    const isAuthError = res.status === 401 || res.status === 403;

    if (isAuthError) {
      throw new Error(
        `${providerName.toUpperCase()}_AUTH: ${providerName} rejected the API key. Open Settings, replace the key, and save again.`
      );
    }

    if (res.status === 404 && providerName === 'Groq') {
      throw new Error(
        'GROQ_MODEL: The selected Groq model was not found. Pick a supported Groq model in Settings.'
      );
    }

    if (res.status === 400 && providerName === 'Groq' && /model/i.test(errMsg)) {
      throw new Error(
        'GROQ_MODEL: The selected Groq model is not supported for this request. Pick a different Groq model in Settings.'
      );
    }

    throw new Error(errMsg || `${providerName} API error (${res.status})`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Empty response from ${providerName}`);

  return parseAIResponse(text);
}

function parseAIResponse(rawText) {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI returned malformed JSON — please try again.');
  }

  if (!Array.isArray(parsed.summary)) {
    throw new Error('Unexpected AI response structure.');
  }

  return {
    summary: parsed.summary.slice(0, 7).map(String),
    keyInsights: (parsed.keyInsights || []).slice(0, 4).map(String),
    readingTime: Math.max(1, parseInt(parsed.readingTime, 10) || 1),
    wordCount: Math.max(0, parseInt(parsed.wordCount, 10) || 0),
    highlights: (parsed.highlights || []).slice(0, 5).map(String),
    title: String(parsed.title || ''),
    generatedAt: Date.now(),
  };
}

async function getCachedSummary(url) {
  const key = `cache_${hashUrl(url)}`;
  const result = await chrome.storage.local.get(key);
  const entry = result[key];

  if (!entry) return null;

  if (Date.now() - entry.generatedAt > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }

  return entry;
}

async function cacheSummary(url, summary) {
  const key = `cache_${hashUrl(url)}`;
  await chrome.storage.local.set({ [key]: summary });
}

async function clearUrlCache(url) {
  const key = `cache_${hashUrl(url)}`;
  await chrome.storage.local.remove(key);
}

async function clearAllCache() {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter(k => k.startsWith('cache_'));
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }
}

async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: '' };
  return {
    ...settings,
    model: normalizeModelForProvider(settings.provider, settings.model),
  };
}

function normalizeModelForProvider(provider, value) {
  if (provider === 'groq') {
    return ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'].includes(value)
      ? value
      : 'llama-3.1-70b-versatile';
  }

  if (provider === 'openai') {
    return ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'].includes(value)
      ? value
      : 'gpt-4o-mini';
  }

  if (provider === 'gemini') {
    if (value && value.startsWith('gemini-1.5')) {
      return 'gemini-2.5-flash';
    }

    return ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-pro'].includes(value)
      ? value
      : 'gemini-2.5-flash';
  }

  return value || 'gemini-2.5-flash';
}

function hashUrl(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeApiKey(apiKey) {
  return String(apiKey || '').trim().replace(/^['"]|['"]$/g, '');
}

async function testApiKey({ provider, apiKey, model }, sendResponse) {
  try {
    const normalizedKey = normalizeApiKey(apiKey);

    if (provider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${normalizedKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'respond with ok' }],
          max_tokens: 10,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errMsg = errBody?.error?.message || `Groq error (${res.status})`;
        if (res.status === 401 || res.status === 403) {
          sendResponse({ success: false, error: 'API key rejected by Groq. Check if the key is valid and active.' });
        } else if (res.status === 404 || /model/i.test(errMsg)) {
          sendResponse({ success: false, error: `Model not found: ${model}` });
        } else {
          sendResponse({ success: false, error: errMsg });
        }
        return;
      }

      sendResponse({ success: true, error: null });
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${normalizedKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'respond with ok' }],
          max_tokens: 10,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errMsg = errBody?.error?.message || `OpenAI error (${res.status})`;
        if (res.status === 401 || res.status === 403) {
          sendResponse({ success: false, error: 'API key rejected by OpenAI. Check if the key is valid and active.' });
        } else {
          sendResponse({ success: false, error: errMsg });
        }
        return;
      }

      sendResponse({ success: true, error: null });
    } else if (provider === 'gemini') {
      const endpoint = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${normalizedKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'respond with ok' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errMsg = errBody?.error?.message || `Gemini error (${res.status})`;
        if (res.status === 400 || /api_key/i.test(errMsg)) {
          sendResponse({ success: false, error: 'API key rejected by Gemini. Check if the key is valid and active.' });
        } else {
          sendResponse({ success: false, error: errMsg });
        }
        return;
      }

      sendResponse({ success: true, error: null });
    } else {
      sendResponse({ success: false, error: 'Unknown provider' });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}
