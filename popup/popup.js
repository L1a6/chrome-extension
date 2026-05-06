'use strict';

const el = id => document.getElementById(id);

const dom = {
  pageTitle:       el('pageTitle'),
  faviconWrap:     el('faviconWrap'),
  stateIdle:       el('stateIdle'),
  stateLoading:    el('stateLoading'),
  stateError:      el('stateError'),
  stateResult:     el('stateResult'),
  loadingMsg:      el('loadingMsg'),
  errorMsg:        el('errorMsg'),
  summarizeBtn:    el('summarizeBtn'),
  secondaryActions:el('secondaryActions'),
  copyBtn:         el('copyBtn'),
  clearBtn:        el('clearBtn'),
  themeToggle:     el('themeToggle'),
  settingsBtn:     el('settingsBtn'),
  errorSettingsBtn:el('errorSettingsBtn'),
  highlightToggle: el('highlightToggle'),
  cachedChip:      el('cachedChip'),
  readingTime:     el('readingTime'),
  wordCount:       el('wordCount'),
  summaryList:     el('summaryList'),
  insightsList:    el('insightsList'),
};

let currentTab = null;
let activeSummary = null;
let highlightsOn = false;

// ─── Bootstrap ───────────────────────────────────────────
(async () => {
  await restoreTheme();
  await initTab();
})();

async function initTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  dom.pageTitle.textContent = tab.title || tab.url || 'Unknown page';

  try {
    const origin = new URL(tab.url).hostname;
    const img = document.createElement('img');
    img.width = 14;
    img.height = 14;
    img.alt = '';
    img.src = `https://www.google.com/s2/favicons?domain=${origin}&sz=32`;
    img.onerror = () => {
      dom.faviconWrap.innerHTML = faviconFallback();
    };
    dom.faviconWrap.appendChild(img);
  } catch {
    dom.faviconWrap.innerHTML = faviconFallback();
  }

  await checkCache();
}

async function checkCache() {
  if (!currentTab?.url) return;
  const key = `cache_${hashUrl(currentTab.url)}`;
  const stored = await chrome.storage.local.get(key);
  const cached = stored[key];

  if (cached && Date.now() - cached.generatedAt < 30 * 60 * 1000) {
    renderResult(cached, true);
  }
}

// ─── Theme ───────────────────────────────────────────────
async function restoreTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  setTheme(theme || 'dark');
}

function setTheme(t) {
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

dom.themeToggle.addEventListener('click', async () => {
  const cur  = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  setTheme(next);
  await chrome.storage.local.set({ theme: next });
});

// ─── Settings ────────────────────────────────────────────
dom.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
dom.errorSettingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ─── Summarize ───────────────────────────────────────────
dom.summarizeBtn.addEventListener('click', runSummarize);

async function runSummarize() {
  if (!currentTab) return;

  showState('loading');
  setLoadingMsg('Extracting content…');
  dom.summarizeBtn.disabled = true;

  try {
    const extracted = await extractContent();

    if (!extracted || !extracted.text || extracted.text.trim().length < 80) {
      showError('Not enough readable content found on this page. Try navigating to an article.');
      return;
    }

    setLoadingMsg('Generating summary…');

    const response = await chrome.runtime.sendMessage({
      action: 'summarize',
      content: extracted.text,
      url:     currentTab.url,
      title:   extracted.title || currentTab.title || '',
    });

    if (!response || !response.success) {
      handleApiError(response?.error || 'UNKNOWN_ERROR');
      return;
    }

    activeSummary = response.data;
    renderResult(response.data, response.cached ?? false);

  } catch (err) {
    showError(err.message || 'An unexpected error occurred. Please try again.');
  } finally {
    dom.summarizeBtn.disabled = false;
  }
}

function extractContent() {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(currentTab.id, { action: 'extractContent' }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error('Cannot access this page. Reload the page and try again.'));
      } else {
        resolve(response);
      }
    });
  });
}

function handleApiError(code) {
  const errorMap = {
    NO_API_KEY:           'API key not configured.',
    INSUFFICIENT_CONTENT: 'Not enough content found on this page.',
    INVALID_MESSAGE:      'Internal messaging error. Please reload.',
    UNKNOWN_ERROR:        'Something went wrong. Please try again.',
  };

  const msg = errorMap[code] || (typeof code === 'string' ? code : 'Something went wrong.');
  showError(msg);

  if (code === 'NO_API_KEY') {
    dom.errorSettingsBtn.style.display = 'block';
  }
}

// ─── Render result ────────────────────────────────────────
function renderResult(data, cached) {
  dom.readingTime.textContent = `${data.readingTime} min read`;
  dom.wordCount.textContent   = `${(data.wordCount || 0).toLocaleString()} words`;

  dom.cachedChip.classList.toggle('hidden', !cached);

  renderSummary(data.summary || []);
  renderInsights(data.keyInsights || []);

  showState('result');
  dom.secondaryActions.classList.remove('hidden');
  activeSummary = data;
}

function renderSummary(points) {
  dom.summaryList.innerHTML = '';
  points.forEach(point => {
    const li = document.createElement('li');
    li.textContent = sanitize(point);
    dom.summaryList.appendChild(li);
  });
}

function renderInsights(insights) {
  dom.insightsList.innerHTML = '';
  insights.forEach(insight => {
    const div = document.createElement('div');
    div.className = 'insight-card';
    div.textContent = sanitize(insight);
    dom.insightsList.appendChild(div);
  });
}

// ─── Clear ───────────────────────────────────────────────
dom.clearBtn.addEventListener('click', async () => {
  activeSummary = null;
  highlightsOn = false;
  dom.highlightToggle.setAttribute('aria-checked', 'false');
  dom.secondaryActions.classList.add('hidden');

  if (currentTab?.url) {
    chrome.runtime.sendMessage({ action: 'clearCache', url: currentTab.url });
  }
  if (currentTab?.id) {
    chrome.tabs.sendMessage(currentTab.id, { action: 'clearHighlights' });
  }

  showState('idle');
});

// ─── Copy ────────────────────────────────────────────────
dom.copyBtn.addEventListener('click', async () => {
  if (!activeSummary) return;

  const text = buildCopyText(activeSummary);

  try {
    await navigator.clipboard.writeText(text);
    flashCopySuccess();
  } catch {
    showError('Could not copy to clipboard.');
  }
});

function buildCopyText(data) {
  const lines = [
    `📄 Page Summary`,
    `⏱ ${data.readingTime} min read · ${(data.wordCount || 0).toLocaleString()} words`,
    '',
    `📌 Summary:`,
    ...(data.summary || []).map(p => `• ${p}`),
    '',
    `💡 Key Insights:`,
    ...(data.keyInsights || []).map(i => `→ ${i}`),
  ];
  return lines.join('\n');
}

function flashCopySuccess() {
  const copyIcon = dom.copyBtn.querySelector('.copy-icon');
  const checkIcon = dom.copyBtn.querySelector('.check-icon');
  dom.copyBtn.classList.add('success');
  copyIcon.classList.add('hidden');
  checkIcon.classList.remove('hidden');

  setTimeout(() => {
    dom.copyBtn.classList.remove('success');
    copyIcon.classList.remove('hidden');
    checkIcon.classList.add('hidden');
  }, 1800);
}

// ─── Highlight toggle ────────────────────────────────────
dom.highlightToggle.addEventListener('click', () => {
  if (!activeSummary || !currentTab?.id) return;

  highlightsOn = !highlightsOn;
  dom.highlightToggle.setAttribute('aria-checked', String(highlightsOn));

  const action = highlightsOn ? 'highlight' : 'clearHighlights';
  const msg = highlightsOn
    ? { action, phrases: activeSummary.highlights || [] }
    : { action };

  chrome.tabs.sendMessage(currentTab.id, msg);
});

// ─── State machine ────────────────────────────────────────
function showState(state) {
  dom.stateIdle.classList.add('hidden');
  dom.stateLoading.classList.add('hidden');
  dom.stateError.classList.add('hidden');
  dom.stateResult.classList.add('hidden');
  dom.errorSettingsBtn.style.display = 'none';

  switch (state) {
    case 'idle':    dom.stateIdle.classList.remove('hidden');    break;
    case 'loading': dom.stateLoading.classList.remove('hidden'); break;
    case 'error':   dom.stateError.classList.remove('hidden');   break;
    case 'result':  dom.stateResult.classList.remove('hidden');  break;
  }
}

function showError(msg) {
  dom.errorMsg.textContent = msg;
  showState('error');
}

function setLoadingMsg(msg) {
  dom.loadingMsg.textContent = msg;
}

// ─── Utils ───────────────────────────────────────────────
function sanitize(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function faviconFallback() {
  return `<svg viewBox="0 0 14 14" fill="none" width="14" height="14">
    <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.3" opacity="0.35"/>
    <path d="M5 7h4M5 4.5h4M5 9.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.35"/>
  </svg>`;
}

function hashUrl(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h << 5) - h + url.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
