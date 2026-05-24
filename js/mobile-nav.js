(function () {
  const PAGES = [
    {
      href: 'index.html',
      label: 'Home',
      match: ['', '/', 'index.html'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 19v-8.5a1 1 0 0 0-.4-.8l-7-5.25a1 1 0 0 0-1.2 0l-7 5.25a1 1 0 0 0-.4.8V19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1"/></svg>'
    },
    {
      href: 'browse.html',
      label: 'Browse',
      match: ['browse.html'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>'
    },
    {
      href: '#search',
      label: 'Search',
      match: [],
      action: 'search',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    },
    {
      href: 'manga.html',
      label: 'Manga',
      match: ['manga.html', 'manga-info.html', 'read.html'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'
    },
    {
      href: 'music.html',
      label: 'Music',
      match: ['music.html'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
    },
    {
      href: 'schedule.html',
      label: 'Schedule',
      match: ['schedule.html'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>'
    },
    {
      href: 'profile.html',
      label: 'Profile',
      match: ['profile.html'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
    }
  ];

  function currentPage() {
    return (location.pathname || '').toLowerCase().split('/').pop() || '';
  }

  function build() {
    if (document.getElementById('float-nav')) return;
    if (!document.body) return;

    const cur = currentPage();
    if (cur === 'landing.html' || cur === '' || cur === '/') return;
    if (document.body && document.body.id === 'manga-reader') return;

    const nav = document.createElement('nav');
    nav.className = 'float-nav';
    nav.id = 'float-nav';
    nav.setAttribute('aria-label', 'Bottom navigation');

    const inner = document.createElement('div');
    inner.className = 'float-nav-inner';

    PAGES.forEach(p => {
      const active = p.match.indexOf(cur) !== -1;
      const a = document.createElement('a');
      a.href = p.href;
      a.className = 'float-nav-item' + (active ? ' active' : '');
      a.setAttribute('aria-label', p.label);
      if (p.action) a.dataset.action = p.action;
      a.setAttribute('data-testid', 'link-floatnav-' + p.label.toLowerCase());
      a.innerHTML = p.svg + '<span class="float-nav-label">' + p.label + '</span>';
      inner.appendChild(a);
    });

    nav.appendChild(inner);
    document.body.appendChild(nav);

    setupScroll(nav);
    setupFullscreenHide(nav);
    setupAuthGuard(nav);
    setupActions(nav);
  }

  function setupAuthGuard(nav) {
    nav.addEventListener('click', function (e) {
      const link = e.target.closest('a.float-nav-item');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (href !== 'profile.html') return;
      const token = localStorage.getItem('kv_token');
      if (!token) {
        e.preventDefault();
        if (typeof window.openAuthModal === 'function') {
          window.openAuthModal('login');
        }
      }
    });
  }

  function openSearch() {
    if (document.getElementById('kv-search-overlay')) {
      document.getElementById('kv-search-overlay').classList.add('visible');
      setTimeout(() => {
        const inp = document.getElementById('kv-search-overlay-input');
        if (inp) inp.focus();
      }, 80);
      return true;
    }

    const overlay = document.createElement('div');
    overlay.id = 'kv-search-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Search');

    const _mangaPages = ['manga.html', 'manga-info.html', 'read.html'];
    const _curPage = (location.pathname || '').split('/').pop() || '';
    const _isManga = _mangaPages.indexOf(_curPage) !== -1;
    const _placeholder = _isManga ? 'Search manga…' : 'Search anime…';
    const _searchPage = _isManga ? 'manga.html' : 'browse.html';

    overlay.innerHTML = `
      <div class="kv-search-overlay-backdrop"></div>
      <div class="kv-search-overlay-card">
        <div class="kv-search-overlay-header">
          <div class="kv-search-overlay-field">
            <svg class="kv-search-overlay-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input id="kv-search-overlay-input" class="kv-search-overlay-input" type="text" placeholder="${_placeholder}" autocomplete="off" autocorrect="off" spellcheck="false">
          </div>
          <button class="kv-search-overlay-close" aria-label="Close search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div id="kv-search-overlay-results" class="kv-search-overlay-results"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('visible'));

    const input = document.getElementById('kv-search-overlay-input');
    const results = document.getElementById('kv-search-overlay-results');
    const closeBtn = overlay.querySelector('.kv-search-overlay-close');
    const backdrop = overlay.querySelector('.kv-search-overlay-backdrop');

    function closeOverlay() {
      overlay.classList.remove('visible');
      setTimeout(() => {
        if (input) input.value = '';
        if (results) results.innerHTML = '';
      }, 260);
    }

    closeBtn.addEventListener('click', closeOverlay);
    backdrop.addEventListener('click', closeOverlay);

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { closeOverlay(); document.removeEventListener('keydown', escHandler); }
    });

    let timer = null;
    let reqCount = 0;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 2) { results.innerHTML = ''; return; }
      const reqId = ++reqCount;
      timer = setTimeout(async () => {
        try {
          const suggestFn = _isManga
            ? (window.vaultFetch ? (q) => window.vaultFetch('/atsu/search?keyword=' + encodeURIComponent(q) + '&limit=8').then(d => (d && d.results) || (Array.isArray(d) ? d : [])) : null)
            : (window.Kurovexa && window.Kurovexa.suggest ? window.Kurovexa.suggest.bind(window.Kurovexa) : null);
          const data = await (suggestFn ? suggestFn(q) : Promise.resolve([]));
          if (reqId !== reqCount) return;
          const items = Array.isArray(data) ? data : (data.suggestions || data.results || data.data || []);
          if (!items.length) { results.innerHTML = '<div class="kv-search-overlay-empty">No results found</div>'; return; }
          results.innerHTML = items.slice(0, 8).map(a => {
            const t = typeof a.title === 'string' ? a.title : (a.title?.english || a.title?.romaji || 'Unknown');
            const img = a.poster || a.coverImage?.large || '';
            const meta = [a.format, a.year || a.seasonYear].filter(Boolean).join(' · ');
            return `
              <a class="kv-search-overlay-item" href="info.html?id=${a.id}">
                ${img ? `<img src="${img}" alt="${t}" loading="lazy">` : '<div class="kv-search-overlay-item-nothumb"></div>'}
                <div class="kv-search-overlay-item-info">
                  <div class="kv-search-overlay-item-title">${t}</div>
                  ${meta ? `<div class="kv-search-overlay-item-meta">${meta}</div>` : ''}
                </div>
              </a>`;
          }).join('');
        } catch (_) {
          if (reqId === reqCount) results.innerHTML = '';
        }
      }, 260);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) {
        location.href = _searchPage + '?q=' + encodeURIComponent(input.value.trim());
      }
    });

    setTimeout(() => { if (input) input.focus(); }, 80);
    return true;
  }

  function setupActions(nav) {
    nav.addEventListener('click', function (e) {
      const link = e.target.closest('a.float-nav-item');
      if (!link) return;
      const action = link.getAttribute('data-action');
      if (!action) return;
      if (action === 'search') {
        e.preventDefault();
        e.stopPropagation();
        if (!openSearch()) {
          window.location.href = 'browse.html';
        }
      }
    });
  }

  function setupScroll(nav) {
    if (document.body && document.body.id === 'manga-reader') return;

    let lastY = window.scrollY || 0;
    let ticking = false;
    const THRESHOLD = 6;

    const update = () => {
      const y = window.scrollY || 0;
      const delta = y - lastY;
      if (y < 60) {
        nav.classList.remove('hidden');
        lastY = y;
      } else if (Math.abs(delta) > THRESHOLD) {
        nav.classList.toggle('hidden', delta > 0);
        lastY = y;
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
  }

  function setupFullscreenHide(nav) {
    const onChange = () => {
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      nav.classList.toggle('hidden-fs', !!fs);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
