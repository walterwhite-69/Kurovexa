const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];

const noAdult = (arr) => (arr || []).filter(a => !a.isAdult);
const notUpcoming = (arr) => (arr || []).filter(a => {
  if (a.status === 'NOT_YET_RELEASED') return false;
  if (a.nextAiringEpisode && a.nextAiringEpisode.episode === 1) return false;
  if (a.next_episode === 1) return false;
  return true;
});

function titleOf(a) {
  return a.title?.english || a.title?.romaji || a.title?.native || 'Unknown';
}
function scoreLabel(s) { return s ? (s / 10).toFixed(1) : null; }
function formatStatus(s) {
  return { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled' }[s] || s || '';
}
function stripHtml(html) {
  return html ? html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim() : '';
}
function makeSkeletons(count, parentId) {
  const p = document.getElementById(parentId);
  if (!p) return;
  p.innerHTML = Array(count).fill('').map(() => `
    <div class="skel-card">
      <div class="skeleton skel-poster"></div>
      <div class="skeleton skel-line" style="margin-top:10px;"></div>
      <div class="skeleton skel-line skel-line-sm"></div>
    </div>`).join('');
}

function buildCard(anime, rank) {
  const title = titleOf(anime);
  const img = anime.coverImage?.large || anime.coverImage?.extraLarge || '';
  const score = scoreLabel(anime.averageScore);
  const eps = anime.episodes ? `EP ${anime.episodes}` : (anime.status === 'RELEASING' ? 'Ongoing' : '');
  const airing = anime.status === 'RELEASING';
  const url = `info.html?id=${anime.id}`;
  return `
    <div class="anime-card" onclick="location.href='${url}'">
      <div class="card-poster">
        <img src="${img}" alt="${title}" loading="lazy">
        <div class="card-overlay"></div>
        ${rank ? `<div class="card-rank">${rank}</div>` : ''}
        ${eps ? `<div class="card-badge-ep">${eps}</div>` : ''}
        ${airing && !rank ? `<div class="card-airing-dot"></div>` : ''}
        <div class="card-quick"><div class="card-quick-btn" style="${(anime.status === 'NOT_YET_RELEASED' || (anime.nextAiringEpisode && anime.nextAiringEpisode.episode === 1) || anime.next_episode === 1) ? 'background:rgba(255,255,255,0.1);color:#fff' : ''}">${(anime.status === 'NOT_YET_RELEASED' || (anime.nextAiringEpisode && anime.nextAiringEpisode.episode === 1) || anime.next_episode === 1) ? 'View Details' : '▶ Watch Now'}</div></div>
      </div>
      <div class="card-body">
        <div class="card-title">${title}</div>
        <div class="card-meta">
          ${score ? `<span class="card-score">★ ${score}</span>` : ''}
          ${anime.format ? `<span class="card-meta-item">${anime.format}</span>` : ''}
          ${anime.seasonYear ? `<span class="card-meta-item">${anime.seasonYear}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function fillRow(items, parentId, ranked = false) {
  const p = document.getElementById(parentId);
  if (!p) return;
  if (!items?.length) { p.innerHTML = '<p style="color:var(--text-muted);padding:16px 0">Nothing to show.</p>'; return; }
  p.innerHTML = items.map((a, i) => buildCard(a, ranked ? i + 1 : null)).join('');
}

let spotlightData = [], spotlightIdx = 0, spotlightTimer = null;

function buildHeroSlide(anime, idx) {
  const title = titleOf(anime);
  const anilistId = anime.anilistId || anime.anilist_id || anime.alID || anime.id;
  const fallbackBanner = anime.bannerImage || '';
  const banner = anilistId ? `https://anikuro.to/static/top_banners/${anilistId}.jpg` : fallbackBanner;
  const cover = fallbackBanner;
  const desc = stripHtml(anime.description || '').slice(0, 200);
  const score = scoreLabel(anime.averageScore);
  const genres = (anime.genres || []).slice(0, 4);
  const eps = anime.episodes;
  const fmt = anime.format || '';
  const year = anime.seasonYear || '';
  const studio = anime.studios?.nodes?.[0]?.name || '';
  const dur = anime.duration;
  const nextEp = anime.nextAiringEpisode;
  const airingBadge = nextEp
    ? `<span class="badge badge-pink" style="font-size:0.7rem">EP ${nextEp.episode} · ${Math.floor((nextEp.airingAt - Date.now() / 1000) / 86400)}d left</span>`
    : '';

  const chips = [
    fmt ? `<span class="hero-stat-chip">${fmt}</span>` : '',
    eps ? `<span class="hero-stat-chip"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17,2 12,7 7,2"/></svg>${eps}</span>` : '',
    score ? `<span class="hero-stat-chip"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>${score}</span>` : '',
    dur ? `<span class="hero-stat-chip"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>${dur} min</span>` : '',
    studio ? `<span class="hero-stat-chip">${studio}</span>` : '',
  ].filter(Boolean).join('<span class="hero-stat-divider">·</span>');

  return `
    <div class="hero-slide ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
      <div class="hero-bg">
        ${banner ? `<img src="${banner}" alt="${title}" onerror="${fallbackBanner ? `this.onerror=null;this.src='${fallbackBanner}'` : `this.remove()`}">` : `<div style="width:100%;height:100%;background:linear-gradient(180deg,#111,#080808)"></div>`}
      </div>
      <div class="hero-gradient"></div>
      <div class="hero-content">
        <div class="container">
          <div class="hero-layout">
            <div class="hero-info">
              <div class="hero-stat-strip">${chips}</div>
              <div class="hero-title-block">
                <h1 class="hero-title">${title}</h1>
              </div>
              ${desc ? `<p class="hero-desc">${desc}${desc.length >= 200 ? '…' : ''}</p>` : ''}
              <div class="hero-genres">
                ${genres.map(g => `<span class="hero-genre-tag" onclick="location.href='browse.html?genre=${encodeURIComponent(g)}'">${g}</span>`).join('')}
                ${airingBadge}
              </div>
              <div class="hero-actions">
                <a href="info.html?id=${anime.id}" class="btn btn-primary">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                  Watch Now
                </a>
                <a href="info.html?id=${anime.id}" class="btn btn-ghost">Details</a>
              </div>
            </div>
            <div class="hero-cover-wrap">
              ${cover ? `<img class="hero-cover" src="${cover}" alt="${title}">` : ''}
              <div class="hero-cover-glow"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function buildHeroDots(count) {
  const wrap = document.getElementById('hero-dots');
  if (!wrap) return;
  wrap.innerHTML = Array(count).fill('').map((_, i) =>
    `<div class="hero-dot ${i === 0 ? 'active' : ''}" data-dot="${i}"></div>`).join('');
  wrap.addEventListener('click', e => {
    const dot = e.target.closest('[data-dot]');
    if (dot) { goToSlide(+dot.dataset.dot); startSlider(); }
  });
}

function goToSlide(idx) {
  $$('.hero-slide').forEach(s => s.classList.remove('active'));
  $$('.hero-dot').forEach(d => d.classList.remove('active'));
  $$('.hero-slide')[idx]?.classList.add('active');
  $$('.hero-dot')[idx]?.classList.add('active');
  spotlightIdx = idx;
}

function nextSlide() {
  goToSlide((spotlightIdx + 1) % spotlightData.length);
  startSlider();
}

function prevSlide() {
  goToSlide((spotlightIdx - 1 + spotlightData.length) % spotlightData.length);
  startSlider();
}

function startSlider() {
  clearInterval(spotlightTimer);
  spotlightTimer = setInterval(() => goToSlide((spotlightIdx + 1) % spotlightData.length), 3000);
}

async function loadSpotlight() {
  const heroInner = document.getElementById('hero-slides');
  try {
    const data = await Kurovexa.spotlight();
    spotlightData = notUpcoming(noAdult(Array.isArray(data) ? data : (data.info || data.results || data.data || [])))
      .slice(0, 10);
    if (!spotlightData.length) return;
    heroInner.innerHTML = spotlightData.map((a, i) => buildHeroSlide(a, i)).join('');
    buildHeroDots(spotlightData.length);

    const prevBtn = document.getElementById('hero-prev');
    const nextBtn = document.getElementById('hero-next');
    if (prevBtn) prevBtn.onclick = prevSlide;
    if (nextBtn) nextBtn.onclick = nextSlide;

    startSlider();
  } catch (e) {
    console.error('Spotlight error', e);
  }
}

async function loadSection(id, fetcher, ranked = false, withSkeleton = true, filterUpcoming = false) {
  if (withSkeleton) makeSkeletons(7, id);
  try {
    const data = await fetcher();
    let items = noAdult(Array.isArray(data) ? data : (data.results || data.data || []));
    if (filterUpcoming) items = notUpcoming(items);
    fillRow(items, id, ranked);
  } catch {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<p style="color:var(--text-muted);padding:16px 0">Failed to load.</p>';
  }
}

function initHomeSectionLoading() {
  const tasks = [
    { id: 'row-trending', fetcher: () => Kurovexa.trending(1, 20), ranked: true, filterUpcoming: true },
    { id: 'row-popular', fetcher: () => Kurovexa.popular(1, 20), ranked: false },
    { id: 'row-upcoming', fetcher: () => Kurovexa.upcoming(1, 20), ranked: false },
    { id: 'row-movies', fetcher: () => Kurovexa.movies(1, 20), ranked: false },
  ];

  const loaded = new Set();
  const runTask = (task) => {
    if (!task || loaded.has(task.id)) return;
    loaded.add(task.id);
    loadSection(task.id, task.fetcher, task.ranked, false, !!task.filterUpcoming);
  };

  tasks.forEach(t => makeSkeletons(7, t.id));
  runTask(tasks[0]);

  if (!('IntersectionObserver' in window)) {
    tasks.slice(1).forEach(runTask);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const task = tasks.find(t => t.id === entry.target.id);
      runTask(task);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '300px 0px' });

  tasks.slice(1).forEach(task => {
    const el = document.getElementById(task.id);
    if (!el) {
      runTask(task);
      return;
    }
    observer.observe(el);
  });
}

window.loadSidebar = async function loadSidebar() {
  const container = document.getElementById('dynamic-sidebar');
  if (!container) return;

  container.innerHTML = `
    <div class="sidebar-tabs">
        <div class="sidebar-tab active" style="cursor: default; text-align: center; width: 100%;">Top Airing</div>
    </div>
    <div id="sidebar-list">
        <p style="color:var(--text-muted);padding:16px 0;text-align:center;">Loading...</p>
    </div>
  `;

  const listEl = document.getElementById('sidebar-list');

  try {
    const data = await Kurovexa.trending(1, 10);
    const items = notUpcoming(noAdult(Array.isArray(data) ? data : (data.results || data.data || []))).slice(0, 10);

    if (!items.length) {
      listEl.innerHTML = '<p style="color:var(--text-muted);padding:16px 0;text-align:center;">No data found.</p>';
      return;
    }

    listEl.innerHTML = items.map((a, i) => {
      const title = titleOf(a);
      const img = a.coverImage?.large || '';
      const score = scoreLabel(a.averageScore);
      const airing = a.status === 'RELEASING';

      const rankHtml = `<span class="sidebar-rank">${i + 1}</span>`;
      const metaHtml = `<div class="sidebar-meta">${a.format || ''}${a.seasonYear ? ' · ' + a.seasonYear : ''}${score ? ' · ★' + score : ''}</div>`;
      const airingHtml = airing ? '<div style="display:flex;align-items:center;gap:4px;margin-top:2px;"><span style="width:5px;height:5px;border-radius:50%;background:#22c55e;box-shadow:0 0 5px #22c55e;display:inline-block"></span><span style="font-size:0.62rem;color:#22c55e;font-weight:600;">AIRING</span></div>' : '';

      return `
      <a class="sidebar-item" href="info.html?id=${a.id}">
        ${rankHtml}
        <img class="sidebar-thumb" src="${img}" alt="${title}" loading="lazy">
        <div style="flex:1;min-width:0;">
          <div class="sidebar-title">${title}</div>
          ${metaHtml}
          ${airingHtml}
        </div>
      </a>`;
    }).join('');
  } catch {
    listEl.innerHTML = '<p style="color:var(--text-muted);padding:16px 0;text-align:center;">Failed to load data.</p>';
  }
}

function buildGenreBar() {
  const bar = document.getElementById('genre-bar');
  if (!bar) return;
  bar.innerHTML = GENRES.map(g =>
    `<button class="genre-pill" onclick="location.href='browse.html?genre=${encodeURIComponent(g)}'">${g}</button>`
  ).join('');
}

function initSearch() {
  const setupSearch = (inputId, boxId) => {
    const input = document.getElementById(inputId);
    const box = document.getElementById(boxId);
    if (!input || !box) return;
    let timer = null;
    let reqCounter = 0;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 2) { box.classList.remove('open'); return; }
      const reqId = ++reqCounter;
      timer = setTimeout(async () => {
        try {
          const data = await Kurovexa.suggest(q);
          if (reqId !== reqCounter) return;
          const items = Array.isArray(data) ? data : (data.suggestions || data.results || data.data || []);
          if (!items.length) { box.classList.remove('open'); return; }
          box.innerHTML = items.slice(0, 7).map(a => {
            const t = typeof a.title === 'string' ? a.title : (a.title?.english || a.title?.romaji || 'Unknown');
            return `
            <div class="autocomplete-item" onclick="location.href='info.html?id=${a.id}'">
              <img src="${a.poster || a.coverImage?.large || ''}" alt="${t}" loading="lazy">
              <div>
                <div class="autocomplete-item-title">${t}</div>
                <div class="autocomplete-item-meta">${a.format || ''} ${a.year || a.seasonYear || ''}</div>
              </div>
            </div>`;
          }).join('');
          box.classList.add('open');
        } catch {
          if (reqId === reqCounter) box.classList.remove('open');
        }
      }, 280);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) location.href = `browse.html?q=${encodeURIComponent(input.value.trim())}`;
      if (e.key === 'Escape') box.classList.remove('open');
    });

  };

  setupSearch('search-input', 'autocomplete');
  setupSearch('mobile-search-input', 'mobile-autocomplete');
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap') && !e.target.closest('.mobile-search-wrap')) {
      document.getElementById('autocomplete')?.classList.remove('open');
      document.getElementById('mobile-autocomplete')?.classList.remove('open');
    }
  });
}

function initHeader() {
  const header = document.getElementById('header');
  window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 20), { passive: true });
}

function initScrollNav() {
  $$('.row-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(btn.dataset.target);
      row?.scrollBy({ left: (btn.dataset.dir === 'prev' ? -1 : 1) * 500, behavior: 'smooth' });
    });
  });
}

function initHeroSwipe() {
  const hero = document.getElementById('hero');
  if (!hero) return;
  let startX = 0;
  hero.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', e => {
    const diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) { goToSlide(diff > 0 ? (spotlightIdx + 1) % spotlightData.length : (spotlightIdx - 1 + spotlightData.length) % spotlightData.length); startSlider(); }
  });
}

function initMobileMenu() {
  const btn = document.getElementById('mobile-menu-btn');
  const nav = document.getElementById('mobile-nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    btn.classList.toggle('open');
    nav.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#header')) {
      btn.classList.remove('open');
      nav.classList.remove('open');
    }
  });
  const mobileInput = document.getElementById('mobile-search-input');
  if (mobileInput) {
    mobileInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && mobileInput.value.trim()) {
        location.href = `browse.html?q=${encodeURIComponent(mobileInput.value.trim())}`;
      }
    });
  }
}

function showClearConfirm(anchor) {
  document.getElementById('clear-confirm-pop')?.remove();
  const pop = document.createElement('div');
  pop.id = 'clear-confirm-pop';
  pop.innerHTML = `
    <span style="font-size:0.82rem;color:var(--text-secondary)">Clear all history?</span>
    <button id="ccp-yes">Yes, clear</button>
    <button id="ccp-no">Cancel</button>
  `;
  Object.assign(pop.style, {
    position: 'absolute', background: 'var(--bg-elevated)',
    border: '1px solid var(--border-bright)', borderRadius: '10px',
    padding: '10px 14px', display: 'flex', alignItems: 'center',
    gap: '10px', zIndex: '999', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    whiteSpace: 'nowrap', top: (anchor.offsetTop + anchor.offsetHeight + 8) + 'px', right: '0',
  });
  pop.querySelectorAll('button').forEach(b => Object.assign(b.style, {
    padding: '5px 14px', borderRadius: '6px', border: '1px solid var(--border)',
    cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'inherit',
  }));
  Object.assign(pop.querySelector('#ccp-yes').style, { background: '#e11d48', color: '#fff', border: 'none' });
  Object.assign(pop.querySelector('#ccp-no').style, { background: 'transparent', color: 'var(--text-secondary)' });
  const parent = anchor.closest('.section-header') || anchor.parentElement;
  parent.style.position = 'relative';
  parent.appendChild(pop);
  pop.querySelector('#ccp-yes').onclick = () => {
    localStorage.removeItem('kv_history'); pop.remove(); renderWatchHistory();
  };
  pop.querySelector('#ccp-no').onclick = () => pop.remove();
  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('click', h); }
  }), 10);
}

function renderWatchHistory() {
  const section = document.getElementById('section-history');
  const row = document.getElementById('row-history');
  const clearBtn = document.getElementById('clear-history');
  if (!section || !row) return;
  try {
    const history = JSON.parse(localStorage.getItem('kv_history') || '[]');
    if (!history.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    row.innerHTML = history.map(item => {
      const pct = Math.min(100, Math.max(0, ((item.pos || 0) / (item.dur || 1)) * 100));
      const epNum = Number.parseInt(item.ep, 10);
      const watchUrl = `anime.html?id=${encodeURIComponent(item.id)}${Number.isFinite(epNum) && epNum > 0 ? `&ep=${epNum}` : ''}`;
      return `
        <div class="history-card" data-id="${item.id}">
          <div class="history-poster" onclick="location.href='${watchUrl}'">
            <img src="${item.image}" alt="${item.title}" loading="lazy">
            <div class="history-progress-wrap"><div class="history-progress-bar" style="width:${pct}%"></div></div>
            <div class="history-play-icon"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></div>
            <button class="history-remove" onclick="event.stopPropagation();removeHistoryItem('${item.id}')" title="Remove">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div class="history-ep-tag">EP ${item.ep}</div>
          </div>
          <div class="history-body" onclick="location.href='${watchUrl}'">
            <div class="history-title">${item.title}</div>
            <div class="history-subtitle">${item.epTitle || ''}</div>
          </div>
        </div>`;
    }).join('');
    if (clearBtn) clearBtn.onclick = () => showClearConfirm(clearBtn);
  } catch (e) {
    console.error('History render error', e);
    section.style.display = 'none';
  }
}

window.removeHistoryItem = function (id) {
  try {
    const h = JSON.parse(localStorage.getItem('kv_history') || '[]');
    localStorage.setItem('kv_history', JSON.stringify(h.filter(i => i.id !== id)));
    renderWatchHistory();
  } catch (e) { console.error('Remove error', e); }
};

async function loadChangelog() {
  const modal = document.getElementById('changelog-modal');
  const closeIcon = document.getElementById('changelog-close');
  const closeBtn = document.getElementById('changelog-close-btn');
  const dontShowBtn = document.getElementById('changelog-dont-show-btn');
  const body = document.getElementById('changelog-body');
  const title = document.getElementById('changelog-title');
  if (!modal) return;

  try {
    const res = await fetch('https://raw.githubusercontent.com/walterwhite-69/changelogs/main/changelog.json?t=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();

    const lastSeenVersion = localStorage.getItem('kv_changelog_ver');

    if (data.version && data.version !== lastSeenVersion) {
      if (data.title) title.textContent = data.title;

      const escHtml = (s) => String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      const renderText = (raw) => {
        const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
        let out = '', last = 0, m;
        while ((m = linkRe.exec(raw)) !== null) {
          out += escHtml(raw.slice(last, m.index));
          let url = m[2];
          if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url.replace(/^\/\//, '');
          out += `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${escHtml(m[1])}</a>`;
          last = linkRe.lastIndex;
        }
        out += escHtml(raw.slice(last));
        return out.replace(/\r?\n/g, '<br>');
      };

      let html = '';
      for (const [key, val] of Object.entries(data.updates || {})) {
        html += `
          <div class="changelog-item">
            <div class="changelog-item-title">${escHtml(key)}</div>
            <div class="changelog-item-desc">${renderText(val)}</div>
          </div>
        `;
      }
      body.innerHTML = html;
      modal.style.display = 'flex';

      const closeModal = () => {
        modal.style.display = 'none';
      };

      const dontShowAgain = () => {
        modal.style.display = 'none';
        localStorage.setItem('kv_changelog_ver', data.version);
      };

      if (closeIcon) closeIcon.onclick = closeModal;
      if (closeBtn) closeBtn.onclick = closeModal;
      if (dontShowBtn) dontShowBtn.onclick = dontShowAgain;

      modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    }
  } catch (e) {
    console.error('Failed to load changelog:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initHeader(); initSearch(); initScrollNav(); initHeroSwipe(); initMobileMenu();
  buildGenreBar();
  loadSpotlight();
  loadSidebar();
  renderWatchHistory();
  loadChangelog();

  const genreBar = document.getElementById('genre-bar');
  const scrollAmt = 300;
  $$('.genre-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = btn.classList.contains('prev') ? -1 : 1;
      genreBar.scrollBy({ left: dir * scrollAmt, behavior: 'smooth' });
    });
  });

  initHomeSectionLoading();
});
