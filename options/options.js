'use strict';

const el = id => document.getElementById(id);

const dom = {
  radioGemini:   el('radioGemini'),
  radioOpenAI:   el('radioOpenAI'),
  radioGroq:     el('radioGroq'),
  modelField:    el('modelField'),
  modelLabel:    el('modelLabel'),
  modelSelect:   el('modelSelect'),
  apiKeyInput:   el('apiKeyInput'),
  revealBtn:     el('revealBtn'),
  keyHint:       el('keyHint'),
  helpGemini:    el('helpGemini'),
  helpOpenAI:    el('helpOpenAI'),
  helpGroq:      el('helpGroq'),
  saveBtn:       el('saveBtn'),
  statusMsg:     el('statusMsg'),
  clearCacheBtn: el('clearCacheBtn'),
  testKeyBtn:    el('testKeyBtn'),
  themeToggle:   el('themeToggle'),
};

const MODEL_OPTIONS = {
  gemini: [
    { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash — Fast & recommended' },
    { value: 'gemini-1.5-flash-8b', label: 'gemini-1.5-flash-8b — Lightweight' },
    { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro — Most capable' },
    { value: 'gemini-pro', label: 'gemini-pro — Stable (if flash unavailable)' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini — Recommended (fast + affordable)' },
    { value: 'gpt-4o', label: 'gpt-4o — Most capable' },
    { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo — Most affordable' },
  ],
  groq: [
    { value: 'llama-3.1-70b-versatile', label: 'llama-3.1-70b-versatile — Most capable Groq model' },
    { value: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant — Fast Groq model' },
    { value: 'mixtral-8x7b-32768', label: 'mixtral-8x7b-32768 — Long-context Groq model' },
  ],
};

(async () => {
  await restoreTheme();
  await loadSettings();
  bindEvents();
})();

async function loadSettings() {
  const result = await chrome.storage.local.get('settings');
  const s = result.settings || { provider: 'gemini', model: 'gpt-4o-mini', apiKey: '' };

  if (s.provider === 'openai') {
    dom.radioOpenAI.checked = true;
  } else if (s.provider === 'groq') {
    dom.radioGroq.checked = true;
  } else {
    dom.radioGemini.checked = true;
  }

  dom.modelSelect.value = s.model || defaultModelForProvider(s.provider || 'gemini');
  dom.apiKeyInput.value = s.apiKey || '';

  updateProviderUI(s.provider || 'gemini');
}

function bindEvents() {
  dom.radioGemini.addEventListener('change', () => updateProviderUI('gemini'));
  dom.radioOpenAI.addEventListener('change', () => updateProviderUI('openai'));
  dom.radioGroq.addEventListener('change', () => updateProviderUI('groq'));
  dom.saveBtn.addEventListener('click', saveSettings);
  dom.testKeyBtn.addEventListener('click', testApiKey);
  dom.clearCacheBtn.addEventListener('click', clearAllCache);
  dom.revealBtn.addEventListener('click', toggleReveal);
  dom.themeToggle.addEventListener('click', toggleTheme);

  dom.apiKeyInput.addEventListener('input', () => {
    dom.keyHint.textContent = '';
    dom.keyHint.className = 'field-hint';
  });
}

function updateProviderUI(provider) {
  const isOpenAI = provider === 'openai';
  const isGroq = provider === 'groq';
  const isGemini = provider === 'gemini';
  const isHostedModelProvider = isOpenAI || isGroq || isGemini;

  dom.modelField.classList.toggle('hidden', !isHostedModelProvider);
  dom.helpGemini.classList.toggle('hidden', isHostedModelProvider);
  dom.helpOpenAI.classList.toggle('hidden', !isOpenAI);
  dom.helpGroq.classList.toggle('hidden', !isGroq);
  dom.modelLabel.textContent = isGroq ? 'Groq Model' : isOpenAI ? 'OpenAI Model' : 'Model';

  renderModelOptions(provider);

  const placeholder = isOpenAI ? 'sk-…' : isGroq ? 'gsk_…' : 'AIza…';
  const providerName = isOpenAI ? 'OpenAI' : isGroq ? 'Groq' : 'Gemini';
  dom.apiKeyInput.placeholder = `Paste your ${providerName} API key here… (${placeholder})`;
}

async function saveSettings() {
  const provider = dom.radioOpenAI.checked ? 'openai' : dom.radioGroq.checked ? 'groq' : 'gemini';
  const apiKey   = dom.apiKeyInput.value.trim();
  const model    = dom.modelSelect.value;

  if (!apiKey) {
    showStatus('API key cannot be empty.', 'err');
    dom.keyHint.textContent = '⚠ Required';
    dom.keyHint.style.color = 'var(--error)';
    return;
  }

  if (provider === 'openai' && !apiKey.startsWith('sk-')) {
    showStatus('OpenAI keys start with sk-', 'err');
    return;
  }

  const settings = { provider, model, apiKey };
  await chrome.storage.local.set({ settings });
  showStatus('Settings saved ✓', 'ok');
}

async function clearAllCache() {
  const response = await chrome.runtime.sendMessage({ action: 'clearAllCache' });
  if (response?.success) {
    showStatus('Cache cleared ✓', 'ok');
  } else {
    showStatus('Failed to clear cache.', 'err');
  }
}

function toggleReveal() {
  const isHidden = dom.apiKeyInput.type === 'password';
  dom.apiKeyInput.type = isHidden ? 'text' : 'password';

  const eyeOpen = dom.revealBtn.querySelector('.eye-open');
  const eyeShut = dom.revealBtn.querySelector('.eye-shut');
  eyeOpen.style.display = isHidden ? 'none'  : 'block';
  eyeShut.style.display = isHidden ? 'block' : 'none';
}

function showStatus(msg, type) {
  dom.statusMsg.textContent = msg;
  dom.statusMsg.className   = `status-msg ${type}`;
  setTimeout(() => {
    dom.statusMsg.textContent = '';
    dom.statusMsg.className   = 'status-msg';
  }, 3000);
}

async function restoreTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  applyTheme(theme || 'dark');
}

async function toggleTheme() {
  const cur  = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const moon = dom.themeToggle.querySelector('.icon-moon');
  const sun  = dom.themeToggle.querySelector('.icon-sun');
  if (t === 'light') {
    moon.style.display = 'none';
    sun.style.display  = 'block';
  } else {
    moon.style.display = 'block';
    sun.style.display  = 'none';
  }
}

function defaultModelForProvider(provider) {
  if (provider === 'groq') return 'llama-3.1-70b-versatile';
  if (provider === 'openai') return 'gpt-4o-mini';
  if (provider === 'gemini') return 'gemini-1.5-flash';
  return 'gpt-4o-mini';
}

function openAIModelValue(value) {
  return ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'].includes(value) ? value : 'gpt-4o-mini';
}

function groqModelValue(value) {
  return ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'].includes(value)
    ? value
    : 'llama-3.1-70b-versatile';
}

function renderModelOptions(provider) {
  const options = MODEL_OPTIONS[provider] || MODEL_OPTIONS.openai;
  const currentValue = dom.modelSelect.value;
  const currentMatchesProvider = options.some(option => option.value === currentValue);
  const nextValue = currentMatchesProvider ? currentValue : defaultModelForProvider(provider);

  dom.modelSelect.innerHTML = '';
  options.forEach(option => {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    dom.modelSelect.appendChild(node);
  });

  dom.modelSelect.value = nextValue;
}

async function testApiKey() {
  const provider = dom.radioOpenAI.checked ? 'openai' : dom.radioGroq.checked ? 'groq' : 'gemini';
  const apiKey = dom.apiKeyInput.value.trim();
  const model = dom.modelSelect.value;

  if (!apiKey) {
    showStatus('API key cannot be empty.', 'err');
    return;
  }

  dom.testKeyBtn.disabled = true;
  const originalText = dom.testKeyBtn.textContent;
  dom.testKeyBtn.textContent = 'Testing…';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'testApiKey',
      provider,
      apiKey,
      model,
    });

    if (response?.success) {
      showStatus('✓ API key is valid!', 'ok');
    } else {
      const errMsg = response?.error || 'Unknown error';
      showStatus(`✗ ${errMsg}`, 'err');
    }
  } catch (err) {
    showStatus(`✗ ${err.message}`, 'err');
  } finally {
    dom.testKeyBtn.disabled = false;
    dom.testKeyBtn.textContent = originalText;
  }
}
