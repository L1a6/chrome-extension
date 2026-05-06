(() => {
  'use strict';

  const NOISE_SELECTORS = [
    'nav', 'header', 'footer', 'aside',
    'script', 'style', 'noscript', 'iframe',
    '[role="navigation"]', '[role="banner"]',
    '[role="complementary"]', '[role="contentinfo"]',
    '[class*="sidebar"]', '[class*="side-bar"]',
    '[class*="nav"]', '[class*="footer"]',
    '[class*="header"]', '[class*="menu"]',
    '[class*="advertisement"]', '[class*=" ad-"]',
    '[class*="cookie"]', '[class*="popup"]',
    '[class*="modal"]', '[class*="overlay"]',
    '[class*="share"]', '[class*="social"]',
    '[class*="related"]', '[class*="recommend"]',
    '[class*="comment"]', '[class*="subscribe"]',
    '[id*="sidebar"]', '[id*="menu"]',
    '[id*="nav"]', '[id*="footer"]',
    '[id*="header"]', '[id*="banner"]',
    '[id*="comment"]', '[id*="ad-"]',
  ];

  const ARTICLE_SELECTORS = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.article-body',
    '.entry-content',
    '.content-body',
    '.story-body',
    '.post-body',
    '.blog-content',
    '.page-content',
    '#article-body',
    '#content-body',
    '#main-content',
    '#article',
  ];

  let activeHighlights = [];

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.action !== 'string') return false;

    switch (message.action) {
      case 'extractContent':
        sendResponse(extractPageContent());
        return false;

      case 'highlight':
        highlightPhrases(message.phrases || []);
        sendResponse({ success: true });
        return false;

      case 'clearHighlights':
        clearHighlights();
        sendResponse({ success: true });
        return false;

      default:
        return false;
    }
  });

  function extractPageContent() {
    const url = window.location.href;
    const title = document.title;

    const contentEl = findArticleElement();
    const text = contentEl
      ? extractCleanText(contentEl)
      : extractFallbackText();

    const words = text.trim().split(/\s+/).filter(Boolean);

    return {
      url,
      title,
      text,
      wordCount: words.length,
    };
  }

  function findArticleElement() {
    for (const selector of ARTICLE_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && getTextLength(el) > 300) return el;
    }
    return findLargestTextBlock();
  }

  function findLargestTextBlock() {
    const candidates = Array.from(
      document.querySelectorAll('div, section, main, article')
    );

    let best = null;
    let bestScore = 0;

    for (const el of candidates) {
      if (!isVisibleElement(el)) continue;

      const textLen = getTextLength(el);
      const height = el.offsetHeight;
      const depth = getElementDepth(el);

      const score = textLen * 1.0 + height * 0.1 - depth * 50;

      if (score > bestScore && textLen > 200 && height > 100) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  }

  function extractCleanText(el) {
    const clone = el.cloneNode(true);

    for (const sel of NOISE_SELECTORS) {
      clone.querySelectorAll(sel).forEach(node => node.remove());
    }

    const raw = (clone.innerText || clone.textContent || '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return raw;
  }

  function extractFallbackText() {
    return extractCleanText(document.body);
  }

  function getTextLength(el) {
    return (el.innerText || el.textContent || '').trim().length;
  }

  function isVisibleElement(el) {
    const style = window.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      el.offsetParent !== null
    );
  }

  function getElementDepth(el) {
    let depth = 0;
    let node = el;
    while (node.parentElement) {
      depth++;
      node = node.parentElement;
    }
    return depth;
  }

  function highlightPhrases(phrases) {
    clearHighlights();

    if (!phrases.length) return;

    const validPhrases = phrases
      .map(p => p.trim())
      .filter(p => p.length > 2 && p.length < 80);

    if (!validPhrases.length) return;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          const skipTags = ['script', 'style', 'noscript', 'head', 'meta', 'mark'];
          if (skipTags.includes(tag)) return NodeFilter.FILTER_REJECT;
          if (parent.dataset && parent.dataset.pagelensHighlight) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    for (const phrase of validPhrases) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escaped})`, 'gi');

      for (const textNode of textNodes) {
        const text = textNode.textContent;
        if (!regex.test(text)) {
          regex.lastIndex = 0;
          continue;
        }
        regex.lastIndex = 0;

        const parent = textNode.parentNode;
        if (!parent) continue;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          }

          const mark = document.createElement('mark');
          mark.dataset.pagelensHighlight = 'true';
          mark.style.cssText = [
            'background: rgba(0, 212, 170, 0.28)',
            'color: inherit',
            'border-radius: 2px',
            'padding: 0 2px',
            'box-shadow: 0 0 0 1.5px rgba(0, 212, 170, 0.45)',
            'transition: background 0.2s ease',
          ].join(';');
          mark.textContent = match[0];
          fragment.appendChild(mark);
          activeHighlights.push(mark);

          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        try {
          parent.replaceChild(fragment, textNode);
        } catch {
          // Node may have been removed from DOM between walker pass and replacement
        }
      }
    }
  }

  function clearHighlights() {
    const marks = document.querySelectorAll('[data-pagelens-highlight]');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      try {
        const text = document.createTextNode(mark.textContent);
        parent.replaceChild(text, mark);
        parent.normalize();
      } catch {
        // Ignore stale DOM references
      }
    });
    activeHighlights = [];
  }
})();
