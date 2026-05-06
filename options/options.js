'use strict';

const el = id => document.getElementById(id);

const dom = {
  radioGemini:   el('radioGemini'),
  radioOpenAI:   el('radioOpenAI'),
  modelField:    el('modelField'),
  modelSelect:   el('modelSelect'),
  apiKeyInput:   el('apiKeyInput'),
  revealBtn:     el('revealBtn'),
  keyHint:       el('keyHint'),
  helpGemini:    el('helpGemini'),
  helpOpenAI:    el('helpOpenAI'),
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
  } else {
    dom.radioGemini.checked = true;
  }

  dom.modelSelect.value = s.model || 'gpt-4o-mini';
  dom.apiKeyInput.value = s.apiKey || '';

  updateProviderUI(s.provider || 'gemini');
}

function bindEvents() {
  dom.radioGemini.addEventListener('change', () => updateProviderUI('gemini'));
  dom.radioOpenAI.addEventListener('change', () => updateProviderUI('openai'));
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
  dom.modelField.classList.toggle('hidden', !isOpenAI);
  dom.helpGemini.classList.toggle('hidden', isOpenAI);
  dom.helpOpenAI.classList.toggle('hidden', !isOpenAI);

  const placeholder = isOpenAI ? 'sk-…' : 'AIza…';
  dom.apiKeyInput.placeholder = `Paste your ${isOpenAI ? 'OpenAI' : 'Gemini'} API key here… (${placeholder})`;
}

async function saveSettings() {
  const provider = dom.radioOpenAI.checked ? 'openai' : 'gemini';
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
