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
  themeToggle:   el('themeToggle'),
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
  const isHostedModelProvider = isOpenAI || isGroq;

  dom.modelField.classList.toggle('hidden', !isHostedModelProvider);
  dom.helpGemini.classList.toggle('hidden', isHostedModelProvider);
  dom.helpOpenAI.classList.toggle('hidden', !isOpenAI);
  dom.helpGroq.classList.toggle('hidden', !isGroq);
  dom.modelLabel.textContent = isGroq ? 'Groq Model' : isOpenAI ? 'OpenAI Model' : 'Model';

  if (isGroq) {
    dom.modelSelect.value = groqModelValue(dom.modelSelect.value);
  } else if (isOpenAI) {
    dom.modelSelect.value = openAIModelValue(dom.modelSelect.value);
  }

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

  if (provider === 'groq' && !apiKey.startsWith('gsk_')) {
    showStatus('Groq keys usually start with gsk_', 'err');
    return;
  }

  if (provider === 'gemini' && !apiKey.startsWith('AIza')) {
    showStatus('Gemini keys start with AIza…', 'err');
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
