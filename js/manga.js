const VAULT_BASE = 'https://vaultapi-one.vercel.app';

async function vaultFetch(path) {

    if (typeof window !== 'undefined' && typeof window.fetchAPI === 'function'
        && window.cryptoInstance && window.cryptoInstance.key) {
        const j = await window.fetchAPI('/manga' + path);
        if (j && j.success === false) throw new Error(j.error || 'API error');
        return j && Object.prototype.hasOwnProperty.call(j, 'data') ? j.data : j;
    }
    const r = await fetch(VAULT_BASE + path, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'API error');
    return j.data;
}

function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function imgUrl(u) {
    if (!u) return '';
    let s = String(u);
    if (s.startsWith('https://atsu.moe/') && !s.includes('/static/')) {
        s = 'https://atsu.moe/static/' + s.slice('https://atsu.moe/'.length);
    }
    return s;
}

function qsParam(name) {
    return new URLSearchParams(location.search).get(name);
}

function mangaCard(item) {
    const id = encodeURIComponent(item.id);
    const rawCover = imgUrl(item.cover || '');
    const cover = escHtml(rawCover);
    const title = escHtml(item.title || 'Untitled');
    const type = escHtml(item.type || 'Manga');
    const pParam = rawCover ? `&p=${encodeURIComponent(rawCover)}` : '';
    return `<a href="manga-info.html?id=${id}${pParam}" class="anime-card manga-card">
    <div class="card-poster">
      <img src="${cover}" alt="${title}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=0.2" />
      <div class="card-overlay"></div>
      <div class="card-quick"><div class="card-quick-btn">Read Now</div></div>
      <span class="card-badge-ep">${type}</span>
    </div>
    <div class="card-body">
      <h3 class="card-title">${title}</h3>
      <div class="card-meta">
        ${item.year ? `<span class="card-meta-item">${item.year}</span>` : ''}
        ${item.status ? `<span class="card-meta-item">${escHtml(item.status)}</span>` : ''}
      </div>
    </div>
  </a>`;
}

function skeletonRow(n = 6) {
    return Array.from({ length: n }, () => '<div class="anime-card skeleton-card"><div class="card-poster"></div><div class="card-body"><div class="sk-line"></div><div class="sk-line short"></div></div></div>').join('');
}

function initShell() {
    const header = document.getElementById('header');
    if (header) {
        const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 20);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }
    const mBtn = document.getElementById('mobile-menu-btn');
    const mNav = document.getElementById('mobile-nav');
    if (mBtn && mNav) {
        mBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mBtn.classList.toggle('open');
            mNav.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#header')) {
                mBtn.classList.remove('open');
                mNav.classList.remove('open');
            }
        });
    }
}

async function initMangaHome() {
    initShell();
    initMangaSearch();

    const q = qsParam('q');
    if (q) {
        const heroEl = document.getElementById('hero');
        if (heroEl) heroEl.style.display = 'none';
        const aside = document.querySelector('#main-content aside');
        if (aside) aside.style.display = 'none';
        const grid = document.querySelector('#main-content .home-grid');
        if (grid) grid.style.gridTemplateColumns = '1fr';
        return runSearch(q);
    }

    const sections = [
        { key: 'trending_carousel', target: 'row-trending' },
        { key: 'hot_updates', target: 'row-hot' },
        { key: 'recently_updated', target: 'row-recent' },
        { key: 'popular', target: 'row-popular' },
        { key: 'top_rated', target: 'row-top' },
        { key: 'recently_added', target: 'row-added' },
        { key: 'most_bookmarked', target: 'row-bookmarked' }
    ];

    document.querySelectorAll('.scroll-row').forEach(r => r.innerHTML = skeletonRow(6));

    try {
        const data = await vaultFetch('/atsu/home');
        sections.forEach(s => {
            const sec = data[s.key];
            if (!sec) return;
            const el = document.getElementById(s.target);
            if (el) el.innerHTML = (sec.items || []).map(mangaCard).join('');
        });
        const trending = (data.trending_carousel && data.trending_carousel.items) || [];
        if (trending.length) renderHero(trending.slice(0, 5));
        initRowNav();
        initSidebar(data);
    } catch (e) {
        document.querySelectorAll('.scroll-row').forEach(r => {
            r.innerHTML = `<div style="padding:20px;color:#f87171;">Failed to load: ${escHtml(e.message)}</div>`;
        });
    }
}

function renderHero(items) {
    const slides = document.getElementById('hero-slides');
    const dots = document.getElementById('hero-dots');
    if (!slides || !dots) return;
    slides.innerHTML = items.map((it, i) => {
        const cover = imgUrl(it.cover || '');
        const safeCover = escHtml(cover);
        const title = escHtml(it.title || 'Untitled');
        const type = escHtml(it.type || 'Manga');
        const pParam = cover ? `&p=${encodeURIComponent(cover)}` : '';
        const link = `manga-info.html?id=${encodeURIComponent(it.id)}${pParam}`;
        const desc = it.description ? escHtml(String(it.description).slice(0, 200)) : 'One of the most-read titles right now on Kurovexa Manga.';
        return `
    <div class="hero-slide ${i === 0 ? 'active' : ''}" data-idx="${i}">
      <div class="hero-bg manga-hero-bg"><img src="${safeCover}" alt="" referrerpolicy="no-referrer" /></div>
      <div class="hero-gradient"></div>
      <div class="hero-content">
        <div class="container">
          <div class="hero-layout">
            <div class="hero-info">
              <div class="hero-stat-strip">
                <span class="hero-stat-chip">${type}</span>
                <span class="hero-stat-divider">·</span>
                <span class="hero-stat-chip">Trending</span>
              </div>
              <div class="hero-title-block">
                <h1 class="hero-title">${title}</h1>
              </div>
              <p class="hero-desc">${desc}</p>
              <div class="hero-actions">
                <a href="${link}" class="btn btn-primary">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/></svg>
                  Read Now
                </a>
                <a href="${link}" class="btn btn-ghost">Details</a>
              </div>
            </div>
            <div class="hero-cover-wrap manga-hero-cover-wrap">
              <img class="hero-cover" src="${safeCover}" alt="${title}" referrerpolicy="no-referrer" />
              <div class="hero-cover-glow"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    }).join('');
    dots.innerHTML = items.map((_, i) => `<button class="hero-dot ${i === 0 ? 'active' : ''}" data-idx="${i}" aria-label="Slide ${i + 1}"></button>`).join('');
    let cur = 0;
    const total = items.length;
    let timer = null;
    const go = (i) => {
        cur = (i + total) % total;
        slides.querySelectorAll('.hero-slide').forEach((s, idx) => s.classList.toggle('active', idx === cur));
        dots.querySelectorAll('.hero-dot').forEach((d, idx) => d.classList.toggle('active', idx === cur));
    };
    const start = () => { clearInterval(timer); timer = setInterval(() => go(cur + 1), 6000); };
    document.getElementById('hero-prev')?.addEventListener('click', () => { go(cur - 1); start(); });
    document.getElementById('hero-next')?.addEventListener('click', () => { go(cur + 1); start(); });
    dots.querySelectorAll('.hero-dot').forEach(d => d.addEventListener('click', () => { go(+d.dataset.idx); start(); }));
    start();
}

function initRowNav() {
    document.querySelectorAll('.row-nav-btn').forEach(b => {
        b.addEventListener('click', () => {
            const t = document.getElementById(b.dataset.target);
            if (t) t.scrollBy({ left: (b.dataset.dir === 'next' ? 1 : -1) * t.clientWidth * 0.85, behavior: 'smooth' });
        });
    });
}

function initSidebar(data) {
    const wrap = document.getElementById('dynamic-sidebar');
    if (!wrap) return;
    const top = (data.top_rated && data.top_rated.items) ? data.top_rated.items.slice(0, 10) : [];
    if (!top.length) return;
    wrap.innerHTML = `
    <div class="sidebar-tabs">
      <div class="sidebar-tab active" style="cursor: default; text-align: center; width: 100%;">Top Rated</div>
    </div>
    <ul class="sb-list">
      ${top.map((it, i) => {
        const cv = imgUrl(it.cover);
        const pp = cv ? `&p=${encodeURIComponent(cv)}` : '';
        return `
        <li>
          <span class="sb-rank">${(i + 1).toString().padStart(2, '0')}</span>
          <a href="manga-info.html?id=${encodeURIComponent(it.id)}${pp}" class="sb-item">
            <img src="${escHtml(cv)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <div class="sb-info">
              <div class="sb-title">${escHtml(it.title)}</div>
              <div class="sb-meta">${escHtml(it.type || 'Manga')}</div>
            </div>
          </a>
        </li>`;
    }).join('')}
    </ul>
  `;
}

function initMangaSearch() {
    const inputs = document.querySelectorAll('input[data-search="manga"]');
    inputs.forEach(input => {
        let t = null;
        const ac = input.parentElement.querySelector('.autocomplete');
        input.addEventListener('input', () => {
            clearTimeout(t);
            const q = input.value.trim();
            if (!q || q.length < 2) {
                if (ac) ac.classList.remove('active');
                return;
            }
            t = setTimeout(async () => {
                try {
                    const data = await vaultFetch(`/atsu/search?keyword=${encodeURIComponent(q)}&limit=8`);
                    if (!ac) return;
                    const items = data.items || [];
                    if (!items.length) {
                        ac.innerHTML = '<div class="ac-empty">No results</div>';
                        ac.classList.add('active');
                        return;
                    }
                    ac.innerHTML = items.map(it => {
                        const cv = imgUrl(it.cover);
                        const pp = cv ? `&p=${encodeURIComponent(cv)}` : '';
                        return `
            <a href="manga-info.html?id=${encodeURIComponent(it.id)}${pp}" class="ac-item">
              <img src="${escHtml(cv)}" alt="" referrerpolicy="no-referrer" />
              <div class="ac-info">
                <div class="ac-title">${escHtml(it.title)}</div>
                <div class="ac-meta">${escHtml(it.type || 'Manga')}${it.year ? ' · ' + it.year : ''}</div>
              </div>
            </a>`;
                    }).join('');
                    ac.classList.add('active');
                } catch (e) { }
            }, 250);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = input.value.trim();
                if (q) location.href = 'manga.html?q=' + encodeURIComponent(q);
            }
        });
        document.addEventListener('click', (e) => {
            if (ac && !input.parentElement.contains(e.target)) ac.classList.remove('active');
        });
    });
}

async function runSearch(q) {
    const main = document.getElementById('main-content');
    if (!main) return;
    main.innerHTML = `<div class="container">
    <h1 class="page-title">Search results for &ldquo;${escHtml(q)}&rdquo;</h1>
    <div class="browse-grid" id="search-results">${skeletonRow(12)}</div>
  </div>`;
    try {
        const data = await vaultFetch(`/atsu/search?keyword=${encodeURIComponent(q)}&limit=24`);
        const items = data.items || [];
        const grid = document.getElementById('search-results');
        if (!items.length) {
            grid.innerHTML = '<div style="padding:20px;color:#94a3b8;grid-column:1/-1;">No manga found.</div>';
            return;
        }
        grid.innerHTML = items.map(mangaCard).join('');
    } catch (e) {
        document.getElementById('search-results').innerHTML = `<div style="padding:20px;color:#f87171;grid-column:1/-1;">Failed: ${escHtml(e.message)}</div>`;
    }
}

async function initMangaInfo() {
    initShell();
    initMangaSearch();
    const id = qsParam('id');
    if (!id) {
        document.getElementById('manga-info').innerHTML = '<div class="container"><p style="padding:60px 0;color:#94a3b8;">No manga selected.</p></div>';
        return;
    }
    try {
        const m = await vaultFetch(`/atsu/manga/${encodeURIComponent(id)}/details`);
        renderMangaInfo(m);
    } catch (e) {
        document.getElementById('manga-info').innerHTML = `<div class="container"><p style="padding:60px 0;color:#f87171;">Failed to load: ${escHtml(e.message)}</p></div>`;
    }
}

function renderMangaInfo(m) {
    const root = document.getElementById('manga-info');
    document.title = `${m.title} — Read on Kurovexa`;
    const chapters = m.chapters || [];
    const sortedDesc = [...chapters].sort((a, b) => (b.number || 0) - (a.number || 0));
    const first = chapters[0];
    const last = chapters[chapters.length - 1];
    const progressKey = `manga:progress:${m.id}`;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(progressKey) || 'null'); } catch (e) { }
    const continueChap = stored && stored.chapterId ? chapters.find(c => c.id === stored.chapterId) : null;
    const released = m.released ? new Date(m.released).getFullYear() : '';

    const passedPoster = qsParam('p');
    const posterUrl = passedPoster ? imgUrl(passedPoster) : imgUrl(m.cover);
    const bannerUrl = imgUrl(m.cover);
    root.innerHTML = `
    <div class="manga-banner">
      <div class="manga-banner-img"><img src="${escHtml(bannerUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.src='${escHtml(posterUrl)}'" /></div>
      <div class="manga-banner-overlay"></div>
    </div>
    <div class="container manga-info-wrap">
      <div class="manga-cover-col">
        <div class="manga-cover-card"><img src="${escHtml(posterUrl)}" alt="${escHtml(m.title)}" referrerpolicy="no-referrer" onerror="this.src='${escHtml(bannerUrl)}'" /></div>
      </div>
      <div class="manga-meta-col">
        <div class="manga-eyebrow">${escHtml(m.type || 'Manga')}${released ? ' · ' + released : ''}</div>
        <h1 class="manga-title">${escHtml(m.title)}</h1>
        <div class="manga-stat-row">
          ${m.views ? `<div class="manga-stat"><span>Views</span><strong>${escHtml(m.views)}</strong></div>` : ''}
          <div class="manga-stat"><span>Chapters</span><strong>${chapters.length}</strong></div>
          ${m.scanlators && m.scanlators.length ? `<div class="manga-stat"><span>Scanlator</span><strong>${escHtml(m.scanlators[0])}</strong></div>` : ''}
        </div>
        <div class="manga-actions">
          ${continueChap ? `<a href="read.html?id=${encodeURIComponent(m.id)}&chapter=${encodeURIComponent(continueChap.id)}" class="btn btn-primary">Continue Ch. ${continueChap.number}</a>` : (first ? `<a href="read.html?id=${encodeURIComponent(m.id)}&chapter=${encodeURIComponent(first.id)}" class="btn btn-primary">Read Chapter 1</a>` : '')}
          ${first && continueChap ? `<a href="read.html?id=${encodeURIComponent(m.id)}&chapter=${encodeURIComponent(first.id)}" class="btn btn-ghost">Read First</a>` : ''}
          ${last && last !== first ? `<a href="read.html?id=${encodeURIComponent(m.id)}&chapter=${encodeURIComponent(last.id)}" class="btn btn-ghost">Read Latest</a>` : ''}
        </div>
      </div>
    </div>
    <div class="container chapter-section">
      <div class="section-header">
        <h2 class="section-title">Chapters</h2>
        <div class="chap-controls">
          <input type="text" id="chap-filter" placeholder="Filter chapter…" />
          <button id="chap-sort" class="btn btn-ghost btn-sm">Newest</button>
        </div>
      </div>
      <div class="chapter-list" id="chapter-list">
        ${sortedDesc.map(c => chapterRow(m, c)).join('')}
      </div>
    </div>
  `;

    let desc = true;
    const sortBtn = document.getElementById('chap-sort');
    const filterInput = document.getElementById('chap-filter');
    function applyFilter() {
        const raw = (filterInput.value || '').toLowerCase().trim();
        const rows = document.querySelectorAll('#chapter-list .chap-row');
        if (!raw) { rows.forEach(r => r.style.display = ''); return; }
        const norm = normalizeChapterQuery(raw);
        const numToken = norm.match(/^(\d+(?:\.\d+)?)$/);
        rows.forEach(r => {
            const num = (r.dataset.num || '').toLowerCase();
            const title = (r.dataset.title || '').toLowerCase();
            let visible = false;
            if (numToken) {
                visible = num === numToken[1] || title.includes(numToken[1]);
            } else if (norm) {
                visible = title.includes(norm) || (num + ' ' + title).includes(norm);
            }
            if (!visible) {
                visible = (num + ' ' + title).includes(raw);
            }
            r.style.display = visible ? '' : 'none';
        });
    }
    sortBtn?.addEventListener('click', () => {
        desc = !desc;
        const list = desc ? sortedDesc : [...chapters];
        sortBtn.textContent = desc ? 'Newest' : 'Oldest';
        document.getElementById('chapter-list').innerHTML = list.map(c => chapterRow(m, c)).join('');
        applyFilter();
    });
    filterInput?.addEventListener('input', applyFilter);
}

const CHAPTER_WORD_NUMS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90, hundred: 100
};

function normalizeChapterQuery(q) {
    if (!q) return '';
    let s = String(q).toLowerCase().trim();
    s = s.replace(/^#\s*/, '');
    s = s.replace(/^(chapters?|chaps?|ch|episodes?|eps?|volumes?|vols?)\.?\s*/i, '');
    s = s.replace(/^(chapters?|chaps?|ch|episodes?|eps?|volumes?|vols?)(?=\d)/i, '');
    s = s.trim();
    const tokens = s.split(/\s+/).map(t => {
        if (CHAPTER_WORD_NUMS[t] != null) return String(CHAPTER_WORD_NUMS[t]);
        return t;
    });
    return tokens.join(' ').trim();
}

function chapterRow(m, c) {
    const num = String(c.number == null ? '' : c.number);
    const title = c.title || '';
    return `<a class="chap-row" data-num="${escHtml(num)}" data-title="${escHtml(title.toLowerCase())}" href="read.html?id=${encodeURIComponent(m.id)}&chapter=${encodeURIComponent(c.id)}">
    <div class="chap-num">Ch. ${escHtml(num)}</div>
    <div class="chap-title">${escHtml(title)}</div>
    <div class="chap-pages">${c.pageCount || 0} pages</div>
  </a>`;
}

let readerState = null;

async function initMangaReader() {
    const id = qsParam('id');
    const chapterId = qsParam('chapter');
    if (!id || !chapterId) {
        document.body.innerHTML = '<p style="padding:40px;color:#fff;text-align:center;">Missing parameters.</p>';
        return;
    }

    try {
        const [details, pages] = await Promise.all([
            vaultFetch(`/atsu/manga/${encodeURIComponent(id)}/details`),
            vaultFetch(`/atsu/manga/${encodeURIComponent(id)}/chapter/${encodeURIComponent(chapterId)}/images`)
        ]);
        setupReader(details, chapterId, pages);
    } catch (e) {
        const el = document.getElementById('reader-loading');
        if (el) el.innerHTML = `<p style="color:#f87171;">Failed to load chapter: ${escHtml(e.message)}</p><a href="javascript:history.back()" class="btn btn-ghost">Go back</a>`;
    }
}

function setupReader(manga, chapterId, pages) {
    const chapters = manga.chapters || [];
    const idx = chapters.findIndex(c => c.id === chapterId);
    const chap = chapters[idx];
    if (!chap) {
        document.getElementById('reader-loading').innerHTML = '<p style="color:#f87171;">Chapter not found.</p>';
        return;
    }

    readerState = {
        manga, chapter: chap, idx, chapters, pages,
        mode: localStorage.getItem('manga:reader:mode') || null,
        fit: localStorage.getItem('manga:reader:fit') || 'width',
        bg: localStorage.getItem('manga:reader:bg') || 'dark',
        page: 0
    };

    document.title = `${manga.title} · Ch. ${chap.number}`;
    document.getElementById('rd-title').textContent = manga.title;
    document.getElementById('rd-chap').textContent = `Ch. ${chap.number}${chap.title ? ' · ' + chap.title : ''}`;
    document.getElementById('rd-back').href = `manga-info.html?id=${encodeURIComponent(manga.id)}`;

    const prev = chapters[idx - 1];
    const next = chapters[idx + 1];
    const prevBtn = document.getElementById('rd-prev-chap');
    const nextBtn = document.getElementById('rd-next-chap');
    if (prev) {
        prevBtn.href = `read.html?id=${encodeURIComponent(manga.id)}&chapter=${encodeURIComponent(prev.id)}`;
        prevBtn.classList.remove('disabled');
    } else {
        prevBtn.classList.add('disabled');
        prevBtn.removeAttribute('href');
    }
    if (next) {
        nextBtn.href = `read.html?id=${encodeURIComponent(manga.id)}&chapter=${encodeURIComponent(next.id)}`;
        nextBtn.classList.remove('disabled');
    } else {
        nextBtn.classList.add('disabled');
        nextBtn.removeAttribute('href');
    }

    document.body.dataset.bg = readerState.bg;

    if (!readerState.mode) {
        showModePicker();
    } else {
        startReading();
    }
}

function showModePicker() {
    const picker = document.getElementById('rd-mode-picker');
    picker.classList.add('active');
    picker.querySelectorAll('[data-mode]').forEach(b => {
        b.onclick = () => {
            readerState.mode = b.dataset.mode;
            localStorage.setItem('manga:reader:mode', readerState.mode);
            picker.classList.remove('active');
            startReading();
        };
    });
}

function startReading() {
    const loading = document.getElementById('reader-loading');
    if (loading) loading.style.display = 'none';
    document.getElementById('rd-stage').style.display = 'block';
    document.getElementById('rd-topbar').style.display = 'flex';
    document.getElementById('rd-bottombar').style.display = 'flex';
    renderPages();
    attachReaderControls();
    saveProgress();
}

function renderPages() {
    const stage = document.getElementById('rd-stage');
    const pages = readerState.pages || [];
    document.body.dataset.mode = readerState.mode;
    document.body.dataset.fit = readerState.fit;

    if (readerState.mode === 'horizontal') {

        stage.innerHTML = `
      <div class="rd-h-track" id="rd-h-track">
        ${pages.map((src, i) => `<div class="rd-h-slide" data-idx="${i}"><img src="${escHtml(src)}" alt="Page ${i + 1}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${i < 2 ? 'high' : 'low'}" referrerpolicy="no-referrer" /></div>`).join('')}
        <div class="rd-h-slide rd-h-end" data-idx="${pages.length}">
          <div class="rd-end-card">
            <h3>End of Chapter ${readerState.chapter.number}</h3>
            ${readerState.chapters[readerState.idx + 1] ? `<a href="read.html?id=${encodeURIComponent(readerState.manga.id)}&chapter=${encodeURIComponent(readerState.chapters[readerState.idx + 1].id)}" class="btn btn-primary">Next Chapter</a>` : '<p>You are all caught up.</p>'}
            <a href="manga-info.html?id=${encodeURIComponent(readerState.manga.id)}" class="btn btn-ghost">Back to series</a>
          </div>
        </div>
      </div>
      <button class="rd-arrow rd-arrow-left" id="rd-arrow-left" aria-label="Previous page">‹</button>
      <button class="rd-arrow rd-arrow-right" id="rd-arrow-right" aria-label="Next page">›</button>
    `;
        const track = document.getElementById('rd-h-track');
        const goPage = (i) => {
            const max = pages.length;
            readerState.page = Math.max(0, Math.min(max, i));

            const w = track.clientWidth;
            track.scrollTo({ left: w * readerState.page, behavior: 'smooth' });
            updateProgress();
            saveProgress();
        };
        document.getElementById('rd-arrow-left').onclick = () => goPage(readerState.page - 1);
        document.getElementById('rd-arrow-right').onclick = () => goPage(readerState.page + 1);

        let scrollPending = false;
        track.addEventListener('scroll', () => {
            if (scrollPending) return;
            scrollPending = true;
            requestAnimationFrame(() => {
                scrollPending = false;
                const w = track.clientWidth;
                if (!w) return;
                const i = Math.round(track.scrollLeft / w);
                if (i !== readerState.page) {
                    readerState.page = i;
                    updateProgress();
                    saveProgress();
                }
            });
        }, { passive: true });

        document.onkeydown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); goPage(readerState.page + 1); }
            if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPage(readerState.page - 1); }
        };
        setTimeout(() => goPage(0), 50);
    } else {
        stage.innerHTML = `
      <div class="rd-v-stack">
        ${pages.map((src, i) => `<div class="rd-v-page" data-idx="${i}"><img src="${escHtml(src)}" alt="Page ${i + 1}" loading="${i < 3 ? 'eager' : 'lazy'}" referrerpolicy="no-referrer" /></div>`).join('')}
        <div class="rd-v-end">
          <h3>End of Chapter ${readerState.chapter.number}</h3>
          ${readerState.chapters[readerState.idx + 1] ? `<a href="read.html?id=${encodeURIComponent(readerState.manga.id)}&chapter=${encodeURIComponent(readerState.chapters[readerState.idx + 1].id)}" class="btn btn-primary">Next Chapter</a>` : '<p style="color:#94a3b8;">You are all caught up.</p>'}
          <a href="manga-info.html?id=${encodeURIComponent(readerState.manga.id)}" class="btn btn-ghost">Back to series</a>
        </div>
      </div>
    `;
        const stack = stage.querySelector('.rd-v-stack');
        const obs = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    const i = +e.target.dataset.idx;
                    if (!isNaN(i) && i !== readerState.page) {
                        readerState.page = i;
                        updateProgress();
                        saveProgress();
                    }
                }
            });
        }, { threshold: 0.5 });
        stack.querySelectorAll('.rd-v-page').forEach(p => obs.observe(p));
        document.onkeydown = (e) => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' }); }
            if (e.key === 'PageUp') { e.preventDefault(); window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' }); }
        };
        window.scrollTo({ top: 0 });
    }
    updateProgress();
}

function updateProgress() {
    const pages = readerState.pages || [];
    const total = pages.length;
    const cur = Math.min(readerState.page + 1, total);
    document.getElementById('rd-page-num').textContent = `${cur} / ${total}`;
    const bar = document.getElementById('rd-bar-fill');
    if (bar) bar.style.width = total ? `${(cur / total) * 100}%` : '0%';
}

function saveProgress() {
    if (!readerState) return;
    localStorage.setItem(`manga:progress:${readerState.manga.id}`, JSON.stringify({
        chapterId: readerState.chapter.id,
        chapterNumber: readerState.chapter.number,
        page: readerState.page,
        title: readerState.manga.title,
        cover: readerState.manga.cover,
        updated: Date.now()
    }));
}

function attachReaderControls() {
    document.getElementById('rd-settings-btn').onclick = () => document.getElementById('rd-settings').classList.toggle('active');
    document.getElementById('rd-settings-close').onclick = () => document.getElementById('rd-settings').classList.remove('active');

    document.querySelectorAll('#rd-settings [data-set-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.setMode === readerState.mode);
        b.onclick = () => {
            readerState.mode = b.dataset.setMode;
            localStorage.setItem('manga:reader:mode', readerState.mode);
            document.querySelectorAll('#rd-settings [data-set-mode]').forEach(x => x.classList.toggle('active', x.dataset.setMode === readerState.mode));
            readerState.page = 0;
            renderPages();
        };
    });

    document.querySelectorAll('#rd-settings [data-set-fit]').forEach(b => {
        b.classList.toggle('active', b.dataset.setFit === readerState.fit);
        b.onclick = () => {
            readerState.fit = b.dataset.setFit;
            localStorage.setItem('manga:reader:fit', readerState.fit);
            document.querySelectorAll('#rd-settings [data-set-fit]').forEach(x => x.classList.toggle('active', x.dataset.setFit === readerState.fit));
            document.body.dataset.fit = readerState.fit;
        };
    });

    document.querySelectorAll('#rd-settings [data-set-bg]').forEach(b => {
        b.classList.toggle('active', b.dataset.setBg === readerState.bg);
        b.onclick = () => {
            readerState.bg = b.dataset.setBg;
            localStorage.setItem('manga:reader:bg', readerState.bg);
            document.body.dataset.bg = readerState.bg;
            document.querySelectorAll('#rd-settings [data-set-bg]').forEach(x => x.classList.toggle('active', x.dataset.setBg === readerState.bg));
        };
    });

    let timeout = null;
    const showBars = () => {
        document.body.classList.remove('rd-hide-bars');
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            document.body.classList.add('rd-hide-bars');
        }, 2800);
    };
    document.addEventListener('mousemove', showBars);
    document.addEventListener('touchstart', showBars, { passive: true });
    window.addEventListener('scroll', showBars, { passive: true });
    showBars();
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('manga-home')) initMangaHome();
    else if (document.getElementById('manga-info')) initMangaInfo();
    else if (document.getElementById('manga-reader')) initMangaReader();
});
