const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];

let currentPage = 1;
let hasNextPage = true;
let activeFilters = {
    query: '',
    genres: [],
    sort: 'TRENDING_DESC',
    season: '',
    status: ''
};

function titleOf(a) { return a.title?.english || a.title?.romaji || a.title?.native || 'Unknown'; }
function scoreLabel(s) { return s ? (s / 10).toFixed(1) : null; }

function buildCard(anime) {
    const title = titleOf(anime);
    const img = anime.coverImage?.large || anime.coverImage?.extraLarge || '';
    const score = scoreLabel(anime.averageScore);
    const eps = anime.episodes ? `EP ${anime.episodes}` : (anime.status === 'RELEASING' ? 'Ongoing' : '');
    const url = `info.html?id=${anime.id}`;
    const nextEp = anime.nextAiringEpisode;
    const isUnreleased = anime.status === 'NOT_YET_RELEASED' || (nextEp && nextEp.episode === 1) || anime.next_episode === 1;

    let quickBtn = '<div class="card-quick"><div class="card-quick-btn">▶ Watch Now</div></div>';
    if (isUnreleased) {
        quickBtn = '<div class="card-quick"><div class="card-quick-btn" style="background:rgba(255,255,255,0.1);color:#fff;">View Details</div></div>';
    }

    return `
      <div class="anime-card" onclick="location.href='${url}'">
        <div class="card-poster">
          <img src="${img}" alt="${title}" loading="lazy">
          <div class="card-overlay"></div>
          ${eps ? `<div class="card-badge-ep">${eps}</div>` : ''}
          ${quickBtn}
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

function makeSkeletons(count, parentId) {
    const p = document.getElementById(parentId);
    if (!p) return;
    p.innerHTML = Array(count).fill('').map(() => `
      <div class="skel-card" style="width: 100%;">
        <div class="skeleton skel-poster"></div>
        <div class="skeleton skel-line" style="margin-top:10px;"></div>
        <div class="skeleton skel-line skel-line-sm"></div>
      </div>`).join('');
}

function initGenres() {
    const c = document.getElementById('filter-genres');
    c.innerHTML = GENRES.map(g => `
        <label class="genre-cb">
            <input type="checkbox" value="${g}">
            <span>${g}</span>
        </label>
    `).join('');
}

function parseURLFilters() {
    const params = new URLSearchParams(window.location.search);
    activeFilters.query = params.get('q') || '';

    if (params.get('genre')) activeFilters.genres = [params.get('genre')];
    if (params.get('genres')) activeFilters.genres = params.get('genres').split(',');

    if (params.get('sort')) {
        const s = params.get('sort').toUpperCase();
        if (s === 'POPULAR') activeFilters.sort = 'POPULARITY_DESC';
        else if (s === 'UPCOMING') { activeFilters.status = 'NOT_YET_RELEASED'; activeFilters.sort = 'POPULARITY_DESC'; }
        else if (s === 'TRENDING') activeFilters.sort = 'TRENDING_DESC';
        else activeFilters.sort = s;
    }

    if (params.get('season')) activeFilters.season = params.get('season');
    if (params.get('status')) activeFilters.status = params.get('status');

    document.getElementById('filter-q').value = activeFilters.query;
    document.getElementById('filter-sort').value = activeFilters.sort;
    if (activeFilters.season) document.getElementById('filter-season').value = activeFilters.season;
    if (activeFilters.status) document.getElementById('filter-status').value = activeFilters.status;

    $$('.genre-cb input').forEach(cb => {
        cb.checked = activeFilters.genres.includes(cb.value);
    });
}

function gatherFilters() {
    activeFilters.query = document.getElementById('filter-q').value.trim();
    activeFilters.sort = document.getElementById('filter-sort').value;
    activeFilters.season = document.getElementById('filter-season').value;
    activeFilters.status = document.getElementById('filter-status').value;
    activeFilters.genres = $$('.genre-cb input:checked').map(cb => cb.value);

    const params = new URLSearchParams();
    if (activeFilters.query) params.set('q', activeFilters.query);
    if (activeFilters.genres.length) params.set('genres', activeFilters.genres.join(','));
    if (activeFilters.sort && activeFilters.sort !== 'TRENDING_DESC') params.set('sort', activeFilters.sort);
    if (activeFilters.season) params.set('season', activeFilters.season);
    if (activeFilters.status) params.set('status', activeFilters.status);

    window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`);
    currentPage = 1;
    loadResults();
}

async function loadResults() {
    const grid = document.getElementById('browse-grid');
    makeSkeletons(20, 'browse-grid');
    document.getElementById('pagination').style.display = 'none';

    let title = 'Explore Anime';
    if (activeFilters.query) title = `Search: ${activeFilters.query}`;
    else if (activeFilters.genres.length === 1) title = `${activeFilters.genres[0]} Anime`;
    document.getElementById('browse-title').innerText = title;

    try {
        let res;
        if (activeFilters.query && !activeFilters.genres.length && activeFilters.sort === 'TRENDING_DESC' && !activeFilters.season && !activeFilters.status) {
            res = await Kurovexa.search(activeFilters.query, currentPage, 20);
        } else {
            const f = { page: currentPage, per_page: 20, sort: activeFilters.sort };
            if (activeFilters.query) f.query = activeFilters.query;
            if (activeFilters.genres.length > 0) {
                f.genre = activeFilters.genres;
            }
            if (activeFilters.season) f.season = activeFilters.season;
            if (activeFilters.status) f.status = activeFilters.status;
            res = await Kurovexa.filter(f);
        }

        const items = Array.isArray(res) ? res : (res.results || res.data || []);
        hasNextPage = res.hasNextPage !== false && items.length === 20;

        if (!items.length) {
            grid.innerHTML = '<div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted);">No anime found matching your criteria.</div>';
            return;
        }

        grid.innerHTML = items.map(buildCard).join('');

        document.getElementById('pagination').style.display = 'flex';
        document.getElementById('page-indicator').innerText = `Page ${currentPage}`;
        document.getElementById('btn-prev').disabled = currentPage === 1;
        document.getElementById('btn-next').disabled = !hasNextPage;

        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (e) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--accent-red);">Failed to load results.</div>';
        console.error(e);
    }
}

document.getElementById('btn-apply-filters').addEventListener('click', gatherFilters);
document.getElementById('btn-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadResults(); } });
document.getElementById('btn-next').addEventListener('click', () => { if (hasNextPage) { currentPage++; loadResults(); } });

function initSearch() {
    const input = document.getElementById('search-input');
    const box = document.getElementById('autocomplete');
    if (!input || !box) return;
    let searchTimer = null;
    let reqCounter = 0;
    input.addEventListener('input', () => {
        const q = input.value.trim();
        clearTimeout(searchTimer);
        if (q.length < 2) { box.classList.remove('open'); return; }
        const reqId = ++reqCounter;
        searchTimer = setTimeout(async () => {
            try {
                const data = await Kurovexa.suggest(q);
                if (reqId !== reqCounter) return;
                const items = Array.isArray(data) ? data : (data.results || data.data || []);
                if (!items.length) { box.classList.remove('open'); return; }
                box.innerHTML = items.slice(0, 7).map(a => `<div class="autocomplete-item" onclick="location.href='info.html?id=${a.id}'"><img src="${a.poster || a.coverImage?.large || ''}" loading="lazy"><div><div class="autocomplete-item-title">${titleOf(a)}</div><div class="autocomplete-item-meta">${a.format || ''} ${a.seasonYear || ''}</div></div></div>`).join('');
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
    document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) box.classList.remove('open'); });
}

function initHeader() {
    const header = document.getElementById('header');
    window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 20), { passive: true });
}

document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    initSearch();
    initGenres();
    parseURLFilters();
    loadResults();
});
