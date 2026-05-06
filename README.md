# PageLens – AI Page Summarizer

> A Manifest V3 Chrome Extension that extracts, analyzes, and summarizes any webpage using Google Gemini or OpenAI — with in-page highlighting, caching, and dark/light mode.

---

## Demo

Install the extension → open any article → click the PageLens icon → click **Summarize Page**.

---

## Features

- **Bullet-point summary** (5–7 points) from any article or webpage
- **Key Insights** — deeper analytical observations beyond the summary
- **Reading time & word count** estimates
- **In-page highlighting** — toggle to highlight key phrases directly on the page
- **30-minute per-URL cache** — avoids duplicate API calls
- **Dark & light mode** — synced across popup and settings
- **Copy to clipboard** — one-click copy of the full summary
- **Zero exposed secrets** — API key is stored only in `chrome.storage.local` and called only from the background service worker

---

## Supported Providers

| Provider | Model | Notes |
|---|---|---|
| Google Gemini | gemini-1.5-flash | **Recommended** — free tier available |
| OpenAI | gpt-4o-mini | Fast, affordable |
| OpenAI | gpt-4o | Most capable |
| OpenAI | gpt-3.5-turbo | Most affordable |

---

## Installation (Local / Unpacked)

> This extension is not published to the Chrome Web Store. Follow these steps to install it locally.

### Step 1 — Get the files

Download or clone this repository to your computer:

```bash
git clone https://github.com/YOUR_USERNAME/pagelens-extension.git
```

Or download the ZIP from GitHub and extract it.

### Step 2 — Open Chrome Extensions

Open Google Chrome and navigate to:

```
chrome://extensions
```

### Step 3 — Enable Developer Mode

In the top-right corner of the Extensions page, toggle **Developer mode** ON.

### Step 4 — Load the extension

Click **Load unpacked** and select the root folder of this project (the folder that contains `manifest.json`).

The PageLens icon will appear in your Chrome toolbar.

### Step 5 — Configure your API key

Click the PageLens icon → click the **⚙ settings** icon (top-right of popup) → enter your API key → click **Save Settings**.

**To get a free Gemini API key:**
1. Visit [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Sign in with a Google account
3. Click **Create API key**
4. Copy the key → paste it in PageLens Settings

**To get an OpenAI API key:**
1. Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click **Create new secret key**
3. Copy the key → paste it in PageLens Settings

---

## Usage

1. Navigate to any article, blog post, or webpage
2. Click the PageLens icon in your Chrome toolbar
3. Click **Summarize Page**
4. Read the summary, key insights, and estimated reading time
5. Optionally toggle **Highlight on page** to mark key phrases in the article
6. Use the **copy** button to copy the summary to clipboard
7. Click **Clear** to reset and remove cached summary for the current page

---

## Architecture

```
pagelens-extension/
├── manifest.json              # MV3 config — permissions, entry points
├── background/
│   └── service-worker.js      # AI API calls, caching, rate limiting, message routing
├── content/
│   └── content-script.js      # Content extraction + in-page highlighting
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.js               # Popup state machine and Chrome messaging
│   └── popup.css              # Styled dark/light theme UI
├── options/
│   ├── options.html           # Settings page
│   ├── options.js             # Settings persistence + validation
│   └── options.css            # Settings page styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Message flow

```
Popup (popup.js)
  │
  ├─[extractContent]──► Content Script (content-script.js)
  │                         Heuristic DOM extraction
  │                         Returns { text, title, url, wordCount }
  │
  └─[summarize]──────► Background Service Worker (service-worker.js)
                          Check chrome.storage cache
                          Call Gemini or OpenAI API
                          Parse + validate JSON response
                          Cache result
                          Return summary data
                              │
                              └─ Popup renders result
                              └─[highlight]──► Content Script
                                               TreeWalker phrase matching
                                               Injects <mark> elements
```

### Three isolated contexts

| Context | File | Responsibility |
|---|---|---|
| Popup | `popup/popup.js` | UI state, user interactions, orchestration |
| Background | `background/service-worker.js` | AI calls, caching, secrets |
| Content Script | `content/content-script.js` | DOM access, extraction, highlighting |

All inter-context communication is done via `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage` with validated message schemas.

---

## AI Integration

PageLens sends a structured prompt to the chosen AI provider and expects a raw JSON response:

```json
{
  "summary": ["point 1", "point 2", "..."],
  "keyInsights": ["insight 1", "insight 2", "..."],
  "readingTime": 5,
  "wordCount": 1200,
  "highlights": ["phrase 1", "phrase 2", "..."],
  "title": "Clean page title"
}
```

- Content is truncated to **8,000 characters** before sending to avoid token overruns
- Temperature is set to **0.2** for consistent, factual output
- The background worker parses and validates the JSON before returning it to the popup
- If parsing fails, a clear user-facing error is displayed

---

## Security Decisions

| Decision | Rationale |
|---|---|
| API key stored in `chrome.storage.local` only | Never in source code, never in content scripts, never in popup |
| All API calls made from `background/service-worker.js` | Content scripts and popups cannot be intercepted the same way; background workers are isolated |
| `host_permissions` limited to Gemini + OpenAI | Minimal surface area — only the required API endpoints are whitelisted |
| Message validation on every `chrome.runtime.onMessage` | Prevents arbitrary code from injecting malicious messages |
| XSS prevention: all text inserted via `.textContent` | Never `innerHTML` with untrusted data in the popup |
| Highlighting uses DOM `createTextNode` and `<mark>` only | No eval, no innerHTML of untrusted content |
| `.gitignore` excludes any config with secrets | No accidental key exposure in version control |
| Content Security Policy set in `manifest.json` | Blocks inline scripts and external script injection |

---

## Trade-offs

| Trade-off | Decision |
|---|---|
| **No bundler / build step** | Vanilla JS keeps the extension directly loadable — no Webpack/Vite needed. Makes grading and reviewing easier. TypeScript would add type safety but requires a compile step. |
| **Gemini 1.5 Flash as default** | Much cheaper and has a free tier vs GPT-4o. Flash is fast enough for summarization. |
| **8,000 char content limit** | Balances quality vs token cost. Long pages get truncated at a natural boundary. |
| **30-minute cache TTL** | Short enough to stay fresh, long enough to avoid re-charging for repeated opens on the same article. |
| **No proxy server** | A proxy would add infrastructure complexity. Instead, API calls are made from the background service worker which runs in a trusted, isolated context. |
| **Heuristic content extraction** | Instead of bundling a full Readability.js library (adds ~50KB), a layered heuristic approach (ARIA roles → semantic selectors → largest text block scoring) achieves good results on most article pages with zero dependencies. |

---

## Permissions Explained

```json
"permissions": ["activeTab", "storage", "tabs"]
```

| Permission | Why |
|---|---|
| `activeTab` | Read the current tab's URL and title |
| `storage` | Persist settings and cached summaries locally |
| `tabs` | Query the active tab to get URL/title |

`host_permissions` are limited strictly to the two AI API endpoints used.

---

## Development Notes

- No build step required — load the folder directly as an unpacked extension
- To make changes: edit files → go to `chrome://extensions` → click the refresh icon on PageLens
- Errors appear in:
  - Popup devtools: right-click popup → Inspect
  - Background worker: `chrome://extensions` → PageLens → "Service Worker" link
  - Content script: regular F12 devtools on any page

---

## License

MIT — free to use, modify, and distribute.
