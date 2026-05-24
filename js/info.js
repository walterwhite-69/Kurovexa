
(function () {
    const $ = sel => document.querySelector(sel);
    const params = new URLSearchParams(location.search);
    const animeId = params.get('id');

    function escHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function stripHtml(s) {
        if (!s) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = s;
        return tmp.textContent || tmp.innerText || '';
    }

    function titleOf(a) {
        const t = a && a.title;
        if (!t) return 'Untitled';
        if (typeof t === 'string') return t;
        return t.english || t.romaji || t.native || 'Untitled';
    }

    function altTitleOf(a) {
        const t = a && a.title;
        if (!t || typeof t === 'string') return '';
        const main = titleOf(a);
        const candidates = [t.romaji, t.native].filter(Boolean).filter(x => x !== main);
        return candidates[0] || '';
    }

    function fmtStatus(s) {
        if (!s) return 'Unknown';
        const map = {
            RELEASING: 'Airing',
            FINISHED: 'Finished',
            NOT_YET_RELEASED: 'Upcoming',
            CANCELLED: 'Cancelled',
            HIATUS: 'Hiatus'
        };
        return map[s] || s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function fmtSeason(season, year) {
        if (!season && !year) return '';
        const s = season ? season.charAt(0) + season.slice(1).toLowerCase() : '';
        return [s, year].filter(Boolean).join(' ');
    }

    function header() {
        const hdr = $('#header');
        if (hdr) {
            const onScroll = () => hdr.classList.toggle('scrolled', window.scrollY > 20);
            window.addEventListener('scroll', onScroll, { passive: true });
            onScroll();
        }
    }

    function wireSearchInput(input, box) {
        if (!input || !box) return;
        let t = null, reqId = 0;
        input.addEventListener('input', e => {
            const q = e.target.value.trim();
            clearTimeout(t);
            if (q.length < 2) { box.classList.remove('open'); return; }
            const my = ++reqId;
            t = setTimeout(async () => {
                try {
                    const data = await Kurovexa.suggest(q);
                    if (my !== reqId) return;
                    const items = Array.isArray(data) ? data : (data.results || data.data || []);
                    if (!items.length) { box.classList.remove('open'); return; }
                    box.innerHTML = items.slice(0, 7).map(a => {
                        const tt = titleOf(a);
                        const img = a.poster || (a.coverImage && a.coverImage.large) || '';
                        return `<div class="autocomplete-item" onclick="location.href='info.html?id=${a.id}'">
                            <img src="${escHtml(img)}" alt="${escHtml(tt)}" loading="lazy">
                            <div>
                                <div class="autocomplete-item-title">${escHtml(tt)}</div>
                                <div class="autocomplete-item-meta">${escHtml(a.format || '')} ${a.year || a.seasonYear || ''}</div>
                            </div>
                        </div>`;
                    }).join('');
                    box.classList.add('open');
                } catch { box.classList.remove('open'); }
            }, 280);
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && input.value.trim()) {
                location.href = 'browse.html?q=' + encodeURIComponent(input.value.trim());
            }
        });
        document.addEventListener('click', e => {
            if (!input.contains(e.target) && !box.contains(e.target)) box.classList.remove('open');
        });
    }

    function setupSearch() {
        wireSearchInput($('#search-input'), $('#autocomplete'));
        wireSearchInput($('#mobile-search-input'), $('#mobile-autocomplete'));

        const menuBtn = document.getElementById('mobile-menu-btn');
        const drawer = document.getElementById('mobile-nav');
        if (menuBtn && drawer) {
            menuBtn.addEventListener('click', () => {
                drawer.classList.toggle('open');
                menuBtn.classList.toggle('open');
            });
        }
    }

    function renderHero(a) {
        const banner = a.bannerImage || (a.coverImage && a.coverImage.extraLarge) || (a.coverImage && a.coverImage.large) || '';
        const poster = (a.coverImage && (a.coverImage.extraLarge || a.coverImage.large)) || a.bannerImage || '';
        const title = titleOf(a);
        const altTitle = altTitleOf(a);

        document.title = `${title} — Kurovexa`;
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            const desc = stripHtml(a.description || '').slice(0, 155);
            metaDesc.setAttribute('content', desc || `Watch ${title} on Kurovexa.`);
        }

        if (banner) $('#info-hero-bg').style.backgroundImage = `url("${banner}")`;
        $('#info-poster-img').src = poster || banner || '';
        $('#info-poster-img').alt = title;
        $('#info-title').textContent = title;
        $('#info-subtitle').textContent = altTitle;

        const eyebrow = [a.format, fmtSeason(a.season, a.seasonYear)].filter(Boolean).join(' • ');
        if (eyebrow) $('#info-eyebrow-text').textContent = eyebrow;

        const score = a.averageScore;
        const status = fmtStatus(a.status);
        const isAiring = a.status === 'RELEASING';
        const eps = a.episodes ? `${a.episodes} eps` : (isAiring ? 'Ongoing' : '');
        const dur = a.duration ? `${a.duration} min` : '';
        const metaParts = [];
        if (score) metaParts.push(`<span class="meta-pill meta-score">★ ${(score / 10).toFixed(1)}</span>`);
        metaParts.push(`<span class="meta-pill ${isAiring ? 'meta-status-airing' : ''}">${escHtml(status)}</span>`);
        if (eps) metaParts.push(`<span class="meta-pill">${escHtml(eps)}</span>`);
        if (dur) metaParts.push(`<span class="meta-pill">${escHtml(dur)}</span>`);
        $('#info-meta-row').innerHTML = metaParts.join('');

        const genres = Array.isArray(a.genres) ? a.genres : [];
        $('#info-genres').innerHTML = genres.slice(0, 8).map(g =>
            `<span class="info-genre-tag" onclick="location.href='browse.html?genre=${encodeURIComponent(g)}'">${escHtml(g)}</span>`
        ).join('');

        const watchBtn = $('#watch-now-btn');
        const isUpcoming = a.status === 'NOT_YET_RELEASED';
        if (isUpcoming) {
            watchBtn.removeAttribute('href');
            watchBtn.classList.add('btn-watch-disabled');
            watchBtn.setAttribute('aria-disabled', 'true');
            watchBtn.style.pointerEvents = 'none';
            watchBtn.style.opacity = '0.6';
            watchBtn.style.cursor = 'not-allowed';
            watchBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg> Coming Soon`;
        } else {
            watchBtn.href = `anime.html?id=${encodeURIComponent(a.id)}`;
        }

        $('#share-btn').onclick = async () => {
            const url = location.href;
            try {
                if (navigator.share) {
                    await navigator.share({ title: `${title} — Kurovexa`, url });
                } else {
                    await navigator.clipboard.writeText(url);
                    if (window.showToast) window.showToast('Link copied', 'Share URL copied to clipboard');
                }
            } catch {  }
        };

        $('#info-loading').style.display = 'none';
        $('#info-hero').style.display = 'block';
        $('#info-body').style.display = 'block';
    }

    function renderBody(a) {
        const desc = stripHtml(a.description || '') || 'No description available.';
        const descEl = $('#info-desc');
        descEl.textContent = desc;

        requestAnimationFrame(() => {
            const overflowing = descEl.scrollHeight - descEl.clientHeight > 4;
            const toggle = $('#info-desc-toggle');
            if (overflowing) {
                toggle.style.display = 'inline-block';
                toggle.onclick = () => {
                    const expanded = descEl.classList.toggle('expanded');
                    toggle.textContent = expanded ? 'Show less' : 'Show more';
                };
            }
        });

        const stats = [
            ['Format', a.format || '—'],
            ['Status', fmtStatus(a.status)],
            ['Episodes', a.episodes || (a.status === 'RELEASING' ? 'Ongoing' : '—')],
            ['Duration', a.duration ? `${a.duration} min` : '—'],
            ['Season', fmtSeason(a.season, a.seasonYear) || '—'],
            ['Score', a.averageScore ? `${(a.averageScore / 10).toFixed(1)} / 10` : '—'],
            ['Popularity', a.popularity ? a.popularity.toLocaleString() : '—'],
            ['Favorites', a.favourites ? a.favourites.toLocaleString() : '—']
        ];
        $('#info-stats').innerHTML = stats.map(([l, v]) =>
            `<div class="info-stat-row"><span class="label">${escHtml(l)}</span><span class="value">${escHtml(String(v))}</span></div>`
        ).join('');

        const tags = Array.isArray(a.tags) ? a.tags : [];
        const interesting = tags
            .filter(t => !t.isMediaSpoiler && !t.isGeneralSpoiler && (t.rank == null || t.rank >= 60))
            .slice(0, 14);
        if (interesting.length) {
            $('#info-tags-section').style.display = 'block';
            $('#info-tags').innerHTML = interesting.map(t =>
                `<span class="info-tag">${escHtml(t.name)}</span>`
            ).join('');
        }
    }

    async function loadCharacters(id) {
        try {
            const data = await Kurovexa.chars(id);
            const list = Array.isArray(data) ? data : (data.results || data.data || []);
            if (!list || !list.length) return;
            const main = list.filter(c => (c.role || '').toUpperCase() === 'MAIN');
            const supporting = list.filter(c => (c.role || '').toUpperCase() !== 'MAIN');
            const items = main.concat(supporting).slice(0, 18);
            if (!items.length) return;
            const html = items.map(c => {
                const name = (c.name && (c.name.full || c.name.first || c.name.userPreferred)) || c.name || 'Unknown';
                const img = (c.image && (c.image.large || c.image.medium)) || c.image || '';
                const role = c.role ? c.role.charAt(0) + c.role.slice(1).toLowerCase() : '';
                return `<div class="info-char-card">
                    <img class="pic" src="${escHtml(img)}" alt="${escHtml(name)}" loading="lazy" onerror="this.style.opacity=0.2">
                    <p class="name">${escHtml(name)}</p>
                    ${role ? `<div class="role">${escHtml(role)}</div>` : ''}
                </div>`;
            }).join('');
            $('#info-chars').innerHTML = html;
            $('#info-chars-section').style.display = 'block';
        } catch (e) {
            console.warn('[info] characters failed', e);
        }
    }

    async function loadRecommendations(id) {
        try {
            const data = await Kurovexa.recs(id);
            const list = Array.isArray(data) ? data : (data.results || data.data || []);
            if (!list || !list.length) return;
            const items = list.slice(0, 14);
            const html = items.map(r => {
                const aid = r.id || (r.media && r.media.id);
                const t = titleOf(r.media || r);
                const img = (r.media && r.media.coverImage && (r.media.coverImage.large || r.media.coverImage.extraLarge))
                    || (r.coverImage && (r.coverImage.large || r.coverImage.extraLarge))
                    || r.poster || '';
                if (!aid) return '';
                return `<a class="info-rec-card" href="info.html?id=${encodeURIComponent(aid)}">
                    <div class="poster"><img src="${escHtml(img)}" alt="${escHtml(t)}" loading="lazy" onerror="this.style.opacity=0.2"></div>
                    <p class="title">${escHtml(t)}</p>
                </a>`;
            }).filter(Boolean).join('');
            if (!html) return;
            $('#info-recs').innerHTML = html;
            $('#info-recs-section').style.display = 'block';
        } catch (e) {
            console.warn('[info] recommendations failed', e);
        }
    }

    const ML_KEY = 'kv_mylist';
    function mlGetLocal() { try { return JSON.parse(localStorage.getItem(ML_KEY) || '{}'); } catch { return {}; } }
    function mlSetLocal(d) { localStorage.setItem(ML_KEY, JSON.stringify(d)); }
    function mlGetEntry(mediaId) { return mlGetLocal()[String(mediaId)] || null; }

    function mlUpdateBtn(mediaId) {
        const btn = document.getElementById('mylist-btn');
        if (!btn) return;
        const entry = mlGetEntry(String(mediaId));
        if (entry) {
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> ${entry.status}`;
            btn.classList.add('saved');
        } else {
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Add to List`;
            btn.classList.remove('saved');
        }
    }

    function openMyListPopover(anime) {
        window._mlAnime = anime;
        const mediaId = String(anime.id);
        document.getElementById('mylist-anime-title').textContent = titleOf(anime);
        const entry = mlGetEntry(mediaId);
        document.querySelectorAll('.mylist-status-btn').forEach(b => {
            b.classList.toggle('active', !!(entry && b.dataset.status === entry.status));
        });
        const user = window._kvUser;
        const anilistRow = document.getElementById('mylist-anilist-row');
        anilistRow.style.display = (user && user.anilist_username) ? 'flex' : 'none';
        if (anilistRow.style.display === 'flex') document.getElementById('mylist-anilist-sync').checked = false;
        const footer = document.getElementById('mylist-footer');
        footer.innerHTML = '';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'mylist-save-btn';
        saveBtn.textContent = 'Save to My List';
        const poster = (anime.coverImage && (anime.coverImage.extraLarge || anime.coverImage.large)) || '';
        saveBtn.onclick = () => mlSave(mediaId, titleOf(anime), poster);
        footer.appendChild(saveBtn);
        if (entry) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'mylist-remove-btn';
            removeBtn.textContent = 'Remove';
            removeBtn.onclick = () => mlRemove(mediaId, titleOf(anime));
            footer.appendChild(removeBtn);
        } else {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'mylist-cancel-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = closeMyListPopover;
            footer.appendChild(cancelBtn);
        }
        document.getElementById('mylist-popover').classList.add('open');
    }

    function closeMyListPopover() {
        document.getElementById('mylist-popover').classList.remove('open');
    }
    window.closeMyListPopover = closeMyListPopover;

    async function mlSave(mediaId, title, poster) {
        const active = document.querySelector('.mylist-status-btn.active');
        if (!active) {
            document.querySelectorAll('.mylist-status-btn').forEach(b => {
                b.style.outline = '1.5px solid rgba(239,68,68,0.6)';
                setTimeout(() => { b.style.outline = ''; }, 700);
            });
            return;
        }
        const status = active.dataset.status;
        const syncAl = document.getElementById('mylist-anilist-sync')?.checked;
        const token = localStorage.getItem('kv_token');
        if (token) {
            fetch('/api/mylist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ media_id: mediaId, title, poster, status })
            }).catch(() => {});
        }
        const list = mlGetLocal();
        list[mediaId] = { id: mediaId, title, poster, status, addedAt: new Date().toISOString() };
        mlSetLocal(list);
        if (syncAl && token) {
            const alStatus = { Watching: 'CURRENT', Planning: 'PLANNING', Completed: 'COMPLETED', Dropped: 'DROPPED', Paused: 'PAUSED' }[status] || 'PLANNING';
            fetch('/api/anilist/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ mediaId: parseInt(mediaId, 10), status: alStatus })
            }).catch(() => {});
        }
        closeMyListPopover();
        mlUpdateBtn(mediaId);
        if (window.showToast) window.showToast('Added to My List', `${title} → ${status}`);
    }

    async function mlRemove(mediaId, title) {
        const token = localStorage.getItem('kv_token');
        if (token) {
            fetch(`/api/mylist/${mediaId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => {});
        }
        const list = mlGetLocal();
        delete list[mediaId];
        mlSetLocal(list);
        closeMyListPopover();
        mlUpdateBtn(mediaId);
        if (window.showToast) window.showToast('Removed', `${title} removed from My List`);
    }

    function setupMyListBtn(anime) {
        const btn = document.getElementById('mylist-btn');
        if (!btn) return;
        mlUpdateBtn(String(anime.id));
        btn.onclick = () => openMyListPopover(anime);
        document.querySelectorAll('.mylist-status-btn').forEach(b => {
            b.onclick = () => {
                document.querySelectorAll('.mylist-status-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
            };
        });
    }

    async function init() {
        header();
        setupSearch();
        if (!animeId) {
            $('#info-loading').textContent = 'No anime ID provided.';
            return;
        }
        let data = null;
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                if (attempt > 0) await new Promise(r => setTimeout(r, 1200 * attempt));
                data = await Kurovexa.info(animeId);
                if (data && data.id) break;
                lastErr = new Error('Empty response');
                data = null;
            } catch (e) {
                lastErr = e;
                console.warn('[info] attempt', attempt + 1, 'failed', e);
            }
        }
        if (!data) {
            console.error('[info] load failed after retries', lastErr);
            $('#info-loading').textContent = 'Could not load anime details. Please try again.';
            return;
        }
        renderHero(data);
        setupMyListBtn(data);
        renderBody(data);
        loadCharacters(animeId);
        loadRecommendations(animeId);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
