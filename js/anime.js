const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

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

const PROVIDER_NAMES = {
    kiwi: 'Astra',
    arc: 'Zenith',
    anikoto: 'Solaris',
    hop: 'Orbit',
    jet: 'Comet',
    bee: 'Nova',
    pulsar: 'Pulsar',
    pahe: 'Sally',
};

const PROVIDER_ORDER = [
    'kiwi', 'anikoto', 'arc', 'hop', 'jet', 'bee', 'pulsar', 'pahe',
];

const PROXY_BASE = 'YOUR_PROXY_URL';

function proxyM3u8(url, referer) {
    if (!url || url.startsWith('blob:')) return url;
    if (url.startsWith(PROXY_BASE)) return url;
    let proxyUrl = `${PROXY_BASE}?url=${encodeURIComponent(url)}`;
    if (referer) proxyUrl += `&ref=${encodeURIComponent(referer)}`;
    return proxyUrl;
}

const params = new URLSearchParams(window.location.search);
const animeId = params.get('id');
const requestedEpRaw = Number.parseInt(params.get('ep'), 10);
const requestedEpNum = Number.isFinite(requestedEpRaw) && requestedEpRaw > 0 ? requestedEpRaw : null;
let requestedEpHandled = false;
let currentAudio = 'sub';
let animeData = null;
let episodeData = null;
let displayedCount = 20;
let displayedCountCompact = 50;
let _epViewMode = localStorage.getItem('kv_ep_view') || 'list';

const kvPrefs = {
    get: (key) => localStorage.getItem(key) === '1',
    set: (key, val) => localStorage.setItem(key, val ? '1' : '0'),
};

window.kvTogglePref = function (key) {
    const newVal = !kvPrefs.get(key);
    kvPrefs.set(key, newVal);
    _syncPrefUI(key, newVal);
};

function _syncPrefUI(key, val) {
    const pillMap = { kv_auto_next: 'pill-auto-next', kv_auto_skip: 'pill-auto-skip' };
    const btnMap  = { kv_auto_next: 'pref-auto-next', kv_auto_skip: 'pref-auto-skip' };
    const pill = document.getElementById(pillMap[key]);
    const btn  = document.getElementById(btnMap[key]);
    if (pill) pill.classList.toggle('on', val);
    if (btn)  btn.classList.toggle('on', val);
}

function initPrefsUI() {
    ['kv_auto_next', 'kv_auto_skip'].forEach(key => _syncPrefUI(key, kvPrefs.get(key)));
}

function goNextEpisode() {
    const eps = episodeData?.[currentAudio] || [];
    const next = eps.find(e => e.number === currentEpNum + 1);
    if (next) {
        switchEpisode(next.id, next.number, next.title || `Episode ${next.number}`, false, !!next.filler);
    }
}

function _syncEpViewToggleIcon() {
    const iconGrid = document.getElementById('ep-view-icon-grid');
    const iconList = document.getElementById('ep-view-icon-list');
    const lbl = document.getElementById('ep-view-toggle-label');
    const btn = document.getElementById('ep-view-toggle');
    const isCompact = _epViewMode === 'compact';
    if (iconGrid) iconGrid.style.display = isCompact ? 'none' : '';
    if (iconList) iconList.style.display = isCompact ? '' : 'none';
    if (lbl) lbl.textContent = isCompact ? 'List' : 'Grid';
    if (btn) btn.classList.toggle('is-compact', isCompact);
}

window.toggleEpView = function () {
    _epViewMode = _epViewMode === 'list' ? 'compact' : 'list';
    localStorage.setItem('kv_ep_view', _epViewMode);
    _syncEpViewToggleIcon();
    const epList = document.getElementById('ep-list');
    const query = document.getElementById('ep-search-input')?.value?.trim() || '';
    if (epList) {
        epList.classList.add('ep-switching');
        setTimeout(() => {
            renderEpisodes(query);
            epList.classList.remove('ep-switching');
        }, 150);
    } else {
        renderEpisodes(query);
    }
};

let hlsInstance = null;
let currentEpId = null;
let currentEpNum = null;

let streamsByProvider = {};
let activeServerKey = null;
let activeQuality = null;
let _providerLoadToken = 0;
const HLS_ONLY_PROVIDERS = new Set(['bee', 'anikoto']);

const WATCH_PROVIDER_ALIAS = { anikoto: 'bee' };

const _notifiedAnimes = new Set();
let _lastEpToast = null;
let _trackingProfile = null;

async function loadTrackingProfile() {
    const token = localStorage.getItem('kv_token');
    if (!token) return;
    try {
        const res = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) _trackingProfile = await res.json();
    } catch (_) {}
}

let _currentSubtitles = [];
let _applySubToken = 0;
let _currentSubReferer = null;
let _vttCues = [];
let _vttSubVisible = true;

const _HARDCODED_SUB_PROVIDERS = new Set(['kiwi']);
const _subSettings = (() => {
    try {
        const saved = JSON.parse(localStorage.getItem('kv_sub_settings') || '{}');
        return {
            size:    typeof saved.size    === 'number' ? saved.size    : 100,
            x:       typeof saved.x       === 'number' ? saved.x       : 50,
            yBottom: typeof saved.yBottom === 'number' ? saved.yBottom : 12,
        };
    } catch { return { size: 100, x: 50, yBottom: 12 }; }
})();
function _saveSubSettings() {
    try { localStorage.setItem('kv_sub_settings', JSON.stringify(_subSettings)); } catch {}
}

let _userPickedServer = false;

window._franchiseCandidates = [];

async function _walkFranchiseChain(startInfo, maxSteps = 6) {
    const out = [];
    const seen = new Set();
    const pushUnique = (node, relType) => {
        if (!node || !node.id || seen.has(node.id)) return;
        seen.add(node.id);
        out.push({ ...node, _relationType: relType });
    };

    const directEdges = (startInfo && startInfo.relations && startInfo.relations.edges) || [];
    pushUnique(startInfo, 'SELF');
    for (const e of directEdges) {
        if (e && e.node) pushUnique(e.node, e.relationType);
    }

    const walk = async (seedId, relKey, steps) => {
        let currentId = seedId;
        for (let i = 0; i < steps && currentId; i++) {
            try {
                const info = await Kurovexa.info(currentId);
                const edges = (info && info.relations && info.relations.edges) || [];
                const nextEdge = edges.find(x => x && x.relationType === relKey && x.node);
                if (!nextEdge) break;
                pushUnique(nextEdge.node, relKey);
                currentId = nextEdge.node.id;
            } catch { break; }
        }
    };

    const directSequel = directEdges.find(e => e && e.relationType === 'SEQUEL' && e.node);
    const directPrequel = directEdges.find(e => e && e.relationType === 'PREQUEL' && e.node);
    await Promise.all([
        directSequel ? walk(directSequel.node.id, 'SEQUEL', maxSteps) : Promise.resolve(),
        directPrequel ? walk(directPrequel.node.id, 'PREQUEL', maxSteps) : Promise.resolve(),
    ]);

    return out;
}

async function loadAnime() {
    if (!animeId) { window.location.href = 'index.html'; return; }

    try {
        const [info, episodes] = await Promise.all([
            Kurovexa.info(animeId),
            Kurovexa.episodes(animeId)
        ]);

        animeData = info;
        const providers = episodes.providers || {};
        window._franchiseChainPromise = _walkFranchiseChain(info, 6)
            .then(list => { window._franchiseCandidates = list; return list; })
            .catch(err => { console.warn('franchise walk failed', err); return []; });

        window._rawProviders = providers;
        const providerList = Object.values(providers);
        episodeData = { sub: [], dub: [] };

        let richSeasonsList = [];
        let bareSeasonsList = [];
        const baseAnimeName = String(
            (info && info.title && (info.title.english || info.title.romaji || info.title.userPreferred)) || ''
        ).trim();
        const baseFirstWord = baseAnimeName.toLowerCase().split(/\s+/)[0] || '';

        for (const p of providerList) {
            const subEps = p.episodes?.sub || [];
            if (subEps.length > episodeData.sub.length) episodeData.sub = subEps;

            const dubEps = p.episodes?.dub || [];
            if (dubEps.length > episodeData.dub.length) episodeData.dub = dubEps;

            const list = p.meta?.seasons || [];
            if (!list.length) continue;
            const isRich = baseFirstWord && list.some(s =>
                String(s.title || '').toLowerCase().includes(baseFirstWord)
            );
            if (isRich && !richSeasonsList.length) richSeasonsList = list;
            else if (!bareSeasonsList.length) bareSeasonsList = list;
        }

        
        const dedupEps = (eps) => {
            const seen = new Set();
            return eps.filter(ep => {
                const key = ep.number;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        };
        episodeData.sub = dedupEps(episodeData.sub);
        episodeData.dub = dedupEps(episodeData.dub);

        let seasonsList = richSeasonsList.length ? richSeasonsList : bareSeasonsList;

        const posterByIndex = [];
        for (const p of providerList) {
            const list = p.meta?.seasons || [];
            list.forEach((s, i) => {
                if (s && s.poster && !posterByIndex[i]) posterByIndex[i] = s.poster;
            });
        }
        const animeFallbackPoster =
            (info && (info.coverImage?.large || info.coverImage?.extraLarge || info.bannerImage)) || '';

        if (seasonsList.length) {
            seasonsList = seasonsList.map((s, i) => {
                const t = String(s.title || '').trim();
                let searchTitle = t;
                if (baseAnimeName) {
                    const hasName = baseFirstWord && t.toLowerCase().includes(baseFirstWord);
                    if (!hasName) {

                        searchTitle = `${baseAnimeName} ${t}`.replace(/\s+/g, ' ').trim();
                    }
                }

                const slug = String(s.url || '').split('/').filter(Boolean).pop() || '';
                const slugTitle = _slugToTitle(slug);
                const posterUrl = s.poster || posterByIndex[i] || animeFallbackPoster || '';
                return { ...s, searchTitle, slugTitle, slug, posterUrl };
            });
        }

        renderDetails(animeData, seasonsList);

        if (window._franchiseChainPromise) {
            window._franchiseChainPromise.then(allCands => {
                if (!Array.isArray(allCands) || !allCands.length) return;

                
                
                
                
                const dateVal = c => {
                    const sd = c.startDate;
                    if (sd && sd.year) return sd.year * 10000 + (sd.month || 0) * 100 + (sd.day || 0);
                    return (c.seasonYear || 9999) * 10000;
                };
                
                
                
                
                const MAIN_CHAIN_TYPES = new Set(['SELF', 'SEQUEL', 'PREQUEL']);
                const tvCands = allCands
                    .filter(c => c &&
                        (c.format === 'TV' || c.format === 'TV_SHORT') &&
                        MAIN_CHAIN_TYPES.has(c._relationType))
                    .sort((a, b) => dateVal(a) - dateVal(b));

                
                const inChain = tvCands.some(c => String(c.id) === String(animeId));
                if (!inChain || tvCands.length < 2) return;

                let changed = false;

                if (seasonsList.length > 0) {
                    
                    
                    seasonsList.forEach((s, i) => {
                        if (s.anilistId) return;
                        const cand = tvCands[i];
                        if (cand && cand.id) {
                            s.anilistId = cand.id;
                            changed = true;
                        }
                    });

                    
                    seasonsList.forEach(s => {
                        if (s.anilistId) return;
                        const queries = [s.slugTitle, s.searchTitle, s.title].filter(Boolean);
                        let best = null;
                        for (const q of queries) {
                            const r = _pickBestAnilist(allCands, q);
                            if (r && (!best || r.score > best.score)) best = r;
                            if (best && best.score >= 95) break;
                        }
                        if (best && best.score >= 70 && best.a && best.a.id) {
                            s.anilistId = best.a.id;
                            changed = true;
                        }
                    });

                    if (changed) renderDetails(animeData, seasonsList);
                } else {
                    
                    
                    const synthetic = tvCands.map((c, i) => {
                        const t = c.title || {};
                        const title = t.english || t.romaji || t.userPreferred || `Season ${i + 1}`;
                        const poster = (c.coverImage && (c.coverImage.large || c.coverImage.extraLarge)) || '';
                        return {
                            title,
                            searchTitle: title,
                            slugTitle: title,
                            anilistId: c.id,
                            url: '',
                            posterUrl: poster,
                            episodes: c.episodes || null,
                        };
                    });
                    seasonsList.push(...synthetic);
                    renderDetails(animeData, seasonsList);
                }
            }).catch(() => {});
        }

        renderEpisodes();
        loadRecommendations();
        initEpSearch();
        startNextEpCountdown(animeData);

        if (!episodeData.dub.length) {
            const dubBtn = document.querySelector('[data-audio="dub"]');
            if (dubBtn) { dubBtn.style.opacity = '0.4'; dubBtn.title = 'No dub episodes available'; }
        }

        document.title = `${titleOf(animeData)} — Kurovexa`;
    } catch (e) {
        console.error('Failed to load anime info', e);
        $('#main-content').innerHTML = '<div class="container" style="padding:100px 0;text-align:center;"><h2 style="color:var(--accent-red)">Failed to load anime.</h2><p>Please try again later.</p></div>';
    }
}

function showRedirectLoading(title) {
    let overlay = document.querySelector('.redirect-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'redirect-overlay';
        overlay.innerHTML = `
            <div class="redirect-spinner"></div>
            <div class="redirect-text">Finding ${title}...</div>
        `;
        document.body.appendChild(overlay);
    } else {
        overlay.querySelector('.redirect-text').textContent = `Finding ${title}...`;
        overlay.style.display = 'flex';
    }
}

function _normTitle(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[\u2010-\u2015\-]/g, ' ')
        .replace(/['"`’ʼ]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _stripSeasonSuffix(s) {
    return String(s || '')
        .replace(/\b(season|part|cour|arc)\s*\d+\b/gi, '')
        .replace(/\b(s|p)\s*\d+\b/gi, '')
        .replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, '')
        .replace(/\bii+\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function _seasonNumberOf(s) {
    const t = String(s || '').toLowerCase();
    let m = t.match(/\bseason\s*(\d+)\b/);
    if (m) return parseInt(m[1], 10);
    m = t.match(/\b(\d+)(st|nd|rd|th)\s+season\b/);
    if (m) return parseInt(m[1], 10);
    m = t.match(/\bpart\s*(\d+)\b/);
    if (m) return parseInt(m[1], 10);
    m = t.match(/\bcour\s*(\d+)\b/);
    if (m) return parseInt(m[1], 10);

    if (/\biv\b/.test(t)) return 4;
    if (/\biii\b/.test(t)) return 3;
    if (/\bii\b/.test(t)) return 2;
    if (/\bv\b/.test(t)) return 5;
    return null;
}

function _scoreCandidate(a, target, opts) {
    const titles = [
        a.title?.english, a.title?.romaji, a.title?.native, a.title?.userPreferred,
        typeof a.title === 'string' ? a.title : null,
        ...(Array.isArray(a.synonyms) ? a.synonyms : []),
    ].filter(Boolean).map(_normTitle);
    if (!titles.length) return 0;

    const targetSeason = _seasonNumberOf(target);

    let best = 0;
    if (titles.includes(target)) best = 100;

    const targetTokens = new Set(target.split(' ').filter(Boolean));
    if (!targetTokens.size) return best;

    for (const t of titles) {
        if (!t) continue;
        let s = 0;

        if (t === target) {
            s = 100;
        } else if (target.startsWith(t + ' ') || target.endsWith(' ' + t)
                || t.startsWith(target + ' ') || t.endsWith(' ' + target)) {

            const ratio = Math.min(t.length, target.length) / Math.max(t.length, target.length);
            s = Math.round(ratio * 90);
        } else if (t.includes(target) || target.includes(t)) {

            const ratio = Math.min(t.length, target.length) / Math.max(t.length, target.length);
            s = Math.round(ratio * 75);
        }

        const tokens = new Set(t.split(' ').filter(Boolean));
        if (tokens.size) {
            let matched = 0;
            targetTokens.forEach(tok => { if (tokens.has(tok)) matched++; });
            const recall = matched / targetTokens.size;
            const overlap = Math.round(recall * 80);
            if (overlap > s) s = overlap;
        }

        const candSeason = _seasonNumberOf(t);
        if (targetSeason != null && candSeason != null && candSeason !== targetSeason) {
            s = Math.max(0, s - 60);
        } else if (targetSeason != null && candSeason == null && targetSeason !== 1) {

            s = Math.max(0, s - 25);
        } else if (targetSeason == null && candSeason != null && candSeason !== 1) {

            s = Math.max(0, s - 30);
        }
        if (s > best) best = s;
    }

    if (opts && opts.isSelf) best = Math.max(0, best - 15);

    return best;
}

function _pickBestAnilist(candidates, queryTitle) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const t1 = _normTitle(queryTitle);
    const t2 = _normTitle(_stripSeasonSuffix(queryTitle));
    let best = null;
    for (const c of candidates) {
        const opts = { isSelf: c && c._relationType === 'SELF' };
        const s1 = _scoreCandidate(c, t1, opts);
        const s2 = t2 && t2 !== t1 ? _scoreCandidate(c, t2, opts) : 0;
        const s = Math.max(s1, s2);
        if (!best || s > best.score) best = { a: c, score: s };
    }
    return best;
}

function _slugToTitle(slug) {
    if (!slug) return '';
    return String(slug)
        .replace(/[-_]+/g, ' ')
        .replace(/\.(html?|php)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

window.resolveSeason = async function (event, title, slug, anilistId) {
    if (event) event.preventDefault();

    if (anilistId) {
        location.href = `info.html?id=${anilistId}`;
        return;
    }

    showRedirectLoading(title);

    const norm = _normTitle;
    const stripSeasonSuffix = _stripSeasonSuffix;
    const scoreCandidate = _scoreCandidate;

    const slugTitle = _slugToTitle(slug);
    const queries = [];
    const seenQ = new Set();
    const pushQ = (q) => {
        const k = norm(q);
        if (!k || seenQ.has(k)) return;
        seenQ.add(k);
        queries.push(q);
    };
    pushQ(slugTitle);
    pushQ(title);
    pushQ(stripSeasonSuffix(slugTitle || ''));
    pushQ(stripSeasonSuffix(title || ''));

    const findBest = async (query) => {
        try {
            const results = await Kurovexa.search(query, 1, 10);
            const list = Array.isArray(results) ? results : (results.results || results.data || []);
            if (!list.length) return null;
            const target = norm(query);
            const ranked = list
                .map(a => ({ a, score: scoreCandidate(a, target) }))
                .sort((x, y) => y.score - x.score);
            return ranked[0] || null;
        } catch (e) {
            console.error('Season search failed for', query, e);
            return null;
        }
    };

    const STRONG = 70;

    const pickBestFrom = (list) => {
        if (!Array.isArray(list) || !list.length) return null;
        let best = null;
        for (const c of list) {
            const opts = { isSelf: c && c._relationType === 'SELF' };
            let s = 0;
            for (const q of queries) {
                const sc = scoreCandidate(c, norm(q), opts);
                if (sc > s) s = sc;
            }
            if (!best || s > best.score) best = { a: c, score: s };
        }
        return best;
    };

    try {

        let candidates = window._franchiseCandidates || [];
        if (window._franchiseChainPromise) {

            try {
                candidates = await Promise.race([
                    window._franchiseChainPromise,
                    new Promise(res => setTimeout(() => res(candidates), 1500)),
                ]) || candidates;
            } catch {  }
        }

        let best = pickBestFrom(candidates);
        if (best && best.score >= STRONG && best.a && best.a.id) {
            location.href = `info.html?id=${best.a.id}`;
            return;
        }

        let searchBest = null;
        for (const q of queries) {
            const r = await findBest(q);
            if (r && (!searchBest || r.score > searchBest.score)) searchBest = r;
            if (searchBest && searchBest.score >= 95) break;
        }

        const finalBest = (searchBest && (!best || searchBest.score > best.score))
            ? searchBest : best;

        if (finalBest && finalBest.score >= STRONG && finalBest.a && finalBest.a.id) {
            location.href = `info.html?id=${finalBest.a.id}`;
            return;
        }

        const fallbackQuery = slugTitle || title;
        location.href = `browse.html?q=${encodeURIComponent(fallbackQuery)}`;
    } catch (e) {
        console.error('Resolution failed', e);
        location.href = `browse.html?q=${encodeURIComponent(slugTitle || title)}`;
    }
};

function _hideRedirectOverlay() {
    const overlay = document.querySelector('.redirect-overlay');
    if (overlay) overlay.style.display = 'none';
}
window.addEventListener('pageshow', _hideRedirectOverlay);
window.addEventListener('popstate', _hideRedirectOverlay);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _hideRedirectOverlay();
});

function renderDetails(anime, seasons = []) {
      const title = titleOf(anime);
      const poster = anime.coverImage?.large || anime.coverImage?.extraLarge || '';
      const score = scoreLabel(anime.averageScore);
      const year = anime.seasonYear || '';
      const format = anime.format || 'TV';
      const status = formatStatus(anime.status);
      const studio = anime.studios?.nodes?.[0]?.name || '';
      const episodesCount = anime.episodes || '?';
      const duration = anime.duration ? `${anime.duration}m` : '';

      const aaPoster = document.getElementById('aa-poster');
      const aaName   = document.getElementById('aa-name');
      const aaMeta   = document.getElementById('aa-meta');
      const aaLink   = document.getElementById('action-anime');
      if (aaPoster && poster) aaPoster.style.backgroundImage = `url('${poster}')`;
      if (aaName) aaName.textContent = title;
      if (aaMeta) {
          const metaParts = [];
          if (format) metaParts.push(format);
          if (year) metaParts.push(year);
          if (episodesCount && episodesCount !== '?') metaParts.push(`${episodesCount} eps`);
          aaMeta.textContent = metaParts.join('  •  ');
      }
      if (aaLink && anime.id) aaLink.href = `info.html?id=${anime.id}`;

      const unTitle = document.getElementById('up-next-title');
      if (unTitle) unTitle.textContent = title;

      const detailsEl = $('#anime-details');
      if (!detailsEl) return;

      const description = (anime.description || '').replace(/<br\s*\/?>(\s*)/gi, ' ').trim();
      const genres = anime.genres || [];

      const statsParts = [];
      if (score)        statsParts.push(`<span class="wdc-rating">★ ${score}</span>`);
      if (format)       statsParts.push(`<span>${format}</span>`);
      if (status)       statsParts.push(`<span class="wdc-stat-muted">${status}</span>`);
      if (year)         statsParts.push(`<span class="wdc-stat-muted">${year}</span>`);
      if (episodesCount && episodesCount !== '?') statsParts.push(`<span class="wdc-stat-muted">${episodesCount} eps</span>`);
      if (duration)     statsParts.push(`<span class="wdc-stat-muted">${duration}</span>`);
      if (studio)       statsParts.push(`<span class="wdc-stat-muted">${studio}</span>`);

      const statsHtml = statsParts.join('<span class="wdc-dot">•</span>');
      const genresHtml = genres.length
          ? `<div class="wdc-genres">${genres.map(g => `<span class="wdc-genre">${g}</span>`).join('')}</div>`
          : '';
      const descHtml = description
          ? `<div class="wdc-desc" id="wdc-desc">${description}</div><button class="wdc-toggle" id="wdc-toggle-btn" type="button">Show more</button>`
          : '';

      const aired = anime.startDate?.year
          ? `${anime.startDate.year}${anime.endDate?.year && anime.endDate.year !== anime.startDate.year ? ` – ${anime.endDate.year}` : ''}`
          : (year || '');

      const metaRows = [];
      if (studio)  metaRows.push(`<div class="wdc-meta-row"><span class="wdc-meta-k">Studio</span><span class="wdc-meta-v">${studio}</span></div>`);
      if (status)  metaRows.push(`<div class="wdc-meta-row"><span class="wdc-meta-k">Status</span><span class="wdc-meta-v">${status}</span></div>`);
      if (aired)   metaRows.push(`<div class="wdc-meta-row"><span class="wdc-meta-k">Aired</span><span class="wdc-meta-v">${aired}</span></div>`);
      if (format)  metaRows.push(`<div class="wdc-meta-row"><span class="wdc-meta-k">Format</span><span class="wdc-meta-v">${format}</span></div>`);
      if (episodesCount && episodesCount !== '?') metaRows.push(`<div class="wdc-meta-row"><span class="wdc-meta-k">Episodes</span><span class="wdc-meta-v">${episodesCount}</span></div>`);
      if (duration) metaRows.push(`<div class="wdc-meta-row"><span class="wdc-meta-k">Duration</span><span class="wdc-meta-v">${duration}</span></div>`);

      const expandedExtrasHtml = (poster || metaRows.length)
          ? `
              <div class="wdc-divider"></div>
              <div class="wdc-extras">
                  ${poster ? `<a class="wdc-poster-sm" href="info.html?id=${anime.id}" aria-label="${title}"><img src="${poster}" alt="${title}" loading="lazy" onerror="this.style.opacity='0'"></a>` : ''}
                  <div class="wdc-meta-stack">${metaRows.join('')}</div>
              </div>`
          : '';

      detailsEl.classList.remove('is-empty');
      detailsEl.classList.remove('is-expanded');
      detailsEl.innerHTML = `
          <div class="wdc-body">
              <a class="wdc-title-link" href="info.html?id=${anime.id}"><h2 class="wdc-title">${title}</h2></a>
              <div class="wdc-stats">${statsHtml}</div>
              ${genresHtml}
              ${descHtml}
              ${expandedExtrasHtml}
          </div>
      `;

      const desc = document.getElementById('wdc-desc');
      const toggle = document.getElementById('wdc-toggle-btn');
      if (desc && toggle) {
          requestAnimationFrame(() => {
              if (desc.scrollHeight <= desc.clientHeight + 4) {
                  toggle.style.display = 'none';
              }
          });
          toggle.addEventListener('click', () => {
              const isOpen = desc.classList.toggle('is-expanded');
              detailsEl.classList.toggle('is-expanded', isOpen);
              toggle.textContent = isOpen ? 'Show less' : 'Show more';
          });
      }

      const seasonsAside = document.getElementById('seasons-aside');
      const seasonsList  = document.getElementById('seasons-list');
      if (seasonsAside && seasonsList) {
          if (seasons && seasons.length) {
              seasonsList.innerHTML = seasons.map(s => {

                  const displayTitle = String(s.title || '').replace(/'/g, "\\'");
                  const queryTitle   = String(s.searchTitle || s.title || '').replace(/'/g, "\\'");
                  const slug = String(s.url || '').split('/').filter(Boolean).pop() || '';
                  const safeSlug = slug.replace(/'/g, "\\'");
                  const eps = s.episodes ? `<span class="sa-eps">${s.episodes} eps</span>` : '';
                  const posterSrc = s.posterUrl || s.poster || '';
                  const sp = posterSrc
                      ? `<div class="sa-poster-wrap"><img class="sa-poster" src="${posterSrc}" alt="${displayTitle}" loading="lazy" referrerpolicy="no-referrer" width="200" height="300" onerror="this.classList.add('sa-poster--ph');this.removeAttribute('src');"></div>`
                      : '<div class="sa-poster-wrap"><div class="sa-poster sa-poster--ph"></div></div>';
                  const aid = s.anilistId ? String(s.anilistId) : '';
                  return `
                      <a class="sa-item" href="${aid ? `info.html?id=${aid}` : 'javascript:void(0)'}" onclick="resolveSeason(event, '${queryTitle}', '${safeSlug}', '${aid}')" title="${displayTitle}">
                          ${sp}
                          <div class="sa-info">
                              <div class="sa-title">${s.title || 'Season'}</div>
                              ${eps}
                          </div>
                      </a>`;
              }).join('');
              seasonsAside.hidden = false;

              initSeasonsScroller();
          } else {
              seasonsList.innerHTML = '';
              seasonsAside.hidden = true;
          }
      }
  }

  function initSeasonsScroller() {
      const scroller = document.getElementById('seasons-scroller');
      const list     = document.getElementById('seasons-list');
      const prevBtn  = document.getElementById('sa-nav-prev');
      const nextBtn  = document.getElementById('sa-nav-next');
      if (!scroller || !list || !prevBtn || !nextBtn) return;

      const updateArrows = () => {
          const overflowing = list.scrollWidth > list.clientWidth + 2;
          if (!overflowing) {
              prevBtn.hidden = true;
              nextBtn.hidden = true;
              return;
          }

          prevBtn.hidden = false;
          nextBtn.hidden = false;
          const atStart = list.scrollLeft <= 4;
          const atEnd   = Math.ceil(list.scrollLeft + list.clientWidth) >= list.scrollWidth - 4;
          prevBtn.classList.toggle('is-disabled', atStart);
          nextBtn.classList.toggle('is-disabled', atEnd);
      };

      const step = (dir) => {
          const cardW = (list.firstElementChild && list.firstElementChild.offsetWidth) || 130;
          const gap = 12;
          const visibleCards = Math.max(1, Math.floor(list.clientWidth / (cardW + gap)));
          const delta = dir * (visibleCards * (cardW + gap));
          list.scrollBy({ left: delta, behavior: 'smooth' });
      };

      prevBtn.onclick = () => step(-1);
      nextBtn.onclick = () => step(+1);
      list.onscroll = updateArrows;

      let resizeRaf = 0;
      window.addEventListener('resize', () => {
          if (resizeRaf) cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(updateArrows);
      });

      updateArrows();
      requestAnimationFrame(updateArrows);
      setTimeout(updateArrows, 600);
  }

function renderEpisodes(query = '') {
    const epList = $('#ep-list');
    if (!epList) return;

    _syncEpViewToggleIcon();

    let list = episodeData[currentAudio] || [];

    if (query) {
        const q = query.toLowerCase();
        list = list.filter(ep =>
            ep.number.toString().includes(q) ||
            (ep.title && ep.title.toLowerCase().includes(q))
        );
    }

    const total = list.length;

    if (!list.length) {
        const msg = query
            ? 'No episodes match your search.'
            : `No ${currentAudio.toUpperCase()} episodes available for this anime.`;
        epList.className = 'ep-list';
        epList.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--text-muted);font-size:0.9rem;">${msg}</div>`;
        return;
    }

    if (_epViewMode === 'compact') {
        epList.className = 'ep-list ep-view--compact';
        const items = query ? list : list.slice(0, displayedCountCompact);
        epList.innerHTML = items.map(ep => {
            const isActive = ep.number == currentEpNum;
            return `<button class="ep-num-box${ep.filler ? ' filler-ep' : ''}${isActive ? ' active' : ''}" data-num="${ep.number}" onclick="switchEpisode('${ep.id}', ${ep.number}, '${(ep.title || '').replace(/'/g, "\\'")}', ${!!ep.filler})">${ep.number}</button>`;
        }).join('');

        if (!query && displayedCountCompact < total) {
            const remaining = total - displayedCountCompact;
            const btn = document.createElement('button');
            btn.className = 'ep-compact-load-more';
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="6 9 12 15 18 9"/></svg> Show ${Math.min(remaining, 50)} more`;
            btn.onclick = () => { displayedCountCompact += 50; renderEpisodes(query); };
            epList.appendChild(btn);
        }
    } else {
        epList.className = 'ep-list';
        const items = query ? list : list.slice(0, displayedCount);
        const fallbackImg = (animeData && (animeData.bannerImage || animeData.coverImage?.large || animeData.coverImage?.extraLarge)) || '';
        epList.innerHTML = items.map(ep => `
            <div class="ep-item ${ep.filler ? 'filler-ep' : ''}" data-num="${ep.number}" onclick="switchEpisode('${ep.id}', ${ep.number}, '${(ep.title || '').replace(/'/g, "\\'")}', ${!!ep.filler})">
                <div class="ep-img-wrap">
                    <img src="${ep.image || fallbackImg}" alt="Ep ${ep.number}" loading="lazy">
                    <div class="ep-num-badge">EP ${ep.number}</div>
                </div>
                <div class="ep-info">
                    <div class="ep-item-title">${ep.title || `Episode ${ep.number}`}</div>
                    ${ep.airDate ? `<div class="ep-item-air">${ep.airDate}</div>` : ''}
                </div>
            </div>
        `).join('');

        if (!query && displayedCount < total) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'ep-load-more';
            loadMoreBtn.innerHTML = `<span>Show More</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
            loadMoreBtn.onclick = () => { displayedCount += 20; renderEpisodes(); };
            epList.appendChild(loadMoreBtn);
        }
    }

    if (!query && list.length > 0 && !currentEpId) {
        const preferred = (!requestedEpHandled && requestedEpNum !== null)
            ? list.find(ep => ep.number == requestedEpNum)
            : null;
        const selected = preferred || list[0];
        requestedEpHandled = true;
        switchEpisode(selected.id, selected.number, selected.title || `Episode ${selected.number}`, true, !!selected.filler);
    }
}

function initEpSearch() {
    const input = $('#ep-search-input');
    if (!input) return;
    input.addEventListener('input', (e) => {
        renderEpisodes(e.target.value.trim());
    });
}

window.switchEpisode = async function (id, num, title, initial = false, isFiller = false) {

    if (typeof initial === 'boolean' && arguments.length === 4 && typeof title === 'string') {
        isFiller = initial;
        initial = false;
    }

    $$('.ep-item, .ep-num-box').forEach(el => {
        el.classList.toggle('active', el.dataset.num == num);
    });

    $('#current-ep-label').innerText = `Episode ${num}`;
    $('#current-ep-title').innerText = title || `Episode ${num}`;

    const unSub = document.getElementById('up-next-subtitle');
    if (unSub) {
        const animeName = (animeData && (animeData.title?.english || animeData.title?.romaji || animeData.title?.native)) || '';
        unSub.textContent = animeName ? `Playing • Episode ${num} • ${animeName}` : `Playing • Episode ${num}`;
    }

    const fillerWarnEl = $('#current-ep-filler-warn');
    if (fillerWarnEl) {
        fillerWarnEl.style.display = isFiller ? 'block' : 'none';
    }

    if (!initial) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    currentEpId = id;
    currentEpNum = num;
    try {
        const nextParams = new URLSearchParams(window.location.search);
        nextParams.set('id', animeId);
        nextParams.set('ep', String(num));
        window.history.replaceState({}, '', `${window.location.pathname}?${nextParams.toString()}`);

        if (window.kvComments) {
            window.kvComments.load(animeId, num);
        }
    } catch { }

    streamsByProvider = {};
    activeServerKey = null;
    activeQuality = null;

    setPlayerLoading();

    const panel = $('#server-panel');
    if (panel) panel.style.display = 'block';

    setServerLoading(true);
    hideServerError();

    await loadAllProviderStreams(id, num);
};

let globalTimestamps = { intro: null, outro: null };

function renderIntroOutroSegments() {
    const container = document.getElementById('kv-segments');
    const vid = document.querySelector('.kv-player video');
    if (!container || !vid) return;
    const dur = vid.duration;
    if (!dur || !isFinite(dur)) { container.innerHTML = ''; return; }
    const parts = [];
    const mk = (cls, start, end) => {
        const s = Math.max(0, Math.min(dur, start));
        const e = Math.max(s, Math.min(dur, end));
        if (e <= s) return '';
        const left = (s / dur) * 100;
        const width = ((e - s) / dur) * 100;
        return `<span class="kv-segment ${cls}" style="left:${left}%;width:${width}%"></span>`;
    };
    if (globalTimestamps.intro && globalTimestamps.intro.end > globalTimestamps.intro.start) {
        parts.push(mk('kv-segment-intro', globalTimestamps.intro.start, globalTimestamps.intro.end));
    }
    if (globalTimestamps.outro && globalTimestamps.outro.end > globalTimestamps.outro.start) {
        parts.push(mk('kv-segment-outro', globalTimestamps.outro.start, globalTimestamps.outro.end));
    }
    container.innerHTML = parts.join('');
}

async function loadAllProviderStreams(episodeId, epNum) {
    const eps = episodeData[currentAudio] || [];
    const ep = eps.find(e => e.number == epNum);
    if (!ep) {
        setServerLoading(false);
        showServerError('Episode not found.');
        return;
    }

    const providerEpIds = buildProviderEpIdMap(epNum);

    globalTimestamps = { intro: null, outro: null };
    streamsByProvider = {};

    const loadToken = ++_providerLoadToken;
    let firstActivated = false;

    const isM3U8 = url => /\.m3u8?(\?|$)/i.test(url);

    const ingest = (provKey, streams, subtitles, download) => {
        if (loadToken !== _providerLoadToken) return;
        if (!streams || !streams.length) return;

        const hls = streams.filter(s => s.url && (s.type === 'hls' || s.type === 'mp4' || (s.type === 'embed' && isM3U8(s.url))));
        const embed = HLS_ONLY_PROVIDERS.has(provKey)
            ? []
            : streams.filter(s => s.url && s.type === 'embed' && !isM3U8(s.url) && provKey !== 'zoro' && provKey !== 'arc');

        if (!(hls.length || embed.length)) return;

        streamsByProvider[provKey] = { hls, embed, subtitles: subtitles || [], download: download || null };

        renderServerButtons();

        if (_userPickedServer) return;

        const _pref = localStorage.getItem('kv_default_server') || '';
        if (_pref) {
            let _prefProv, _prefType;
            if (_pref.endsWith('-embed')) { _prefProv = _pref.slice(0, -6); _prefType = 'embed'; }
            else if (_pref.endsWith('-hls')) { _prefProv = _pref.slice(0, -4); _prefType = 'hls'; }
            else { _prefProv = _pref; _prefType = 'hls'; }
            if (streamsByProvider[_prefProv]?.[_prefType]?.length && activeServerKey !== `${_prefProv}-${_prefType}`) {
                firstActivated = true;
                setServerLoading(false);
                activateServer(`${_prefProv}-${_prefType}`);
            }
            return;
        }

        const kiwiHls = streamsByProvider.kiwi?.hls?.length;
        if (kiwiHls && activeServerKey !== 'kiwi-hls') {
            firstActivated = true;
            setServerLoading(false);
            activateServer('kiwi-hls');
            return;
        }

        if (!firstActivated && hls.length) {
            firstActivated = true;
            setServerLoading(false);
            activateServer(`${provKey}-hls`);
        }
    };

    const existingPromises = Object.entries(providerEpIds).map(async ([provKey, epId]) => {
        try {
            const watchKey = WATCH_PROVIDER_ALIAS[provKey] || provKey;
            const data = await Kurovexa.watch(watchKey, animeId, currentAudio, epId);
            if (loadToken !== _providerLoadToken) return;
            const normalized = normalizeWatchPayload(data);

            if (data.intro && data.intro.start !== undefined) {
                globalTimestamps.intro = { start: data.intro.start, end: data.intro.end };
            }
            if (data.outro && data.outro.start !== undefined) {
                globalTimestamps.outro = { start: data.outro.start, end: data.outro.end };
            }
            renderIntroOutroSegments();

            ingest(provKey, normalized.streams, normalized.subtitles, normalized.download);
        } catch {  }
    });

    const pulsarAniListId = animeData?.id || animeId;
    const pulsarLang = currentAudio === 'dub' ? 'dub' : 'sub';
    const megaUrl = pulsarAniListId && epNum
        ? `https://megaplay.buzz/stream/ani/${pulsarAniListId}/${epNum}/${pulsarLang}`
        : null;
    if (megaUrl) {
        ingest('pulsar', [{ url: megaUrl, type: 'embed' }], []);
    }

    await Promise.allSettled(existingPromises);

    if (loadToken !== _providerLoadToken) return;

    setServerLoading(false);

    if (!firstActivated) {
        let pickKey = null;
        if (localStorage.getItem('kv_default_server')) {
            const _p = localStorage.getItem('kv_default_server');
            let _pProv, _pType;
            if (_p.endsWith('-embed')) { _pProv = _p.slice(0, -6); _pType = 'embed'; }
            else if (_p.endsWith('-hls')) { _pProv = _p.slice(0, -4); _pType = 'hls'; }
            else { _pProv = _p; _pType = 'hls'; }
            if (streamsByProvider[_pProv]?.[_pType]?.length) pickKey = `${_pProv}-${_pType}`;
        } else if (streamsByProvider.kiwi?.hls?.length) {
            pickKey = 'kiwi-hls';
        } else {
            for (const pk of PROVIDER_ORDER) {
                if (streamsByProvider[pk]?.hls?.length) { pickKey = `${pk}-hls`; break; }
            }
            if (!pickKey) {
                for (const pk of PROVIDER_ORDER) {
                    if (streamsByProvider[pk]?.embed?.length) { pickKey = `${pk}-embed`; break; }
                }
            }
        }
        if (pickKey) {
            firstActivated = true;
            activateServer(pickKey);
        }
    }

    if (!firstActivated && !Object.keys(streamsByProvider).length) {
        showServerError('No playable streams found. Try another episode or come back later.');
        setPlayerError();
    }
}

function getOrderedServerList() {
    const list = [];

    for (const pk of PROVIDER_ORDER) {
        if (streamsByProvider[pk]?.hls?.length) list.push(`${pk}-hls`);
    }

    for (const pk of PROVIDER_ORDER) {
        if (streamsByProvider[pk]?.embed?.length) list.push(`${pk}-embed`);
    }
    return list;
}

let _lastPlaybackProbe = { t: 0, ct: -1 };
function isPlaybackHealthy() {
    const vid = document.getElementById('hls-video');
    if (!vid) return false;
    if (vid.paused || vid.ended) return false;
    if (vid.readyState < 3) return false;
    if (!(vid.currentTime > 0)) return false;

    const now = Date.now();
    const moved = vid.currentTime !== _lastPlaybackProbe.ct;
    const fresh = now - _lastPlaybackProbe.t < 1500;
    _lastPlaybackProbe = { t: now, ct: vid.currentTime };

    if (!fresh) return true;
    return moved;
}

let _fallbackTimer = null;
function tryNextServer(failedKey) {

    if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }

    const ordered = getOrderedServerList();
    const currentIdx = ordered.indexOf(failedKey);
    const nextKey = ordered[currentIdx + 1];

    if (!nextKey) {
        setPlayerError();
        return;
    }

    activeServerKey = nextKey;

    const nextName = (() => {
        const [pk, type] = nextKey.split('-');
        return `${PROVIDER_NAMES[pk] || pk} (${type.toUpperCase()})`;
    })();

    const playerArea = $('#player-area');
    if (!playerArea) { activateServer(nextKey); return; }

    let secs = 3;
    const showCountdown = () => {
        playerArea.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                         width:100%;height:100%;background:#0d0d0d;gap:14px;">
                <div class="player-spinner"></div>
                <span style="color:#94a3b8;font-size:0.88rem;">
                    Server failed. Trying <strong style="color:#c4b5fd;">${nextName}</strong> in <span id="fallback-count">${secs}</span>s…
                </span>
                <button onclick="clearTimeout(window._fbTimer);activateServer('${nextKey}');"
                    style="background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.4);color:#c4b5fd;
                           padding:5px 18px;border-radius:999px;font-size:0.8rem;cursor:pointer;font-family:inherit;">
                    Switch now
                </button>
            </div>`;
    };
    showCountdown();

    const tick = () => {
        secs--;
        const el = document.getElementById('fallback-count');
        if (el) el.textContent = secs;
        if (secs <= 0) {
            activateServer(nextKey);
        } else {
            window._fbTimer = setTimeout(tick, 1000);
        }
    };
    window._fbTimer = setTimeout(tick, 1000);
}

function buildProviderEpIdMap(epNum) {

    const map = {};
    const rawProviders = window._rawProviders || {};
    for (const provKey of PROVIDER_ORDER) {
        const sourceKey = rawProviders[provKey] ? provKey : (WATCH_PROVIDER_ALIAS[provKey] || provKey);
        const pData = rawProviders[sourceKey];
        if (!pData) continue;
        const eps = pData.episodes?.[currentAudio] || [];
        const ep = eps.find(e => e.number == epNum);
        if (ep && ep.id) {

            const rawId = ep.id.split('/').pop();
            map[provKey] = rawId;
        }
    }
    return map;
}

function normalizeWatchPayload(data) {
    if (!data || typeof data !== 'object') {
        return { streams: [], subtitles: [], download: null };
    }

    const nested = data.ssub || data.sub || data.dub || data.result || data.data || null;
    const payload = nested && typeof nested === 'object' ? nested : data;

    return {
        streams: payload.streams || data.streams || [],
        subtitles: payload.subtitles || data.subtitles || [],
        download: payload.download || data.download || null,
    };
}

function renderServerButtons() {
    const internalRow = $('#internal-servers');
    const externalRow = $('#external-servers');
    const groupInternal = $('#server-group-internal');
    const groupExternal = $('#server-group-external');
    const hint = $('#server-hint');

    if (!internalRow || !externalRow) return;

    const prevInternalToggle = document.querySelector('.server-group-toggle[data-group="internal"]');
    const prevExternalToggle = document.querySelector('.server-group-toggle[data-group="external"]');
    const prevInternalOpen = prevInternalToggle?.getAttribute('aria-expanded') === 'true';
    const prevExternalOpen = prevExternalToggle?.getAttribute('aria-expanded') === 'true';

    internalRow.innerHTML = '';
    externalRow.innerHTML = '';

    let internalCount = 0;
    let externalCount = 0;

    for (const provKey of PROVIDER_ORDER) {
        const pStreams = streamsByProvider[provKey];
        if (!pStreams) continue;
        const displayName = PROVIDER_NAMES[provKey] || provKey;

        if (pStreams.hls?.length) {
            internalCount++;
            const btn = document.createElement('button');
            btn.className = 'server-btn';
            btn.dataset.server = `${provKey}-hls`;
            btn.innerHTML = `${displayName}<span class="server-btn-tag">HLS</span>`;
            btn.onclick = () => { _userPickedServer = true; activateServer(`${provKey}-hls`); };
            if (activeServerKey === `${provKey}-hls`) btn.classList.add('active');
            internalRow.appendChild(btn);
        }
        if (pStreams.embed?.length) {
            externalCount++;
            const btn = document.createElement('button');
            btn.className = 'server-btn';
            btn.dataset.server = `${provKey}-embed`;
            btn.innerHTML = `${displayName}<span class="server-btn-tag server-btn-tag--embed">Embed</span>`;
            btn.onclick = () => { _userPickedServer = true; activateServer(`${provKey}-embed`); };
            if (activeServerKey === `${provKey}-embed`) btn.classList.add('active');
            externalRow.appendChild(btn);
        }
    }

    if (groupInternal) groupInternal.style.display = internalCount ? '' : 'none';
    if (groupExternal) groupExternal.style.display = externalCount ? '' : 'none';
    if (hint) hint.style.display = (internalCount || externalCount) ? '' : 'none';

    const ic = $('#sg-count-internal');
    const ec = $('#sg-count-external');
    if (ic) ic.textContent = internalCount ? `${internalCount}` : '';
    if (ec) ec.textContent = externalCount ? `${externalCount}` : '';

    $$('.server-group-toggle').forEach(toggle => {
        toggle.onclick = () => {
            const group = toggle.dataset.group;
            const row = group === 'internal' ? internalRow : externalRow;
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            setGroupExpanded(group, !expanded);
        };
    });

    if (activeServerKey) {
        setGroupExpanded('internal', prevInternalOpen);
        setGroupExpanded('external', prevExternalOpen);
    } else {
        setGroupExpanded('internal', false);
        setGroupExpanded('external', false);
    }

    updateDownloadButton();
}

function setGroupExpanded(group, expanded) {
    const toggle = document.querySelector(`.server-group-toggle[data-group="${group}"]`);
    const row = document.getElementById(group === 'internal' ? 'internal-servers' : 'external-servers');
    if (!toggle || !row) return;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    row.classList.toggle('is-open', expanded);
}

function updateDownloadButton() {
    let dlWrap = document.getElementById('kv-download-wrap');
    if (!dlWrap) {
        dlWrap = document.createElement('div');
        dlWrap.id = 'kv-download-wrap';
        dlWrap.style.cssText = 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;';
        const panel = $('#server-panel');
        if (panel) panel.appendChild(dlWrap);
    }
    dlWrap.innerHTML = '';

    let hasAny = false;
    for (const provKey of PROVIDER_ORDER) {
        const pData = streamsByProvider[provKey];
        if (!pData?.download) continue;
        const name = PROVIDER_NAMES[provKey] || provKey;
        hasAny = true;
        const a = document.createElement('a');
        a.href = pData.download;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:0.78rem;font-weight:600;text-decoration:none;color:#c4b5fd;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);transition:all 0.2s;font-family:inherit;';
        a.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download (${name})`;
        a.onmouseenter = () => { a.style.background = 'rgba(124,58,237,0.22)'; a.style.borderColor = 'rgba(124,58,237,0.6)'; };
        a.onmouseleave = () => { a.style.background = 'rgba(124,58,237,0.12)'; a.style.borderColor = 'rgba(124,58,237,0.3)'; };
        dlWrap.appendChild(a);
    }

    dlWrap.style.display = hasAny ? 'flex' : 'none';
}

function activateServer(serverKey) {

    if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }
    if (window._fbTimer) { clearTimeout(window._fbTimer); window._fbTimer = null; }

    activeServerKey = serverKey;

    $$('.server-btn').forEach(b => b.classList.toggle('active', b.dataset.server === serverKey));

    const activeGroup = serverKey.endsWith('-hls') ? 'internal' : 'external';
    setGroupExpanded(activeGroup, true);

    const [provKey, type] = serverKey.split('-');
    const pStreams = streamsByProvider[provKey];
    if (!pStreams) return;

    const streams = type === 'hls' ? pStreams.hls : pStreams.embed;
    if (!streams?.length) return;

    _currentSubtitles = pStreams.subtitles || [];
    _currentSubReferer = pStreams.hls?.[0]?.referer || pStreams.embed?.[0]?.referer || null;

    _vttCues = [];
    _vttSubVisible = true;
    const _overlayNow = document.getElementById('kv-subtitle-overlay');
    if (_overlayNow) _overlayNow.innerHTML = '';
    const _captBtnNow = document.getElementById('kv-sett-captions-btn');
    const _subStyleBtnNow = document.getElementById('kv-sett-sub-style-btn');
    const _captOptsNow = document.getElementById('kv-captions-opts');
    const _curCaptLabelNow = document.getElementById('kv-sett-cur-captions');
    if (!_currentSubtitles.length) {
        if (_captBtnNow) _captBtnNow.style.display = 'none';
        if (_subStyleBtnNow) _subStyleBtnNow.style.display = 'none';
        if (_captOptsNow) _captOptsNow.innerHTML = '';
        if (_curCaptLabelNow) _curCaptLabelNow.textContent = 'Off';
    }

    const qualityWrap = $('#quality-wrap');
    if (qualityWrap) qualityWrap.style.display = 'none';

    playCurrentServer();
}

function _vttTimeSec(s) {
    if (!s) return null;
    const p = s.trim().split(':').map(Number);
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return null;
}

function _parseVtt(text) {
    const cues = [];
    const blocks = (text || '').replace(/\r\n?/g, '\n').split(/\n\n+/);
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        const tIdx = lines.findIndex(l => l.includes('-->'));
        if (tIdx < 0) continue;
        const arrow = lines[tIdx];
        const [startStr, endPart] = arrow.split('-->');
        const endStr = (endPart || '').trim().split(' ')[0];
        const start = _vttTimeSec(startStr);
        const end = _vttTimeSec(endStr);
        if (start === null || end === null) continue;
        const rawText = lines.slice(tIdx + 1).join('\n').trim();
        const clean = rawText
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
        if (clean) cues.push({ start, end, text: clean });
    }
    return cues;
}

async function _loadVttCues(url) {
    try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) return [];
        return _parseVtt(await res.text());
    } catch { return []; }
}

function _applySubOverlaySettings() {
    const overlay = document.getElementById('kv-subtitle-overlay');
    if (!overlay) return;
    overlay.style.fontSize = (_subSettings.size / 100 * 1.1) + 'rem';
    overlay.style.left = _subSettings.x + '%';
    overlay.style.bottom = _subSettings.yBottom + '%';
    overlay.style.transform = 'translateX(-50%)';
}

function _updateSubtitleOverlay(currentTime) {
    const overlay = document.getElementById('kv-subtitle-overlay');
    if (!overlay) return;
    if (!_vttSubVisible || !_vttCues.length) {
        overlay.innerHTML = '';
        return;
    }
    const cue = _vttCues.find(c => currentTime >= c.start && currentTime <= c.end);
    overlay.innerHTML = cue ? cue.text.replace(/\n/g, '<br>') : '';
}

async function applySubtitles(subtitles) {
    const myToken = ++_applySubToken;

    _vttCues = [];
    _vttSubVisible = true;
    const overlay = document.getElementById('kv-subtitle-overlay');
    if (overlay) { overlay.innerHTML = ''; _applySubOverlaySettings(); }

    const captBtn = document.getElementById('kv-sett-captions-btn');
    const captOptsEl = document.getElementById('kv-captions-opts');
    const curCaptLabel = document.getElementById('kv-sett-cur-captions');
    const subStyleBtn = document.getElementById('kv-sett-sub-style-btn');

    if (!captBtn || !captOptsEl) return;

    const _activeProv = (activeServerKey || '').split('-')[0];
    if (_HARDCODED_SUB_PROVIDERS.has(_activeProv)) {
        captBtn.style.display = 'none';
        if (subStyleBtn) subStyleBtn.style.display = 'none';
        if (captOptsEl) captOptsEl.innerHTML = '';
        if (curCaptLabel) curCaptLabel.textContent = 'Off';
        return;
    }

    if (!subtitles || !subtitles.length) {
        captBtn.style.display = 'none';
        if (subStyleBtn) subStyleBtn.style.display = 'none';
        return;
    }
    captBtn.style.display = '';
    if (subStyleBtn) subStyleBtn.style.display = '';

    const processedSubs = subtitles.map(sub => ({ ...sub }));

    if (myToken !== _applySubToken) return;

    const freshCaptBtn = document.getElementById('kv-sett-captions-btn');
    const freshCaptOptsEl = document.getElementById('kv-captions-opts');
    const freshCurCaptLabel = document.getElementById('kv-sett-cur-captions');
    const freshSubStyleBtn = document.getElementById('kv-sett-sub-style-btn');
    const freshOverlay = document.getElementById('kv-subtitle-overlay');

    if (!freshCaptBtn || !freshCaptOptsEl) return;

    const freshActiveProv = (activeServerKey || '').split('-')[0];
    if (_HARDCODED_SUB_PROVIDERS.has(freshActiveProv)) {
        freshCaptBtn.style.display = 'none';
        if (freshSubStyleBtn) freshSubStyleBtn.style.display = 'none';
        freshCaptOptsEl.innerHTML = '';
        if (freshCurCaptLabel) freshCurCaptLabel.textContent = 'Off';
        return;
    }

    const defaultIdx = (() => {
        let i = processedSubs.findIndex(s => s.default);
        if (i >= 0) return i;
        i = processedSubs.findIndex(s => s.language === 'en' || (s.label || '').toLowerCase().includes('english'));
        return i >= 0 ? i : 0;
    })();

    freshCaptOptsEl.innerHTML = [
        `<button class="kv-opt" data-idx="-1">Off</button>`,
        ...processedSubs.map((sub, i) => {
            const label = sub.label || sub.language || `Track ${i + 1}`;
            return `<button class="kv-opt${i === defaultIdx ? ' active' : ''}" data-idx="${i}">${label}</button>`;
        })
    ].join('');

    async function selectSubtrack(idx) {
        freshCaptOptsEl.querySelectorAll('.kv-opt').forEach(b => b.classList.toggle('active', parseInt(b.dataset.idx) === idx));
        if (freshCurCaptLabel) freshCurCaptLabel.textContent = idx === -1 ? 'Off' : (processedSubs[idx]?.label || 'On');
        if (idx === -1) {
            _vttCues = [];
            _vttSubVisible = false;
            if (freshOverlay) freshOverlay.innerHTML = '';
            return;
        }
        _vttSubVisible = true;
        const sub = processedSubs[idx];
        if (!sub?.file) return;
        _vttCues = await _loadVttCues(sub.file);
    }

    if (defaultIdx >= 0) {
        selectSubtrack(defaultIdx);
        if (freshCurCaptLabel) freshCurCaptLabel.textContent = processedSubs[defaultIdx]?.label || 'On';
    }

    freshCaptOptsEl.querySelectorAll('.kv-opt').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = parseInt(btn.dataset.idx);
            await selectSubtrack(idx);
            const cm = document.getElementById('kv-sett-captions');
            const mm = document.getElementById('kv-sett-main');
            if (cm) cm.style.display = 'none';
            if (mm) mm.style.display = '';
        });
    });
}

function playCurrentServer() {
    if (!activeServerKey) return;
    const [provKey, type] = activeServerKey.split('-');
    const pStreams = streamsByProvider[provKey];
    if (!pStreams) return;

    const streams = type === 'hls' ? pStreams.hls : pStreams.embed;
    if (!streams?.length) return;

    if (type === 'hls') {
        const stream = activeQuality
            ? (streams.find(s => s.quality === activeQuality) || streams[0])
            : streams[0];
        const url = stream.url;

        if (/\.mpd(\?|$)/i.test(url)) {
            playDASH(url, stream.referer || null, streams);
        } else if (/\.m3u8?(\?|$)/i.test(url)) {
            playHLS(url, streams);
        } else {
            playProgressive(url, stream.referer || null);
        }
    } else {
        const stream = streams[0];
        playEmbed(stream.url);
    }
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
let playerCtrlTimer = null;

function fmt(s) {
    s = Math.floor(s || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${m}:${String(sec).padStart(2, '0')}`;
}

function buildCustomPlayer(playerArea, video) {

    playerArea.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'kv-player';
    shell.appendChild(video);

    shell.insertAdjacentHTML('beforeend', `
    <div class="kv-subtitle-overlay" id="kv-subtitle-overlay"></div>
    <div class="kv-overlay" id="kv-overlay"></div>
    <div class="kv-buffering" id="kv-buffering">
        <div class="kv-spinner"></div>
    </div>
    <div class="kv-pause-indicator" id="kv-pause-icon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5h2v14H8zm6 0h2v14h-2z"/></svg>
    </div>
    <button class="kv-skip-btn" id="kv-skip-btn" style="display:none">Skip</button>
    <div class="kv-controls" id="kv-controls">
        <div class="kv-progress-wrap" id="kv-progress-wrap">
            <div class="kv-buffer" id="kv-buffer"></div>
            <div class="kv-segments" id="kv-segments" aria-hidden="true"></div>
            <div class="kv-played" id="kv-played"></div>
            <input class="kv-seek" id="kv-seek" type="range" min="0" max="100" step="0.01" value="0">
            <div class="kv-tooltip" id="kv-tooltip">0:00</div>
        </div>
        <div class="kv-bar">
            <div class="kv-bar-left">
                <button class="kv-btn kv-skip-10" id="kv-back-10" title="Backward 10s">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><path d="M12.39 15.54L10.91 16l-2.03-5.45 1.48-.46 1.15 3.08 1.48-.46 1.15 3.08-1.75.55z" style="display:none"/></svg>
                    <span class="kv-skip-label">10</span>
                </button>
                <button class="kv-btn" id="kv-play" title="Play/Pause">
                    <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l11 7-11 7z"/></svg>
                    <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
                </button>
                <button class="kv-btn kv-skip-10" id="kv-fwd-10" title="Forward 10s">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><path d="M10.74 15.54l1.48-.46 1.15 3.08-1.48.46-1.15-3.08z" style="display:none"/></svg>
                    <span class="kv-skip-label">10</span>
                </button>
                <button class="kv-btn" id="kv-mute" title="Mute">
                    <svg class="icon-vol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                    <svg class="icon-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                </button>
                <input class="kv-vol" id="kv-vol" type="range" min="0" max="1" step="0.01" value="1">
                <span class="kv-time" id="kv-time">0:00 / 0:00</span>
            </div>
            <div class="kv-bar-right">
                <button class="kv-btn" id="kv-portrait" title="Portrait Mode">
                    <svg viewBox="0 0 200 200" style="width:20px;height:20px;transform:none;"><path d="M40 70 A70 70 0 0 1 120 30" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><polygon points="120,30 110,32 118,40" fill="currentColor"/><path d="M160 130 A70 70 0 0 1 80 170" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><polygon points="80,170 90,168 82,160" fill="currentColor"/><g transform="rotate(-35 100 100)"><rect x="70" y="60" width="60" height="80" rx="6" fill="currentColor" opacity="0.6"/><path d="M70 120 Q100 90 130 110 L130 140 L70 140 Z" fill="currentColor"/></g></svg>
                </button>
                <button class="kv-btn" id="kv-settings-btn" title="Settings">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                <button class="kv-btn" id="kv-fs" title="Fullscreen">
                    <svg class="icon-fs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                    <svg class="icon-exit-fs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
                </button>
            </div>
        </div>
    </div>
    <div class="kv-settings" id="kv-settings" style="display:none">
        <div id="kv-sett-main">
            <div class="kv-sett-item" id="kv-sett-quality-btn">
                <div class="kv-sett-item-left">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    <span>Quality</span>
                </div>
                <div class="kv-sett-item-right">
                    <span id="kv-sett-cur-qual">Auto</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
                </div>
            </div>
            <div class="kv-sett-item" id="kv-sett-speed-btn">
                <div class="kv-sett-item-left">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                    <span>Speed</span>
                </div>
                <div class="kv-sett-item-right">
                    <span id="kv-sett-cur-speed">1x</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
                </div>
            </div>
            <div class="kv-sett-item" id="kv-sett-captions-btn" style="display:none">
                <div class="kv-sett-item-left">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 12h4M7 16h8M13 12h4"/></svg>
                    <span>Captions</span>
                </div>
                <div class="kv-sett-item-right">
                    <span id="kv-sett-cur-captions">Off</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
                </div>
            </div>
            <div class="kv-sett-item" id="kv-sett-sub-style-btn" style="display:none">
                <div class="kv-sett-item-left">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16" stroke-linecap="round"/></svg>
                    <span>Subtitle Style</span>
                </div>
                <div class="kv-sett-item-right">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
                </div>
            </div>
        </div>

        <div id="kv-sett-quality" style="display:none">
            <div class="kv-sett-back" id="kv-sett-qual-back">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                <span>Quality</span>
            </div>
            <div class="kv-settings-options" id="kv-quality-opts"></div>
        </div>

        <div id="kv-sett-speed" style="display:none">
            <div class="kv-sett-back" id="kv-sett-speed-back">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                <span>Speed</span>
            </div>
            <div class="kv-settings-options" id="kv-speed-opts"></div>
        </div>

        <div id="kv-sett-captions" style="display:none">
            <div class="kv-sett-back" id="kv-sett-captions-back">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                <span>Captions</span>
            </div>
            <div class="kv-settings-options" id="kv-captions-opts"></div>
        </div>

        <div id="kv-sett-sub-style" style="display:none">
            <div class="kv-sett-back" id="kv-sett-sub-style-back">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                <span>Subtitle Style</span>
            </div>
            <div class="kv-sett-sliders">
                <div class="kv-sett-slider-row">
                    <div class="kv-sett-slider-label"><span>Size</span><span id="kv-sub-size-val">100%</span></div>
                    <input type="range" class="kv-sett-slider" id="kv-sub-size" min="50" max="200" step="5" value="100">
                </div>
                <div class="kv-sett-slider-row">
                    <div class="kv-sett-slider-label"><span>Horizontal</span><span id="kv-sub-x-val">Center</span></div>
                    <input type="range" class="kv-sett-slider" id="kv-sub-x" min="5" max="95" step="1" value="50">
                </div>
                <div class="kv-sett-slider-row">
                    <div class="kv-sett-slider-label"><span>Vertical</span><span id="kv-sub-y-val">12%</span></div>
                    <input type="range" class="kv-sett-slider" id="kv-sub-y" min="2" max="90" step="1" value="12">
                </div>
            </div>
        </div>
    </div>`);

    playerArea.appendChild(shell);

    const vid = shell.querySelector('video') || video;
    attachPlayerControls(shell, vid);
}

function attachPlayerControls(shell, vid) {
    const get = id => shell.querySelector('#' + id) || document.getElementById(id);

    shell.classList.remove('kv-portrait');
    try { screen.orientation?.unlock(); } catch (_) {}

    applySubtitles(_currentSubtitles);

    const playBtn = get('kv-play');
    const muteBtn = get('kv-mute');
    const volSlider = get('kv-vol');
    const seekSlider = get('kv-seek');
    const timeEl = get('kv-time');
    const bufBar = get('kv-buffer');
    const playBar = get('kv-played');
    const tooltip = get('kv-tooltip');
    const settBtn = get('kv-settings-btn');
    const settPanel = get('kv-settings');
    const settMain = get('kv-sett-main');
    const settQual = get('kv-sett-quality');
    const settSpeed = get('kv-sett-speed');
    const settCaptions = get('kv-sett-captions');
    const settSubStyle = get('kv-sett-sub-style');
    const qualBtn = get('kv-sett-quality-btn');
    const speedBtn = get('kv-sett-speed-btn');
    const captionsBtn = get('kv-sett-captions-btn');
    const subStyleBtn = get('kv-sett-sub-style-btn');
    const qualBack = get('kv-sett-qual-back');
    const speedBack = get('kv-sett-speed-back');
    const captionsBack = get('kv-sett-captions-back');
    const subStyleBack = get('kv-sett-sub-style-back');
    const curQualLabel = get('kv-sett-cur-qual');
    const curSpeedLabel = get('kv-sett-cur-speed');

    const qualOpts = get('kv-quality-opts');
    const speedOpts = get('kv-speed-opts');
    const fsBtn = get('kv-fs');
    const controls = get('kv-controls');
    const pauseIcon = get('kv-pause-icon');
    const skipBtn = get('kv-skip-btn');
    const progressWrap = get('kv-progress-wrap');

    vid.addEventListener('loadedmetadata', renderIntroOutroSegments);
    vid.addEventListener('durationchange', renderIntroOutroSegments);
    if (vid.readyState >= 1) renderIntroOutroSegments();

    function showSettPage(page) {
        settMain.style.display = page === 'main' ? 'block' : 'none';
        settQual.style.display = page === 'quality' ? 'block' : 'none';
        settSpeed.style.display = page === 'speed' ? 'block' : 'none';
        if (settCaptions) settCaptions.style.display = page === 'captions' ? 'block' : 'none';
        if (settSubStyle) settSubStyle.style.display = page === 'sub-style' ? 'block' : 'none';
    }

    settBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isHidden = settPanel.style.display === 'none';
        if (isHidden) {
            showSettPage('main');
            settPanel.style.display = 'block';
        } else {
            settPanel.style.display = 'none';
        }
        if (typeof showControls === 'function') showControls();
    });

    qualBtn?.addEventListener('click', () => showSettPage('quality'));
    speedBtn?.addEventListener('click', () => showSettPage('speed'));
    captionsBtn?.addEventListener('click', () => showSettPage('captions'));
    subStyleBtn?.addEventListener('click', () => showSettPage('sub-style'));
    qualBack?.addEventListener('click', () => showSettPage('main'));
    speedBack?.addEventListener('click', () => showSettPage('main'));
    captionsBack?.addEventListener('click', () => showSettPage('main'));
    subStyleBack?.addEventListener('click', () => showSettPage('main'));

    const subSizeSlider = get('kv-sub-size');
    const subXSlider    = get('kv-sub-x');
    const subYSlider    = get('kv-sub-y');
    const subSizeVal    = get('kv-sub-size-val');
    const subXVal       = get('kv-sub-x-val');
    const subYVal       = get('kv-sub-y-val');

    if (subSizeSlider) subSizeSlider.value = _subSettings.size;
    if (subXSlider)    subXSlider.value    = _subSettings.x;
    if (subYSlider)    subYSlider.value    = _subSettings.yBottom;
    if (subSizeVal)    subSizeVal.textContent = _subSettings.size + '%';
    if (subXVal)       subXVal.textContent    = _subSettings.x === 50 ? 'Center' : (_subSettings.x < 50 ? 'Left' : 'Right');
    if (subYVal)       subYVal.textContent    = _subSettings.yBottom <= 10 ? 'Bottom' : (_subSettings.yBottom >= 80 ? 'Top' : _subSettings.yBottom + '%');

    subSizeSlider?.addEventListener('input', () => {
        _subSettings.size = parseInt(subSizeSlider.value);
        if (subSizeVal) subSizeVal.textContent = _subSettings.size + '%';
        _applySubOverlaySettings();
        _saveSubSettings();
    });
    subXSlider?.addEventListener('input', () => {
        _subSettings.x = parseInt(subXSlider.value);
        const v = _subSettings.x === 50 ? 'Center' : (_subSettings.x < 50 ? 'Left' : 'Right');
        if (subXVal) subXVal.textContent = v;
        _applySubOverlaySettings();
        _saveSubSettings();
    });
    subYSlider?.addEventListener('input', () => {
        _subSettings.yBottom = parseInt(subYSlider.value);
        const v = _subSettings.yBottom <= 10 ? 'Bottom' : (_subSettings.yBottom >= 80 ? 'Top' : _subSettings.yBottom + '%');
        if (subYVal) subYVal.textContent = v;
        _applySubOverlaySettings();
        _saveSubSettings();
    });

    document.addEventListener('click', (e) => {
        if (settPanel && !settPanel.contains(e.target) && !settBtn.contains(e.target)) {
            settPanel.style.display = 'none';
        }
    }, true);

    settPanel?.addEventListener('click', e => e.stopPropagation());

    const back10 = get('kv-back-10');
    const fwd10 = get('kv-fwd-10');

    back10?.addEventListener('click', (e) => {
        e.stopPropagation();
        vid.currentTime = Math.max(0, vid.currentTime - 10);
        if (typeof showControls === 'function') showControls();
    });

    fwd10?.addEventListener('click', (e) => {
        e.stopPropagation();
        vid.currentTime = Math.min(vid.duration, vid.currentTime + 10);
        if (typeof showControls === 'function') showControls();
    });

    let currentSkipTarget = null;
    let _autoSkipped = { intro: false, outro: false };
    vid.addEventListener('timeupdate', () => {
        if (!skipBtn) return;
        const cur = vid.currentTime;
        let foundSkip = false;

        if (globalTimestamps.intro && cur >= globalTimestamps.intro.start && cur <= globalTimestamps.intro.end) {
            skipBtn.textContent = 'Skip Intro';
            skipBtn.style.display = 'block';
            currentSkipTarget = globalTimestamps.intro.end;
            foundSkip = true;
            if (kvPrefs.get('kv_auto_skip') && !_autoSkipped.intro) {
                _autoSkipped.intro = true;
                vid.currentTime = globalTimestamps.intro.end;
                skipBtn.style.display = 'none';
            }
        }

        else if (globalTimestamps.outro && cur >= globalTimestamps.outro.start && cur <= globalTimestamps.outro.end) {
            skipBtn.textContent = 'Skip Outro';
            skipBtn.style.display = 'block';
            currentSkipTarget = globalTimestamps.outro.end;
            foundSkip = true;
            if (kvPrefs.get('kv_auto_skip') && !_autoSkipped.outro) {
                _autoSkipped.outro = true;
                vid.currentTime = globalTimestamps.outro.end;
                skipBtn.style.display = 'none';
            }
        }

        if (!foundSkip) {
            skipBtn.style.display = 'none';
            currentSkipTarget = null;
        }
    });

    skipBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentSkipTarget !== null) {
            vid.currentTime = currentSkipTarget;
            skipBtn.style.display = 'none';
        }
    });

    const portraitBtn = get('kv-portrait');
    portraitBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();

        const isPortrait = shell.classList.contains('kv-portrait');

        if (!isPortrait) {

            if (!document.fullscreenElement) {
                const req = shell.requestFullscreen || shell.webkitRequestFullscreen;
                if (req) {
                    try { await req.call(shell); } catch (err) { }
                }
            }
            shell.classList.add('kv-portrait');
            try { await screen.orientation?.lock('landscape'); } catch (err) { }
        } else {

            shell.classList.remove('kv-portrait');
            if (document.fullscreenElement) {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) {
                    try { await exit.call(document); } catch (err) { }
                }
            }
            try { screen.orientation?.unlock(); } catch (err) { }
        }
    });

    function syncPlay() {
        playBtn.querySelector('.icon-play').style.display = vid.paused ? '' : 'none';
        playBtn.querySelector('.icon-pause').style.display = vid.paused ? 'none' : '';
    }
    playBtn?.addEventListener('click', () => vid.paused ? vid.play() : vid.pause());
    vid.addEventListener('play', syncPlay);
    vid.addEventListener('pause', () => { syncPlay(); flashPause(pauseIcon); });

    const bufferingEl = get('kv-buffering');
    vid.addEventListener('waiting', () => { if (bufferingEl) bufferingEl.classList.add('active'); });
    vid.addEventListener('playing', () => { if (bufferingEl) bufferingEl.classList.remove('active'); });
    vid.addEventListener('canplay', () => { if (bufferingEl) bufferingEl.classList.remove('active'); });

    function flashPause(el) {
        if (!el) return;
        el.classList.remove('kv-flash');
        void el.offsetWidth;
        el.classList.add('kv-flash');
    }

    shell.querySelector('#kv-overlay')?.addEventListener('click', (e) => {
        const isMobile = window.innerWidth <= 1024 || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia("(any-pointer: coarse)").matches;

        if (isMobile) {
            const isHidden = controls?.classList.contains('kv-hidden');
            if (isHidden) {
                showControls();
            } else {
                controls?.classList.add('kv-hidden');
                shell.style.cursor = 'none';
                if (settPanel) settPanel.style.display = 'none';
            }
        } else {
            vid.paused ? vid.play() : vid.pause();
        }
    });

    volSlider?.addEventListener('input', () => {
        vid.volume = volSlider.value;
        vid.muted = volSlider.value == 0;
        syncMute();
    });
    muteBtn?.addEventListener('click', () => {
        vid.muted = !vid.muted;
        if (!vid.muted && vid.volume === 0) vid.volume = 0.5;
        if (volSlider) volSlider.value = vid.muted ? 0 : vid.volume;
        syncMute();
    });
    function syncMute() {
        const muted = vid.muted || vid.volume === 0;
        muteBtn?.querySelector('.icon-vol').style.setProperty('display', muted ? 'none' : '');
        muteBtn?.querySelector('.icon-muted').style.setProperty('display', muted ? '' : 'none');
        if (volSlider) {
            const pct = muted ? 0 : vid.volume * 100;
            volSlider.style.setProperty('--pct', pct + '%');
        }
    }

    const resumeKey = `kv_pos_${animeId}_${currentEpNum}`;
    let _saveTimer = null;

    function updateWatchHistory() {
        if (!vid.duration || vid.currentTime < 5) return;
        try {
            const history = JSON.parse(localStorage.getItem('kv_history') || '[]');
            const entry = {
                id: animeId,
                ep: currentEpNum,
                title: titleOf(animeData),
                epTitle: (episodeData[currentAudio]?.find(e => e.number == currentEpNum)?.title) || `Episode ${currentEpNum}`,
                image: (episodeData[currentAudio]?.find(e => e.number == currentEpNum)?.image) || animeData.coverImage?.large || '',
                pos: Math.floor(vid.currentTime),
                dur: Math.floor(vid.duration),
                time: Date.now()
            };

            const filtered = history.filter(item => item.id !== animeId);
            filtered.unshift(entry);

            localStorage.setItem('kv_history', JSON.stringify(filtered.slice(0, 20)));
        } catch (e) { console.error('History save error', e); }
    }

    let _alSynced = false;

    async function notifyTracking() {
        const token = localStorage.getItem('kv_token');
        if (!token || !currentEpNum) return;
        const epKey = `${animeId}:${currentEpNum}`;
        if (_lastEpToast === epKey) return;

        const mode = _trackingProfile?.tracking_mode || 'none';
        if (mode === 'none') return;

        const doAnilist = mode === 'anilist' || mode === 'both';
        const doMal     = mode === 'mal'     || mode === 'both';
        const mediaId   = parseInt(animeId);
        const malId     = animeData?.idMal;
        const authHdr   = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

        if (_notifiedAnimes.has(animeId)) {
            _lastEpToast = epKey;
            if (doAnilist && !isNaN(mediaId)) {
                fetch('/api/anilist/save', { method: 'POST', headers: authHdr,
                    body: JSON.stringify({ mediaId, status: 'CURRENT', progress: currentEpNum })
                }).catch(() => {});
            }
            if (doMal && malId) {
                fetch('/api/mal/save', { method: 'POST', headers: authHdr,
                    body: JSON.stringify({ animeId: malId, status: 'watching', progress: currentEpNum })
                }).catch(() => {});
            }
            const label = doAnilist && doMal ? 'AniList + MAL' : doMal ? 'MAL' : 'AniList';
            if (window.showToast) showToast(label, `Now tracking: Ep ${currentEpNum} · ${titleOf(animeData)}`);
            return;
        }

        try {
            if (isNaN(mediaId)) return;

            const fetches = [];
            if (doAnilist) fetches.push(
                fetch('/api/anilist/save', { method: 'POST', headers: authHdr,
                    body: JSON.stringify({ mediaId, status: 'CURRENT', progress: currentEpNum })
                }).then(r => r.json().then(d => ({ ok: r.ok, data: d }))).catch(() => null)
            );
            if (doMal && malId) fetches.push(
                fetch('/api/mal/save', { method: 'POST', headers: authHdr,
                    body: JSON.stringify({ animeId: malId, status: 'watching', progress: currentEpNum })
                }).then(r => r.json().then(d => ({ ok: r.ok, data: d, isMal: true }))).catch(() => null)
            );

            const results = await Promise.all(fetches);
            const alRes  = doAnilist ? results[0] : null;
            const malRes = doMal && malId ? results[doAnilist ? 1 : 0] : null;

            if (alRes?.ok || malRes?.ok) {
                _notifiedAnimes.add(animeId);
                _lastEpToast = epKey;
                if (window.showToast) {
                    const label = alRes?.ok && malRes?.ok ? 'AniList + MAL' : malRes?.ok ? 'MAL' : 'AniList';
                    const prevStatus = alRes?.data?.prev_status;
                    if (alRes?.ok && (alRes.data?.is_new || !prevStatus)) {
                        showToast(label, `Added: ${titleOf(animeData)}`);
                        setTimeout(() => showToast(label, `▶ Tracking Episode ${currentEpNum}`), 1800);
                    } else if (alRes?.ok && prevStatus === 'PLANNING') {
                        showToast(label, `Started Watching: ${titleOf(animeData)}`);
                        setTimeout(() => showToast(label, `▶ Tracking Episode ${currentEpNum}`), 1800);
                    } else {
                        showToast(label, `Now tracking: Ep ${currentEpNum} · ${titleOf(animeData)}`);
                    }
                }
            }
        } catch (e) { console.error('[Tracking Error]', e); }
    }

    vid.addEventListener('play', () => {
        notifyTracking();
        _alSynced = false;
        if (_firstPlaySaved) return;
        setTimeout(() => {
            if (vid.currentTime > 0) { updateWatchHistory(); _firstPlaySaved = true; }
        }, 1000);
    });
    async function syncTracking() {
        if (_alSynced) return;
        const token = localStorage.getItem('kv_token');
        if (!token) return;
        const mode = _trackingProfile?.tracking_mode || 'none';
        if (mode === 'none') return;

        const doAnilist = mode === 'anilist' || mode === 'both';
        const doMal     = mode === 'mal'     || mode === 'both';
        const mediaId   = parseInt(animeId);
        const malId     = animeData?.idMal;
        const authHdr   = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

        try {
            const fetches = [];
            if (doAnilist && !isNaN(mediaId)) fetches.push(
                fetch('/api/anilist/save', { method: 'POST', headers: authHdr,
                    body: JSON.stringify({ mediaId, progress: currentEpNum, status: 'CURRENT' })
                }).then(r => ({ ok: r.ok })).catch(() => null)
            );
            if (doMal && malId) fetches.push(
                fetch('/api/mal/save', { method: 'POST', headers: authHdr,
                    body: JSON.stringify({ animeId: malId, progress: currentEpNum, status: 'watching' })
                }).then(r => ({ ok: r.ok })).catch(() => null)
            );
            if (!fetches.length) return;
            const results = await Promise.all(fetches);
            if (results.some(r => r?.ok)) _alSynced = true;
        } catch (e) { console.error('[Sync Tracking Error]', e); }
    }

    vid.addEventListener('timeupdate', () => {
        _updateSubtitleOverlay(vid.currentTime);

        if (!vid.duration) return;
        const pct = (vid.currentTime / vid.duration) * 100;

        if (pct > 90 && !_alSynced) {
            syncTracking();
        }

        if (seekSlider) { seekSlider.value = pct; }
        if (progressWrap) { progressWrap.style.setProperty('--pct', pct + '%'); }
        if (playBar) playBar.style.width = pct + '%';
        if (timeEl) timeEl.textContent = `${fmt(vid.currentTime)} / ${fmt(vid.duration)}`;

        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            if (vid.currentTime > 3 && (vid.duration - vid.currentTime) > 5) {
                try {
                    localStorage.setItem(resumeKey, Math.floor(vid.currentTime));
                    updateWatchHistory();
                } catch { }
            }
        }, 3000);
    });

    vid.addEventListener('pause', () => {
        if (vid.currentTime > 3 && vid.duration && (vid.duration - vid.currentTime) > 5) {
            try {
                localStorage.setItem(resumeKey, Math.floor(vid.currentTime));
                updateWatchHistory();
            } catch { }
        }
    });

    vid.addEventListener('canplay', () => {
        try {
            const saved = parseInt(localStorage.getItem(resumeKey));
            if (saved > 5 && vid.duration && saved < vid.duration - 10) {
                vid.currentTime = saved;
            }
        } catch { }
    }, { once: true });

    vid.addEventListener('ended', () => {
        syncToAnilist();
        try {
            localStorage.removeItem(resumeKey);

            const history = JSON.parse(localStorage.getItem('kv_history') || '[]');
            const filtered = history.filter(item => item.id !== animeId);
            localStorage.setItem('kv_history', JSON.stringify(filtered));
        } catch { }
        if (kvPrefs.get('kv_auto_next')) goNextEpisode();
    });
    vid.addEventListener('progress', () => {
        if (!vid.duration || !bufBar) return;
        let buf = 0;
        for (let i = 0; i < vid.buffered.length; i++) {
            if (vid.buffered.start(i) <= vid.currentTime) buf = vid.buffered.end(i);
        }
        bufBar.style.width = ((buf / vid.duration) * 100) + '%';
    });

    seekSlider?.addEventListener('input', () => {
        if (vid.duration) vid.currentTime = (seekSlider.value / 100) * vid.duration;
        seekSlider.style.setProperty('--pct', seekSlider.value + '%');
    });

    progressWrap?.addEventListener('mousemove', e => {
        if (!vid.duration || !tooltip) return;
        const rect = progressWrap.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        tooltip.textContent = fmt(frac * vid.duration);
        tooltip.style.left = (frac * 100) + '%';
        tooltip.style.opacity = '1';
    });
    progressWrap?.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.opacity = '0'; });

    function showControls() {
        controls?.classList.remove('kv-hidden');
        shell.style.cursor = '';
        clearTimeout(playerCtrlTimer);
        if (!vid.paused) {
            playerCtrlTimer = setTimeout(() => {
                controls?.classList.add('kv-hidden');
                shell.style.cursor = 'none';
                if (settPanel) settPanel.style.display = 'none';
            }, 3000);
        }
    }

    let lastTouchTime = 0;
    shell.addEventListener('touchstart', () => { lastTouchTime = Date.now(); }, { passive: true });

    function showControlsOnMove() {

        if (Date.now() - lastTouchTime < 500) return;
        showControls();
    }

    shell.addEventListener('mousemove', showControlsOnMove);
    shell.addEventListener('mouseenter', showControlsOnMove);

    fsBtn?.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            if (shell.classList.contains('kv-portrait')) {
                shell.classList.remove('kv-portrait');
                try { screen.orientation?.unlock(); } catch (_) {}
            }
            shell.requestFullscreen?.() || shell.webkitRequestFullscreen?.();
        } else {
            document.exitFullscreen?.() || document.webkitExitFullscreen?.();
        }
    });
    document.addEventListener('fullscreenchange', () => {
        const isFull = !!document.fullscreenElement;
        if (!isFull && shell.classList.contains('kv-portrait')) {
            shell.classList.remove('kv-portrait');
            try { screen.orientation?.unlock(); } catch (_) {}
        }
        if (fsBtn) {
            fsBtn.querySelector('.icon-fs').style.display = isFull ? 'none' : '';
            fsBtn.querySelector('.icon-exit-fs').style.display = isFull ? '' : 'none';
        }
    });

    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === ' ' || e.key === 'k') { e.preventDefault(); vid.paused ? vid.play() : vid.pause(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); vid.currentTime = Math.min(vid.duration, vid.currentTime + 5); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); vid.currentTime = Math.max(0, vid.currentTime - 5); }
        if (e.key === 'm') { vid.muted = !vid.muted; syncMute(); }
        if (e.key === 'f') { fsBtn?.click(); }
    });

    if (speedOpts) {
        speedOpts.innerHTML = SPEEDS.map(s =>
            `<button class="kv-opt${s === 1 ? ' active' : ''}" data-speed="${s}">${s}x</button>`
        ).join('');
        speedOpts.addEventListener('click', e => {
            const btn = e.target.closest('.kv-opt[data-speed]');
            if (!btn) return;
            const speed = parseFloat(btn.dataset.speed);
            vid.playbackRate = speed;
            if (curSpeedLabel) curSpeedLabel.textContent = speed + 'x';
            speedOpts.querySelectorAll('.kv-opt').forEach(b => b.classList.toggle('active', b === btn));

            setTimeout(() => showSettPage('main'), 300);
        });
    }

    function buildQuality(levels, current, mode) {
        if (!qualOpts) return;

        if (!levels || levels.length <= 1) {
            if (qualBtn) qualBtn.style.display = 'none';
            return;
        }
        if (qualBtn) qualBtn.style.display = '';

        const fresh = qualOpts.cloneNode(false);
        qualOpts.parentNode.replaceChild(fresh, qualOpts);
        const selectedLabel = current || levels[0]?.label || 'Auto';
        if (curQualLabel) curQualLabel.textContent = selectedLabel;
        if (mode === 'url') activeQuality = selectedLabel;
        fresh.innerHTML = levels.map(l =>
            `<button class="kv-opt${l.label === current ? ' active' : ''}" data-label="${l.label}">${l.label}</button>`
        ).join('');
        fresh.addEventListener('click', e => {
            const btn = e.target.closest('.kv-opt[data-label]');
            if (!btn) return;
            const label = btn.dataset.label;
            activeQuality = label;
            if (curQualLabel) curQualLabel.textContent = label;
            fresh.querySelectorAll('.kv-opt').forEach(b => b.classList.toggle('active', b === btn));
            if (mode === 'url') {
                const target = levels.find(l => l.label === label);
                if (target?.url) playHLS(target.url, levels.map(x => ({ quality: x.label, url: x.url })));
            } else if (mode === 'level' && hlsInstance) {
                const lv = levels.find(l => l.label === label);
                if (lv != null) { hlsInstance.currentLevel = lv.idx; hlsInstance.loadLevel = lv.idx; }
            }
            setTimeout(() => showSettPage('main'), 300);
        });
    }
    shell._buildQuality = buildQuality;

    syncPlay();
    syncMute();
    if (volSlider) {
        volSlider.value = vid.muted ? 0 : vid.volume;
        volSlider.style.setProperty('--pct', (vid.muted ? 0 : vid.volume * 100) + '%');
    }
}

async function playHLS(rawUrl, allStreams = null) {
    const playerArea = $('#player-area');
    if (!playerArea) return;

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    const streamReferer = allStreams?.find(s => s.url === rawUrl)?.referer || null;
    const proxiedUrl = await proxyM3u8(rawUrl, streamReferer);

    const video = document.createElement('video');
    video.id = 'hls-video';
    video.crossOrigin = 'anonymous';
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'width:100%;height:100%;background:#000;display:block;';

    patchMSECodec();

    buildCustomPlayer(playerArea, video);

    const shell = playerArea.querySelector('.kv-player');
    const vid = playerArea.querySelector('#hls-video');
    if (!vid) return;

    if (Hls.isSupported()) {
        hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: false });

        hlsInstance.on(Hls.Events.ERROR, (e, d) => {
            if (d.fatal) {
                if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hlsInstance.swapAudioCodec();
                    hlsInstance.recoverMediaError();
                } else {
                    if (isPlaybackHealthy()) {
                        console.warn('[HLS] Fatal error reported but playback is healthy, ignoring:', d.type, d.details);
                        return;
                    }
                    console.warn('[HLS] Fatal error, trying next server:', d.type, d.details);
                    tryNextServer(activeServerKey);
                }
            }
        });

        vid.textTracks.addEventListener('addtrack', (evt) => {
            if (evt.track) evt.track.mode = 'disabled';
        });

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, (e, data) => {
            for (let i = 0; i < vid.textTracks.length; i++) {
                vid.textTracks[i].mode = 'disabled';
            }
            vid.play().catch(() => { });

            if (shell?._buildQuality) {
                if (allStreams && allStreams.length > 1 && allStreams.some(s => s.quality)) {
                    const currentQ = allStreams.find(s => s.url === rawUrl)?.quality || allStreams[0].quality;
                    shell._buildQuality(
                        allStreams.map(s => ({ label: s.quality || '?', url: s.url })),
                        currentQ,
                        'url'
                    );
                } else {
                    const activeProv = (activeServerKey || '').split('-')[0];
                    const seen = new Set();

                    if (data.levels.length > 1) {
                        const levelItems = data.levels
                            .map(l => {
                                const label = l.height ? `${l.height}p` : (l.name || 'Auto');
                                const url   = Array.isArray(l.url) ? l.url[0] : l.url;
                                return { label, url };
                            })
                            .filter(l => {
                                if (!l.url || seen.has(l.label)) return false;
                                seen.add(l.label);
                                return true;
                            });

                        if (levelItems.length > 1) {
                            const defaultQ = levelItems[levelItems.length - 1].label;
                            shell._buildQuality(levelItems, defaultQ, 'url');
                        }
                    } else {
                        const unique = data.levels
                            .map((l, i) => ({ idx: i, label: l.height ? `${l.height}p` : (l.name || `${i + 1}`) }))
                            .filter(l => { if (seen.has(l.label)) return false; seen.add(l.label); return true; });
                        const cur = unique.find(l => l.idx === hlsInstance.currentLevel)?.label
                            || unique.slice(-1)[0]?.label || '';
                        shell._buildQuality(unique, cur, 'level');
                    }
                }
            }
        });

        hlsInstance.loadSource(proxiedUrl);
        hlsInstance.attachMedia(vid);
    } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
        vid.src = proxiedUrl;
        vid.play().catch(() => { });
    } else {
        playerArea.innerHTML = `<div class="player-unsupported">HLS not supported in this browser.</div>`;
    }
}

async function playProgressive(rawUrl, referer) {
    const playerArea = $('#player-area');
    if (!playerArea) return;

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (dashInstance) { try { dashInstance.reset(); } catch { } dashInstance = null; }

    const proxiedUrl = await proxyM3u8(rawUrl, referer);

    const video = document.createElement('video');
    video.id = 'hls-video';
    video.crossOrigin = 'anonymous';
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.style.cssText = 'width:100%;height:100%;background:#000;display:block;';

    patchMSECodec();
    buildCustomPlayer(playerArea, video);

    const vid = playerArea.querySelector('#hls-video');
    if (!vid) return;

    vid.addEventListener('error', () => {
        const err = vid.error;
        if (isPlaybackHealthy()) {
            console.warn('[Progressive] video error reported but playback is healthy, ignoring:', err && err.code, err && err.message);
            return;
        }
        console.warn('[Progressive] video error', err && err.code, err && err.message);
        tryNextServer(activeServerKey);
    });

    vid.src = proxiedUrl;
    vid.play().catch(() => { });
}

let dashInstance = null;
async function playDASH(rawUrl, referer, allStreams = null) {
    const playerArea = $('#player-area');
    if (!playerArea) return;

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (dashInstance) { try { dashInstance.reset(); } catch { } dashInstance = null; }

    if (typeof dashjs === 'undefined') {

        console.warn('[DASH] dash.js not available, falling back');
        tryNextServer(activeServerKey);
        return;
    }

    const proxiedUrl = await proxyM3u8(rawUrl, referer);

    const video = document.createElement('video');
    video.id = 'hls-video';
    video.crossOrigin = 'anonymous';
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'width:100%;height:100%;background:#000;display:block;';

    patchMSECodec();
    buildCustomPlayer(playerArea, video);

    const shell = playerArea.querySelector('.kv-player');
    const vid = playerArea.querySelector('#hls-video');
    if (!vid) return;

    dashInstance = dashjs.MediaPlayer().create();
    dashInstance.updateSettings({
        streaming: {
            buffer: { fastSwitchEnabled: true },
            abr: { autoSwitchBitrate: { video: true, audio: true } },
        },
    });

    dashInstance.on(dashjs.MediaPlayer.events.ERROR, (ev) => {
        const err = ev?.error || ev;
        const fatal = err?.code && err.code !== 33;
        console.warn('[DASH] error', err);
        if (fatal) {
            if (isPlaybackHealthy()) {
                console.warn('[DASH] Fatal error reported but playback is healthy, ignoring');
                return;
            }
            tryNextServer(activeServerKey);
        }
    });

    dashInstance.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
        vid.play().catch(() => { });

        if (shell?._buildQuality && dashInstance) {
            try {
                const tracks = dashInstance.getBitrateInfoListFor('video') || [];
                if (tracks.length > 1) {
                    const seen = new Set();
                    const unique = tracks
                        .map((t, i) => ({ idx: i, label: t.height ? `${t.height}p` : `${Math.round((t.bitrate || 0) / 1000)}k` }))
                        .filter(l => { if (seen.has(l.label)) return false; seen.add(l.label); return true; });
                    const cur = unique.slice(-1)[0]?.label || '';
                    shell._buildQuality(unique, cur, 'level');
                }
            } catch (e) {  }
        }
    });

    dashInstance.initialize(vid, proxiedUrl, true);
}

function playEmbed(url) {
    const playerArea = $('#player-area');
    if (!playerArea) return;

    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

    const isGogo = url.includes('gogoanime');

    const isAdHeavy = /megaplay\.buzz|vidwish/i.test(url);
    let sandboxAttr = '';
    if (isAdHeavy) {
        sandboxAttr = 'sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-orientation-lock allow-presentation"';
    } else if (isGogo) {
        sandboxAttr = 'sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-orientation-lock"';
    }

    playerArea.innerHTML = `
        <div style="position:relative;width:100%;height:100%;background:#000;">
            <iframe
                id="embed-frame"
                src="${url}"
                allowfullscreen
                allow="autoplay; fullscreen; picture-in-picture"
                referrerpolicy="origin"
                ${sandboxAttr}
                style="width:100%;height:100%;border:none;display:block;"
                onerror="document.getElementById('embed-error')?.style.setProperty('display','flex')">
            </iframe>
            <div id="embed-error" style="display:none;position:absolute;inset:0;background:#0d0d0d;flex-direction:column;align-items:center;justify-content:center;gap:14px;">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                <span style="color:#94a3b8;font-size:0.9rem;">This embed can't be displayed here.</span>
                <a href="${url}" target="_blank" rel="noopener"
                   style="color:#7c3aed;font-weight:600;font-size:0.85rem;text-decoration:none;border:1px solid rgba(124,58,237,0.4);padding:6px 18px;border-radius:999px;">
                    ↗ Open in new tab
                </a>
            </div>
        </div>`;
}

function setPlayerLoading() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    const playerArea = $('#player-area');
    if (!playerArea) return;

    const eps = episodeData?.[currentAudio] || [];
    const ep = eps.find(e => e.id === currentEpId || e.number === currentEpNum);
    const bgImage = ep?.image || animeData?.bannerImage || animeData?.coverImage?.large || '';

    playerArea.innerHTML = `
        <div style="position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;">
            ${bgImage ? `<img src="${bgImage}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.4;filter:blur(4px);" alt="Loading">` : ''}
            <div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:14px;z-index:2;">
                <div class="player-spinner"></div>
                <span style="color:#fff;font-size:0.95rem;font-weight:600;text-shadow:0 2px 8px rgba(0,0,0,0.8);">Loading Episode…</span>
            </div>
        </div>`;
}

function setPlayerError() {
    const playerArea = $('#player-area');
    if (!playerArea) return;
    playerArea.innerHTML = `
        <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0d0d0d;gap:12px;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span style="color:#ef4444;font-size:0.95rem;font-weight:600;">No streams available</span>
            <span style="color:#64748b;font-size:0.82rem;">Try another episode or check back later.</span>
        </div>`;
}

function setServerLoading(show) {
    const el = $('#server-loading');
    if (el) el.style.display = show ? 'flex' : 'none';
}

function showServerError(msg) {
    const el = $('#server-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';

    const stripPanel = msg && /no stream|no playable|episode not found/i.test(msg);
    if (stripPanel) {
        const panel    = $('#server-panel');
        const audioBar = $('#audio-lang-bar');
        if (panel)    panel.style.display    = 'none';
        if (audioBar) audioBar.style.display = 'none';
        setPlayerError(msg);
    }
}

function hideServerError() {
    const el = $('#server-error');
    if (el) el.style.display = 'none';

    const audioBar = $('#audio-lang-bar');
    if (audioBar) audioBar.style.display = '';
    const panel = $('#server-panel');
    if (panel) panel.style.display = '';
}

let _msePatched = false;
function patchMSECodec() {
    if (_msePatched || typeof MediaSource === 'undefined') return;
    _msePatched = true;
    const _orig = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mimeType) {
        return _orig.call(this, mimeType.replace('mp4a.40.1', 'mp4a.40.2'));
    };
}

function initAudioToggle() {
    $$('.audio-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const audio = btn.dataset.audio;
            if (currentAudio === audio) return;
            currentAudio = audio;
            $$('.audio-btn').forEach(b => b.classList.toggle('active', b.dataset.audio === audio));
            const sel = document.getElementById('audio-lang-selected');
            if (sel) sel.innerHTML = `Selected: <strong>${audio === 'dub' ? 'Dub' : 'Sub'}</strong>`;
            displayedCount = 20;
            displayedCountCompact = 50;
            const searchInput = $('#ep-search-input');
            if (searchInput) searchInput.value = '';
            renderEpisodes();

            if (currentEpNum) {
                const eps = episodeData[currentAudio] || [];
                const targetEp = eps.find(e => e.number == currentEpNum);

                if (targetEp) {
                    switchEpisode(targetEp.id, targetEp.number, targetEp.title || `Episode ${targetEp.number}`, false, !!targetEp.filler);
                } else if (eps.length > 0) {

                    const first = eps[0];
                    switchEpisode(first.id, first.number, first.title || `Episode ${first.number}`, false, !!first.filler);
                }
            }
        });
    });
}

function initHeader() {
    const header = document.getElementById('header');
    if (header) {
        window.addEventListener('scroll', () => {
            header.classList.toggle('scrolled', window.scrollY > 20);
        }, { passive: true });
    }
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
}

function initSearch() {
    const setupSearch = (inputId, boxId) => {
        const input = document.getElementById(inputId);
        const box = document.getElementById(boxId);
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

function initWatchActions() {
      const serverBtn = document.getElementById('server-toggle-btn');
      const serverPanel = document.getElementById('server-panel');
      if (serverBtn && serverPanel) {
          serverPanel.classList.add('is-hidden');
          serverBtn.setAttribute('aria-expanded', 'false');
          serverBtn.addEventListener('click', () => {
              const willOpen = serverPanel.classList.contains('is-hidden');
              if (willOpen) {
                  serverPanel.classList.remove('is-hidden');
                  void serverPanel.offsetHeight;
              } else {
                  serverPanel.classList.add('is-hidden');
              }
              serverBtn.classList.toggle('is-active', willOpen);
              serverBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
              if (willOpen) {
                  setTimeout(() => {
                      serverPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }, 280);
              }
          });
      }

      const shareBtn = document.getElementById('share-btn');
      if (shareBtn) {
          shareBtn.addEventListener('click', async () => {
              const url = window.location.href;
              const title = document.getElementById('current-ep-title')?.textContent?.trim() || 'Kurovexa';
              try {
                  if (navigator.share) {
                      await navigator.share({ title, url });
                  } else {
                      await navigator.clipboard.writeText(url);
                      const labelEl = shareBtn.querySelector('span');
                      if (labelEl) {
                          const orig = labelEl.textContent;
                          labelEl.textContent = 'Copied!';
                          shareBtn.classList.add('is-active');
                          setTimeout(() => {
                              labelEl.textContent = orig;
                              shareBtn.classList.remove('is-active');
                          }, 1400);
                      }
                  }
              } catch (e) {
                  console.warn('Share failed:', e);
              }
          });
      }

  }

  document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    initSearch();
    initMobileMenu();
    initAudioToggle();
    initWatchActions();
    _syncEpViewToggleIcon();
    initPrefsUI();
    loadTrackingProfile();
    loadAnime();
});

window.addEventListener('message', (e) => {
    if (!kvPrefs.get('kv_auto_next')) return;
    try {
        const d = e.data;
        if (!d) return;
        const ended =
            d === 'ended' ||
            d.type === 'ended' ||
            d.event === 'ended' ||
            d.type === 'VIDEO_END' ||
            d.state === 'ended' ||
            d.action === 'ended' ||
            d.name  === 'ended';
        if (ended) goNextEpisode();
    } catch { }
});

async function loadRecommendations() {
    const list = $('#rec-list');
    if (!list) return;

    const targetId = (animeData && !isNaN(animeData.id)) ? animeData.id : animeId;
    if (!targetId) return;

    try {

        const data = await Kurovexa.recs(targetId);
        renderRecs(Array.isArray(data) ? data : (data.recommendations || []));
    } catch (e) {
        console.error('Failed to load recs', e);
        list.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:10px 0;">Failed to load recommendations.</div>';
    }
}

function renderRecs(recs) {
      const list = $('#rec-list');
      if (!list) return;
      const finalRecs = recs.slice(0, 10);
      if (!finalRecs.length) {
          list.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;padding:6px 0;">No recommendations available.</div>';
          return;
      }

      list.innerHTML = finalRecs.map(r => {
          const m = r.mediaRecommendation || r;
          if (!m) return '';
          const title = m.title?.english || m.title?.romaji || m.title?.native || m.title || 'Unknown';
          const img = m.bannerImage || m.coverImage?.extraLarge || m.coverImage?.large || m.image || m.poster || '';
          const type = m.format || m.type || 'TV';
          const eps = m.episodes || m.totalEpisodes || m.total || '?';
          const score = (m.averageScore || m.rating) ? `★ ${(m.averageScore || m.rating * 10) / 10}` : '';
          const id = m.id || (m.url ? m.url.split('/').pop() : '');

          return `
          <a class="rec-item" href="info.html?id=${id}">
              <img class="rec-poster" src="${img}" alt="${title}" onerror="this.src='https://via.placeholder.com/100x56?text=?'" loading="lazy">
              <div class="rec-info">
                  <div class="rec-title">${title}</div>
                  <div class="rec-meta">
                      <span>${type}</span>
                      <span>•</span>
                      <span>${eps} eps</span>
                      ${score ? `<span>•</span><span style="color:var(--accent-v2)">${score}</span>` : ''}
                  </div>
              </div>
          </a>`;
      }).join('');
  }

let _necRaf = null;
function startNextEpCountdown(info) {
    const root = document.getElementById('next-ep-countdown');
    const strip = document.getElementById('next-ep-strip');
    if (!root) return;
    if (_necRaf) { cancelAnimationFrame(_necRaf); _necRaf = null; }

    const nae = info && info.nextAiringEpisode;
    if (!nae || !nae.airingAt) {
        if (strip) strip.hidden = true;
        root.classList.remove('is-visible');
        return;
    }

    const dEl  = document.getElementById('nec-d');
    const hEl  = document.getElementById('nec-h');
    const mEl  = document.getElementById('nec-m');
    const sEl  = document.getElementById('nec-s');
    const msEl = document.getElementById('nec-ms');
    if (!dEl || !hEl || !mEl || !sEl || !msEl) return;

    if (strip) strip.hidden = false;
    root.classList.add('is-visible');

    const targetMs = Number(nae.airingAt) * 1000;
    const pad2 = (n) => String(n).padStart(2, '0');
    const pad3 = (n) => String(n).padStart(3, '0');

    let last = { d: -1, h: -1, m: -1, s: -1 };

    const flash = (numEl) => {
        const wrap = numEl.parentElement;
        if (!wrap) return;
        wrap.classList.remove('tick');

        void wrap.offsetWidth;
        wrap.classList.add('tick');
    };

    const tick = () => {
        let diff = targetMs - Date.now();
        if (diff <= 0) {
            dEl.textContent = '0'; hEl.textContent = '00'; mEl.textContent = '00';
            sEl.textContent = '00'; msEl.textContent = '000';
            _necRaf = null;
            return;
        }
        const d = Math.floor(diff / 86400000); diff -= d * 86400000;
        const h = Math.floor(diff / 3600000);  diff -= h * 3600000;
        const m = Math.floor(diff / 60000);    diff -= m * 60000;
        const s = Math.floor(diff / 1000);     diff -= s * 1000;
        const ms = Math.floor(diff);

        msEl.textContent = pad3(ms);

        if (s !== last.s) { sEl.textContent = pad2(s); flash(sEl); last.s = s; }
        if (m !== last.m) { mEl.textContent = pad2(m); flash(mEl); last.m = m; }
        if (h !== last.h) { hEl.textContent = pad2(h); flash(hEl); last.h = h; }
        if (d !== last.d) { dEl.textContent = String(d); flash(dEl); last.d = d; }

        _necRaf = requestAnimationFrame(tick);
    };
    tick();
}
