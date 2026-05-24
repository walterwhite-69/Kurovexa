
const KV_PREVIEW_LIMIT = 5;
let _kvMyListEntries = [];
let kvDashMode = false;
let fullMalLists = [];
let activeMalEditEntry = null;

const KV_SERVERS = [
    { key: '', name: 'Auto', fastest: false, desc: 'Picks the best available server automatically' },
    { key: 'kiwi-hls', name: 'Astra', fastest: true },
    { key: 'anikoto-hls', name: 'Solaris', fastest: true },
    { key: 'yuki-hls', name: 'Frost', fastest: true },
    { key: 'mimi-hls', name: 'Lunar', fastest: false },
    { key: 'shiro-hls', name: 'Halo', fastest: false },
    { key: 'wave-hls', name: 'Tide', fastest: false },
    { key: 'mochi-hls', name: 'Eclipse', fastest: false },
    { key: 'arc-hls', name: 'Zenith', fastest: false },
    { key: 'hop-hls', name: 'Orbit', fastest: false },
    { key: 'jet-hls', name: 'Comet', fastest: false },
    { key: 'bee-hls', name: 'Nova', fastest: false },
    { key: 'pulsar-hls', name: 'Pulsar', fastest: false },
    { key: 'zen-hls', name: 'Aurora', fastest: false },
    { key: 'pahe-hls', name: 'Sally', fastest: false },
    { key: 'hellforest-hls', name: 'Hell Forest', fastest: false },
    { divider: true, label: 'Embed Servers' },
    { key: 'kiwi-embed', name: 'Astra', fastest: false, tag: 'Embed' },
    { key: 'yuki-embed', name: 'Frost', fastest: false, tag: 'Embed' },
    { key: 'mimi-embed', name: 'Lunar', fastest: false, tag: 'Embed' },
    { key: 'shiro-embed', name: 'Halo', fastest: false, tag: 'Embed' },
    { key: 'wave-embed', name: 'Tide', fastest: false, tag: 'Embed' },
    { key: 'mochi-embed', name: 'Eclipse', fastest: false, tag: 'Embed' },
    { key: 'hop-embed', name: 'Orbit', fastest: false, tag: 'Embed' },
    { key: 'jet-embed', name: 'Comet', fastest: false, tag: 'Embed' },
    { key: 'pulsar-embed', name: 'Pulsar', fastest: false, tag: 'Embed' },
    { key: 'zen-embed', name: 'Aurora', fastest: false, tag: 'Embed' },
    { key: 'pahe-embed', name: 'Sally', fastest: false, tag: 'Embed' },
    { key: 'hellforest-embed', name: 'Hell Forest', fastest: false, tag: 'Embed' },
];
let _srvModalSelected = '';

function _srvEsc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function initSettings() {
    const el = document.getElementById('settings-server-name');
    if (!el) return;
    const key = localStorage.getItem('kv_default_server') || '';
    let srv = KV_SERVERS.find(s => !s.divider && s.key === key);
    if (!srv && key && !key.includes('-')) {
        srv = KV_SERVERS.find(s => !s.divider && s.key === key + '-hls');
    }
    el.textContent = key ? (srv ? srv.name + (srv.tag ? ' (Embed)' : '') : key) : 'Auto (Recommended)';
}

function renderSrvModalList() {
    const list = document.getElementById('srv-modal-list');
    if (!list) return;
    let html = '';
    KV_SERVERS.forEach((s, i) => {
        if (s.divider) {
            html += `<div class="srv-divider"></div><div style="padding:6px 12px 4px;font-size:0.68rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.1em;">${_srvEsc(s.label)}</div>`;
            return;
        }
        const active = s.key === _srvModalSelected;
        const badge = s.fastest ? '<span class="srv-fastest-badge">Fastest</span>' : '';
        const tagBadge = s.tag ? `<span class="srv-fastest-badge" style="background:rgba(99,102,241,0.12);color:#818cf8;border-color:rgba(99,102,241,0.25);">${_srvEsc(s.tag)}</span>` : '';
        const desc = s.key === '' ? `<div class="srv-auto-desc">${_srvEsc(s.desc)}</div>` : '';
        const check = active ? '<svg class="srv-check" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '';
        html += `<div class="srv-item${active ? ' active' : ''}" onclick="pickSrvItem('${_srvEsc(s.key)}')">
            <div class="srv-radio${active ? ' active' : ''}"></div>
            <div class="srv-info">
                <div class="srv-name">${_srvEsc(s.name)}${badge}${tagBadge}</div>${desc}
            </div>
            ${check}
        </div>`;
        if (i === 0) html += '<div class="srv-divider"></div>';
    });
    list.innerHTML = html;
}

window.pickSrvItem = function(key) {
    _srvModalSelected = key;
    renderSrvModalList();
};

function openServerModal() {
    _srvModalSelected = localStorage.getItem('kv_default_server') || '';
    renderSrvModalList();
    const overlay = document.getElementById('srv-modal-overlay');
    if (overlay) overlay.classList.add('open');
}
window.openServerModal = openServerModal;

function closeServerModal() {
    const overlay = document.getElementById('srv-modal-overlay');
    if (overlay) overlay.classList.remove('open');
}
window.closeServerModal = closeServerModal;

function saveServerModal() {
    localStorage.setItem('kv_default_server', _srvModalSelected);
    closeServerModal();
    initSettings();
}
window.saveServerModal = saveServerModal;

let currentAssets = { avatars: {}, backgrounds: {} };
let profileData = null;
const DEFAULT_PROFILE_BANNER = 'https://static.crunchyroll.com/assets/wallpaper/1920x600/crbrand_product_multipleprofilesbackgroundassets_4k-01.png';

let modalType = '';
let pendingSelectionUrl = null;

function setProfileBannerImage(url) {
    const banner = document.getElementById('profile-banner');
    if (!banner) return;
    const src = (url || '').trim();
    if (!src) {
        banner.style.setProperty('--profile-banner-image', 'none');
        return;
    }
    const safe = src.replace(/["\\]/g, '\\$&');
    banner.style.setProperty('--profile-banner-image', `url("${safe}")`);
}

document.addEventListener('DOMContentLoaded', async () => {

    const token = localStorage.getItem('kv_token');

    if (!token) {
        showGuestProfile();
        return;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Not logged in");
        profileData = await res.json();

        const usernameEl = document.getElementById('profile-username');
        usernameEl.textContent = profileData.username;
        usernameEl.classList.remove('skeleton-text');
        usernameEl.style.minWidth = 'auto';

        const emailEl = document.getElementById('profile-email');
        emailEl.textContent = profileData.email;
        emailEl.classList.remove('skeleton-text');
        emailEl.style.minWidth = 'auto';

        if (profileData.bg_url) {
            setProfileBannerImage(profileData.bg_url);
        } else {
            setProfileBannerImage(DEFAULT_PROFILE_BANNER);
        }

        const avatarImg = document.getElementById('profile-avatar-img');
        const avatarInit = document.getElementById('profile-avatar-initial');
        if (profileData.avatar_url) {
            avatarImg.src = profileData.avatar_url;
            avatarImg.style.display = 'block';
            avatarInit.style.display = 'none';
        } else {
            avatarInit.textContent = profileData.initial;
            avatarInit.style.display = 'block';
            avatarImg.style.display = 'none';
        }

        if (profileData.anilist_username || profileData.mal_username) {
            kvDashMode = true;
            document.getElementById('al-dashboard').style.display = 'flex';
            const gridWrapper = document.querySelector('.al-grid-wrapper');
            ['kv-mylist-section', 'profile-history-section', 'profile-settings-section'].forEach(id => {
                const el = document.getElementById(id);
                if (el && gridWrapper) {
                    gridWrapper.appendChild(el);
                    el.classList.add('al-kv-panel');
                    el.style.display = 'none';
                }
            });
            if (profileData.anilist_username) {
                loadAnilistStats();
                loadAnilistLists();
            } else {
                document.getElementById('al-stats-row') && (document.getElementById('al-stats-row').style.display = 'none');
            }
            if (profileData.mal_username) {
                const malSidebar = document.getElementById('al-mal-sidebar');
                if (malSidebar) malSidebar.style.display = '';
                document.querySelectorAll('.al-list-btn.mal-tab').forEach(b => b.style.display = '');
                loadMalLists();
            }
        }

        updateConnectionUI(profileData);
        loadMyList(token);
        renderProfileHistory();
        initSettings();

    } catch (err) {
        console.error("Auth check failed:", err);
        window.location.href = 'index.html';
    }

    document.querySelectorAll('.al-list-btn:not(.mal-tab)').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.al-list-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (btn.dataset.kvPanel) {
                switchKvPanel(btn.dataset.kvPanel);
            } else {
                switchKvPanel(null);
                renderAnilistList(btn.dataset.status);
            }
        };
    });

    document.querySelectorAll('.al-list-btn.mal-tab').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.al-list-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            switchKvPanel('mal');
            renderMalList(btn.dataset.malStatus);
        };
    });

    document.getElementById('al-filter-title').oninput = (e) => {
        const val = e.target.value.toLowerCase();
        document.querySelectorAll('.al-anime-card').forEach(card => {
            const titleEl = card.querySelector('.al-anime-title');
            if (titleEl) card.style.display = titleEl.textContent.toLowerCase().includes(val) ? '' : 'none';
        });
        document.querySelectorAll('#al-mal-grid .al-list-item').forEach(item => {
            const titleEl = item.querySelector('.al-list-title');
            if (titleEl) item.style.display = titleEl.textContent.toLowerCase().includes(val) ? '' : 'none';
        });
    };

    fetch('/api/auth/assets')
        .then(r => r.json())
        .then(data => {
            currentAssets = data;
        });

    document.getElementById('asset-modal').addEventListener('click', closeAssetModal);

    initProfileNav();
});

function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function showGuestProfile() {
    setProfileBannerImage(DEFAULT_PROFILE_BANNER);

    const bannerOverlay = document.querySelector('.banner-overlay');
    if (bannerOverlay) bannerOverlay.style.display = 'none';
    const avatarOverlay = document.querySelector('.avatar-edit-overlay');
    if (avatarOverlay) avatarOverlay.style.display = 'none';

    const avatarInit = document.getElementById('profile-avatar-initial');
    avatarInit.textContent = 'G';
    avatarInit.style.display = 'block';
    document.getElementById('profile-avatar-img').style.display = 'none';

    const usernameEl = document.getElementById('profile-username');
    usernameEl.textContent = 'Guest';
    usernameEl.classList.remove('skeleton-text');
    usernameEl.style.minWidth = 'auto';

    const emailEl = document.getElementById('profile-email');
    emailEl.textContent = 'Not signed in';
    emailEl.classList.remove('skeleton-text');
    emailEl.style.minWidth = 'auto';

    const guestBanner = document.getElementById('guest-signin-banner');
    if (guestBanner) guestBanner.style.display = 'block';

    const alDash = document.getElementById('al-dashboard');
    if (alDash) alDash.style.display = 'none';
    const alWrap = document.getElementById('connect-anilist-wrap');
    if (alWrap) alWrap.style.display = 'none';

    const localSection = document.getElementById('local-list-section');
    if (localSection) localSection.style.display = 'block';
    renderLocalList();
    renderProfileHistory();
    initSettings();

    initProfileNav();
}

function showPhConfirm(onConfirm) {
    const overlay = document.getElementById('ph-confirm-overlay');
    const okBtn = document.getElementById('ph-confirm-ok');
    const cancelBtn = document.getElementById('ph-confirm-cancel');
    if (!overlay || !okBtn || !cancelBtn) { onConfirm(); return; }
    overlay.classList.add('open');
    const close = () => overlay.classList.remove('open');
    const handleOk = () => { close(); onConfirm(); cleanup(); };
    const handleCancel = () => { close(); cleanup(); };
    const handleBackdrop = (e) => { if (e.target === overlay) handleCancel(); };
    const handleKey = (e) => { if (e.key === 'Escape') handleCancel(); };
    function cleanup() {
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        overlay.removeEventListener('click', handleBackdrop);
        document.removeEventListener('keydown', handleKey);
    }
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleBackdrop);
    document.addEventListener('keydown', handleKey);
}

function renderKvMylistGrid(showAll) {
    const section = document.getElementById('kv-mylist-section');
    const grid = document.getElementById('kv-mylist-grid');
    if (!section || !grid) return;
    const entries = _kvMyListEntries;
    if (!entries.length) {
        grid.innerHTML = '<div class="kv-list-empty">No anime in your list yet. Browse and click <strong>Add to List</strong> on any anime page to add it here.</div>';
        if (!kvDashMode) section.style.display = 'none';
        return;
    }
    if (!kvDashMode) section.style.display = 'block';
    const visible = showAll ? entries : entries.slice(0, KV_PREVIEW_LIMIT);
    grid.innerHTML = visible.map(e => `
        <a class="kv-list-card" href="info.html?id=${escHtml(e.media_id)}">
            <div class="kv-list-poster">
                <img src="${escHtml(e.poster || '')}" alt="${escHtml(e.title || '')}" loading="lazy" onerror="this.style.opacity=0.2">
                <span class="kv-list-status-badge ${(e.status || '').toLowerCase()}">${escHtml(e.status || '')}</span>
            </div>
            <p class="kv-list-title">${escHtml(e.title || 'Untitled')}</p>
        </a>
    `).join('');
    let wrap = section.querySelector('.kv-view-all-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'kv-view-all-wrap'; section.appendChild(wrap); }
    wrap.innerHTML = (!showAll && entries.length > KV_PREVIEW_LIMIT)
        ? `<button class="kv-view-all-btn" onclick="renderKvMylistGrid(true)">View All (${entries.length} anime)</button>`
        : '';
}
window.renderKvMylistGrid = renderKvMylistGrid;

function switchKvPanel(panel) {
    const anilistPanel = document.getElementById('al-anilist-panel');
    const malPanel = document.getElementById('al-mal-panel');
    const filterWrap = document.querySelector('.al-filters');
    const kvPanelMap = { mylist: 'kv-mylist-section', history: 'profile-history-section', settings: 'profile-settings-section' };
    const kvIds = Object.values(kvPanelMap);

    if (!panel) {
        if (anilistPanel) anilistPanel.style.display = '';
        if (malPanel) malPanel.style.display = 'none';
        kvIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (filterWrap) filterWrap.style.display = '';
    } else if (panel === 'mal') {
        if (anilistPanel) anilistPanel.style.display = 'none';
        if (malPanel) malPanel.style.display = '';
        kvIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        if (filterWrap) filterWrap.style.display = '';
    } else {
        if (anilistPanel) anilistPanel.style.display = 'none';
        if (malPanel) malPanel.style.display = 'none';
        const targetId = kvPanelMap[panel];
        kvIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = (id === targetId) ? 'block' : 'none';
        });
        if (filterWrap) filterWrap.style.display = 'none';
        if (panel === 'history') renderProfileHistory();
        if (panel === 'mylist') renderKvMylistGrid(false);
        if (panel === 'settings') initSettings();
    }
}
window.switchKvPanel = switchKvPanel;

async function loadMyList(token) {
    try {
        const r = await fetch('/api/mylist', { headers: { 'Authorization': `Bearer ${token}` } });
        const d = await r.json();
        _kvMyListEntries = d.list || [];
        renderKvMylistGrid(false);
    } catch (e) {}
}

function renderProfileHistory(showAll) {
    const body = document.getElementById('ph-body');
    const clearBtn = document.getElementById('ph-clear-btn');
    if (!body) return;

    let history = [];
    try { history = JSON.parse(localStorage.getItem('kv_history') || '[]'); } catch {}
    const totalItems = history.length;

    if (!totalItems) {
        body.innerHTML = `<div class="ph-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>No watch history yet.<br>Start watching to see your history here.</div>`;
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }

    if (clearBtn) {
        clearBtn.style.display = '';
        clearBtn.onclick = () => {
            showPhConfirm(() => {
                localStorage.removeItem('kv_history');
                renderProfileHistory(false);
            });
        };
    }

    const displayHistory = showAll ? history : history.slice(0, KV_PREVIEW_LIMIT);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups = [];
    const groupMap = {};

    displayHistory.forEach(item => {
        const d = new Date(item.time || Date.now());
        d.setHours(0, 0, 0, 0);
        const key = d.getTime();
        if (!groupMap[key]) {
            let label;
            if (d.getTime() === today.getTime()) {
                label = 'Today';
            } else if (d.getTime() === yesterday.getTime()) {
                label = 'Yesterday';
            } else {
                label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            }
            groupMap[key] = { label, items: [] };
            groups.push(groupMap[key]);
        }
        groupMap[key].items.push(item);
    });

    const groupsHtml = groups.map(group => {
        const cards = group.items.map(item => {
            const pct = Math.min(100, Math.max(0, ((item.pos || 0) / (item.dur || 1)) * 100));
            const epNum = parseInt(item.ep, 10);
            const watchUrl = `anime.html?id=${encodeURIComponent(item.id)}${Number.isFinite(epNum) && epNum > 0 ? `&ep=${epNum}` : ''}`;
            const safeImg = escHtml(item.image || '');
            const safeTitle = escHtml(item.title || 'Untitled');
            const safeEpTitle = escHtml(item.epTitle || `Episode ${item.ep}`);
            const safeId = escHtml(String(item.id));
            return `<div class="ph-card" onclick="location.href='${watchUrl}'">
                <div class="ph-thumb">
                    <img src="${safeImg}" alt="${safeTitle}" loading="lazy" onerror="this.style.opacity=0.15">
                    <div class="ph-play"><div class="ph-play-icon"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div>
                    <div class="ph-ep-tag">EP ${escHtml(String(item.ep))}</div>
                    <div class="ph-progress-wrap"><div class="ph-progress-bar" style="width:${pct}%"></div></div>
                    <button class="ph-remove" onclick="event.stopPropagation();phRemoveItem('${safeId}')" title="Remove from history"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div class="ph-body">
                    <div class="ph-title">${safeTitle}</div>
                    <div class="ph-ep-title">${safeEpTitle}</div>
                </div>
            </div>`;
        }).join('');
        return `<div class="ph-date-group"><div class="ph-date-label">${escHtml(group.label)}</div><div class="ph-row">${cards}</div></div>`;
    }).join('');

    const viewAllHtml = (!showAll && totalItems > KV_PREVIEW_LIMIT)
        ? `<div class="kv-view-all-wrap"><button class="kv-view-all-btn" onclick="renderProfileHistory(true)">View All (${totalItems} episodes)</button></div>`
        : '';

    body.innerHTML = groupsHtml + viewAllHtml;
}
window.renderProfileHistory = renderProfileHistory;

window.phRemoveItem = function(id) {
    try {
        const h = JSON.parse(localStorage.getItem('kv_history') || '[]');
        localStorage.setItem('kv_history', JSON.stringify(h.filter(i => String(i.id) !== String(id))));
        renderProfileHistory();
    } catch {}
};

function renderLocalList(showAll) {
    const container = document.getElementById('local-list-grid');
    const section = document.getElementById('local-list-section');
    if (!container) return;
    let list = {};
    try { list = JSON.parse(localStorage.getItem('kv_mylist') || '{}'); } catch {}
    const entries = Object.values(list).sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    if (entries.length === 0) {
        container.innerHTML = '<div class="kv-list-empty">No anime saved yet. Browse and click <strong>Add to List</strong> on any anime page to add it here.</div>';
        const existing = section ? section.querySelector('.kv-view-all-wrap') : null;
        if (existing) existing.innerHTML = '';
        return;
    }
    const visible = showAll ? entries : entries.slice(0, KV_PREVIEW_LIMIT);
    container.innerHTML = visible.map(e => `
        <a class="kv-list-card" href="info.html?id=${escHtml(String(e.id))}">
            <div class="kv-list-poster">
                <img src="${escHtml(e.poster || '')}" alt="${escHtml(e.title || '')}" loading="lazy" onerror="this.style.opacity=0.2">
                <span class="kv-list-status-badge ${(e.status || '').toLowerCase()}">${escHtml(e.status || '')}</span>
            </div>
            <p class="kv-list-title">${escHtml(e.title || 'Untitled')}</p>
        </a>
    `).join('');
    if (section) {
        let wrap = section.querySelector('.kv-view-all-wrap');
        if (!wrap) { wrap = document.createElement('div'); wrap.className = 'kv-view-all-wrap'; section.appendChild(wrap); }
        wrap.innerHTML = (!showAll && entries.length > KV_PREVIEW_LIMIT)
            ? `<button class="kv-view-all-btn" onclick="renderLocalList(true)">View All (${entries.length} anime)</button>`
            : '';
    }
}
window.renderLocalList = renderLocalList;

function initProfileNav() {
    const input = document.getElementById('search-input');
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && input.value.trim()) window.location.href = `browse.html?q=${encodeURIComponent(input.value.trim())}`;
        });
    }

    const mInput = document.getElementById('mobile-search-input');
    if (mInput) {
        mInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && mInput.value.trim()) window.location.href = `browse.html?q=${encodeURIComponent(mInput.value.trim())}`;
        });
    }

    const btn = document.getElementById('mobile-menu-btn');
    const nav = document.getElementById('mobile-nav');
    if (btn && nav) {
        btn.addEventListener('click', () => { btn.classList.toggle('open'); nav.classList.toggle('open'); });
        document.addEventListener('click', e => {
            if (!e.target.closest('#header')) { btn.classList.remove('open'); nav.classList.remove('open'); }
        });
    }

    const header = document.getElementById('header');
    if (header) {
        const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 20);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }
}

function openAssetModal(type) {
    modalType = type;
    pendingSelectionUrl = null;

    const title = type === 'avatar' ? 'Select Profile Avatar' : 'Select Background Banner';
    document.getElementById('asset-modal-title').textContent = title;

    const gridContainer = document.getElementById('asset-grid-container');
    gridContainer.innerHTML = '';

    const assetsData = type === 'avatar' ? currentAssets.avatars : currentAssets.backgrounds;
    const gridClass = type === 'avatar' ? 'avatar-grid' : 'bg-grid';

    const categories = Object.keys(assetsData).sort();

    if (categories.length === 0) {
        gridContainer.innerHTML = '<p style="color:rgba(255,255,255,0.5);">Assets are still loading... please try again in a moment.</p>';
    }

    categories.forEach(category => {
        const urls = assetsData[category];
        if (!urls || urls.length === 0) return;

        const catDiv = document.createElement('div');
        catDiv.className = 'asset-category';

        const catTitle = document.createElement('h3');
        catTitle.textContent = category;
        catDiv.appendChild(catTitle);

        const grid = document.createElement('div');
        grid.className = `asset-grid ${gridClass}`;

        urls.forEach(url => {
            const item = document.createElement('div');
            item.className = 'asset-item';

            const isCurrent = (type === 'avatar' && url === profileData.avatar_url) ||
                (type === 'background' && url === profileData.bg_url);
            if (isCurrent) item.classList.add('selected');

            const img = document.createElement('img');
            img.src = url;
            img.loading = 'lazy';
            item.appendChild(img);

            item.onclick = () => selectAsset(item, url);
            grid.appendChild(item);
        });

        catDiv.appendChild(grid);
        if (category === "Crunchyroll Brand" || category === "General") {
            gridContainer.prepend(catDiv);
        } else {
            gridContainer.appendChild(catDiv);
        }
    });

    document.getElementById('asset-save-btn').disabled = true;

    const modalOverlay = document.getElementById('asset-modal');
    modalOverlay.style.display = 'flex';
    requestAnimationFrame(() => {
        modalOverlay.classList.add('active');
    });
}

function closeAssetModal() {
    const modalOverlay = document.getElementById('asset-modal');
    modalOverlay.classList.remove('active');

    setTimeout(() => {
        if (!modalOverlay.classList.contains('active')) {
            modalOverlay.style.display = '';
        }
    }, 400);
}

function selectAsset(itemDiv, url) {
    document.querySelectorAll('.asset-item').forEach(i => i.classList.remove('selected'));

    itemDiv.classList.add('selected');
    pendingSelectionUrl = url;
    document.getElementById('asset-save-btn').disabled = false;
}

async function saveAssetSelection() {
    if (!pendingSelectionUrl) return;

    const btn = document.getElementById('asset-save-btn');
    btn.innerHTML = '<span class="loader-spinner" style="width:16px;height:16px;border-width:2px;"></span> Saving...';
    btn.disabled = true;

    const payload = {};
    if (modalType === 'avatar') payload.avatar_url = pendingSelectionUrl;
    if (modalType === 'background') payload.bg_url = pendingSelectionUrl;

    try {
        const res = await fetch('/api/auth/profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('kv_token')}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {

            if (modalType === 'avatar') {
                profileData.avatar_url = pendingSelectionUrl;
                document.getElementById('profile-avatar-img').src = pendingSelectionUrl;
                document.getElementById('profile-avatar-img').style.display = 'block';
                document.getElementById('profile-avatar-initial').style.display = 'none';

                if (window.renderAuthNav) await window.initAuth();
            } else {
                profileData.bg_url = pendingSelectionUrl;
                setProfileBannerImage(pendingSelectionUrl);
            }

            if (window.showToast) {
                showToast("Profile Updated", `Your ${modalType} has been successfully updated.`);
            }
            closeAssetModal();
        } else {
            throw new Error("Failed to save");
        }
    } catch (e) {
        console.error(e);
        if (window.showToast) {
            showToast("Update Failed", "Could not save your changes. Try again later.", "error");
        } else {
            alert("Error saving profile update.");
        }
    } finally {
        btn.textContent = 'Save Selection';
    }
}

async function loadAnilistStats() {
    try {
        const r = await fetch('/api/anilist/stats', { headers: { 'Authorization': `Bearer ${localStorage.getItem('kv_token')}` } });
        const d = await r.json();
        const s = d.data?.User?.statistics?.anime;
        if (s) {
            document.getElementById('al-total-anime').textContent = s.count;
            document.getElementById('al-days-watched').textContent = (s.minutesWatched / 1440).toFixed(1);
            document.getElementById('al-mean-score').textContent = s.meanScore.toFixed(2);
        }
    } catch (e) { console.error(e); }
}

let fullAlLists = [];
async function loadAnilistLists() {
    const grid = document.getElementById('al-anime-grid');
    grid.innerHTML = '<div class="loader-spinner" style="grid-column: 1/-1; margin: 40px auto; border-color: rgba(124, 58, 237, 0.5);"></div>';
    try {
        const r = await fetch('/api/anilist/lists', { headers: { 'Authorization': `Bearer ${localStorage.getItem('kv_token')}` } });
        const d = await r.json();
        fullAlLists = d.data?.MediaListCollection?.lists || [];
        renderAnilistList('ALL');
    } catch (e) { grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; opacity:0.5;">Failed to load lists.</p>'; }
}

function renderAnilistList(status) {
    const grid = document.getElementById('al-anime-grid');
    grid.innerHTML = '';

    let entries = [];
    if (status === 'ALL') {
        fullAlLists.forEach(l => {
            entries = entries.concat(l.entries);
        });
    } else {
        const list = fullAlLists.find(l => l.entries[0]?.status === status) || { entries: [] };
        entries = list.entries;
    }

    if (entries.length === 0) {
        grid.innerHTML = `<p style="grid-column: 1/-1; text-align:center; padding: 40px; opacity:0.5;">No anime in this category.</p>`;
        return;
    }

    const header = document.createElement('div');
    header.className = 'al-list-header';
    header.innerHTML = `
        <div style="text-align:center;">•</div>
        <div>Poster</div>
        <div>Title</div>
        <div style="text-align:center;">Score / Progress</div>
    `;
    grid.appendChild(header);

    const listContainer = document.createElement('div');
    listContainer.className = 'al-anime-list';

    entries.forEach(entry => {
        const m = entry.media;
        const item = document.createElement('div');
        item.className = 'al-list-item';

        const dot = `<div class="al-status-dot ${entry.status}"></div>`;
        const scoreVal = entry.score > 0 ? entry.score : '-';
        const progressVal = `${(entry.progress !== null && entry.progress !== undefined) ? entry.progress : 0} / ${m.episodes || '?'}`;
        const listTitle = m.title.romaji || m.title.english || 'Untitled';

        item.innerHTML = `
            ${dot}
            <img class="al-list-thumb" src="${m.coverImage.large}" loading="lazy">
            <div class="al-list-title">${listTitle}</div>
            <div class="al-list-stats">
                <div class="al-list-score">${scoreVal}</div>
                <div class="al-list-progress">${progressVal}</div>
            </div>
        `;

        item.onclick = (e) => {
            e.preventDefault();
            openAlEditModal(entry);
        };
        listContainer.appendChild(item);
    });
    grid.appendChild(listContainer);
}

let activeEditEntry = null;

function getAnilistEpisodeLimit(entry = activeEditEntry) {
    const total = Number(entry?.media?.episodes);
    return Number.isFinite(total) && total > 0 ? total : null;
}

function openAlEditModal(entry) {
    activeEditEntry = entry;
    const m = entry.media;
    const totalEpisodes = getAnilistEpisodeLimit(entry);
    const progressInput = document.getElementById('al-edit-progress');

    document.getElementById('al-edit-title').textContent = m.title.romaji || m.title.english;
    document.getElementById('al-edit-total-eps').textContent = m.episodes || '?';

    document.getElementById('al-edit-status').value = entry.status;
    progressInput.value = entry.progress;
    progressInput.min = '0';
    if (totalEpisodes !== null) {
        progressInput.max = String(totalEpisodes);
        progressInput.value = Math.min(Number(entry.progress) || 0, totalEpisodes);
    } else {
        progressInput.removeAttribute('max');
    }
    document.getElementById('al-edit-score').value = entry.score;
    document.getElementById('al-edit-notes').value = entry.notes || '';
    document.getElementById('al-edit-repeat').value = entry.repeat || 0;

    const fmtDate = (d) => {
        if (!d || !d.year) return '';
        return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    };
    document.getElementById('al-edit-start').value = fmtDate(entry.startedAt);
    document.getElementById('al-edit-end').value = fmtDate(entry.completedAt);

    const modal = document.getElementById('al-edit-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);

    progressInput.oninput = () => {
        const limit = getAnilistEpisodeLimit();
        const current = Math.max(0, parseInt(progressInput.value || '0', 10) || 0);
        progressInput.value = (limit !== null) ? Math.min(current, limit) : current;
    };

    document.getElementById('al-save-entry-btn').onclick = saveAlEdit;
    document.getElementById('al-delete-btn').onclick = deleteAlEntry;
}

function closeAlEditModal() {
    const modal = document.getElementById('al-edit-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 300);
    activeEditEntry = null;
}

async function saveAlEdit() {
    if (!activeEditEntry) return;
    const btn = document.getElementById('al-save-entry-btn');
    const oldText = btn.textContent;
    btn.innerHTML = '<span class="loader-spinner" style="width:16px;height:16px;border-width:2px;"></span> Saving...';
    btn.disabled = true;

    const parseDate = (val) => {
        if (!val) return null;
        const [y, m, d] = val.split('-').map(Number);
        return { year: y, month: m, day: d };
    };

    const totalEpisodes = getAnilistEpisodeLimit();
    const rawProgress = parseInt(document.getElementById('al-edit-progress').value, 10);
    const normalizedProgress = Math.max(0, Number.isFinite(rawProgress) ? rawProgress : 0);
    const clampedProgress = (totalEpisodes !== null) ? Math.min(normalizedProgress, totalEpisodes) : normalizedProgress;

    const payload = {
        mediaId: activeEditEntry.media.id,
        status: document.getElementById('al-edit-status').value,
        progress: clampedProgress,
        score: parseFloat(document.getElementById('al-edit-score').value),
        notes: document.getElementById('al-edit-notes').value,
        repeat: parseInt(document.getElementById('al-edit-repeat').value),
        startedAt: parseDate(document.getElementById('al-edit-start').value),
        completedAt: parseDate(document.getElementById('al-edit-end').value)
    };

    if (totalEpisodes !== null && normalizedProgress > totalEpisodes && window.showToast) {
        showToast("Progress Adjusted", `Capped at ${totalEpisodes} episodes for this anime.`);
    }

    try {
        const res = await fetch('/api/anilist/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('kv_token')}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            if (window.showToast) showToast("Updated", "AniList entry updated successfully.");
            closeAlEditModal();
            loadAnilistLists();
        } else {
            throw new Error("Failed to save");
        }
    } catch (e) {
        console.error(e);
        if (window.showToast) showToast("Error", "Failed to update AniList.", "error");
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

async function deleteAlEntry() {
    console.log('[AniList] deleteAlEntry called for ID:', activeEditEntry?.id);

    if (!activeEditEntry?.id) {
        console.warn('[AniList] Missing entry ID for deletion');
        if (window.showToast) showToast("Error", "Cannot delete: Entry ID missing.", "error");
        return;
    }

    if (!confirm("Are you sure you want to delete this anime from your list?")) return;

    try {
        const res = await fetch('/api/anilist/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('kv_token')}`
            },
            body: JSON.stringify({ id: activeEditEntry.id })
        });

        const result = await res.json();
        console.log('[AniList] Delete Response:', result);

        if (res.ok) {
            if (window.showToast) showToast("Deleted", "Entry removed from your AniList.");
            closeAlEditModal();
            loadAnilistLists();
        } else {
            if (window.showToast) showToast("Delete Failed", result.error || "Server error", "error");
        }
    } catch (e) {
        console.error('[AniList Delete Error]', e);
        if (window.showToast) showToast("Error", "Check console for details.", "error");
    }
}

function updateConnectionUI(data) {
    const alDesc  = document.getElementById('al-connection-desc');
    const alRight = document.getElementById('al-connection-right');
    if (alDesc && alRight) {
        if (data.anilist_username) {
            alDesc.textContent = 'Connected as ' + data.anilist_username;
            alRight.innerHTML = '<button class="settings-change-btn" style="border-color:rgba(239,68,68,0.35);color:#f87171;" onclick="disconnectAnilist()">Disconnect</button>';
        } else {
            alDesc.textContent = 'Not connected';
            alRight.innerHTML = '<button class="settings-change-btn" onclick="openAnilistAuth(\'profile\')">Connect</button>';
        }
    }

    const malDesc  = document.getElementById('mal-connection-desc');
    const malRight = document.getElementById('mal-connection-right');
    if (malDesc && malRight) {
        if (data.mal_username) {
            malDesc.textContent = 'Connected as ' + data.mal_username;
            malRight.innerHTML = '<button class="settings-change-btn" style="border-color:rgba(239,68,68,0.35);color:#f87171;" onclick="disconnectMal()">Disconnect</button>';
        } else {
            malDesc.textContent = 'Not connected';
            malRight.innerHTML = '<button class="settings-change-btn" onclick="openMalAuth()">Connect</button>';
        }
    }

    const sel = document.getElementById('tracking-mode-select');
    if (sel) {
        sel.value = data.tracking_mode || 'none';
        for (const opt of sel.options) {
            if (opt.value === 'anilist') opt.disabled = !data.anilist_username;
            if (opt.value === 'mal')     opt.disabled = !data.mal_username;
            if (opt.value === 'both')    opt.disabled = !(data.anilist_username && data.mal_username);
        }
    }
}

async function openMalAuth() {
    const token = localStorage.getItem('kv_token');
    try {
        const res  = await fetch('/api/auth/mal/login', {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
        });
        const data = await res.json();
        if (!data.url) return;
        window.open(data.url, 'mal_auth', 'width=600,height=700,scrollbars=yes');
        const handler = (e) => {
            if (e.data && (e.data.type === 'mal_connected' || e.data.type === 'mal_logged_in')) {
                window.removeEventListener('message', handler);
                if (e.data.token) localStorage.setItem('kv_token', e.data.token);
                location.reload();
            }
        };
        window.addEventListener('message', handler);
    } catch (e) {}
}
window.openMalAuth = openMalAuth;

async function disconnectMal() {
    const token = localStorage.getItem('kv_token');
    if (!token) return;
    try {
        await fetch('/api/auth/mal/disconnect', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        location.reload();
    } catch (e) {}
}
window.disconnectMal = disconnectMal;

async function disconnectAnilist() {
    const token = localStorage.getItem('kv_token');
    if (!token) return;
    try {
        await fetch('/api/auth/anilist/disconnect', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        location.reload();
    } catch (e) {}
}
window.disconnectAnilist = disconnectAnilist;

async function saveTrackingMode(mode) {
    const token = localStorage.getItem('kv_token');
    if (!token) return;
    try {
        await fetch('/api/tracking/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ mode })
        });
        const labels = { none: 'Off', anilist: 'AniList Only', mal: 'MAL Only', both: 'AniList + MAL' };
        if (window.showToast) showToast('Tracking Updated', 'Now set to: ' + (labels[mode] || mode));
    } catch (e) {}
}
window.saveTrackingMode = saveTrackingMode;

async function loadMalLists() {
    const grid = document.getElementById('al-mal-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="loader-spinner" style="grid-column:1/-1;margin:40px auto;border-color:rgba(59,130,246,0.5);"></div>';
    try {
        const r = await fetch('/api/mal/lists', { headers: { 'Authorization': `Bearer ${localStorage.getItem('kv_token')}` } });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Failed');
        fullMalLists = d.data || [];
        renderMalList('ALL');
    } catch (e) {
        if (grid) grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;opacity:0.5;">Failed to load MAL list.</p>';
    }
}

function renderMalList(status) {
    const grid = document.getElementById('al-mal-grid');
    if (!grid) return;
    grid.innerHTML = '';

    let entries = fullMalLists;
    if (status !== 'ALL') {
        entries = fullMalLists.filter(item => item.list_status?.status === status);
    }

    if (entries.length === 0) {
        grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;padding:40px;opacity:0.5;">No anime in this category.</p>`;
        return;
    }

    const header = document.createElement('div');
    header.className = 'al-list-header';
    header.innerHTML = `
        <div style="text-align:center;">•</div>
        <div>Poster</div>
        <div>Title</div>
        <div style="text-align:center;">Score / Progress</div>
    `;
    grid.appendChild(header);

    const listContainer = document.createElement('div');
    listContainer.className = 'al-anime-list';

    entries.forEach(item => {
        const node = item.node || {};
        const ls = item.list_status || {};
        const malStatus = ls.status || 'watching';
        const score = ls.score > 0 ? ls.score : '-';
        const watched = ls.num_episodes_watched || 0;
        const total = node.num_episodes || '?';
        const title = node.title || 'Unknown';
        const thumb = node.main_picture?.medium || node.main_picture?.large || '';

        const el = document.createElement('div');
        el.className = 'al-list-item';
        el.innerHTML = `
            <div class="mal-status-dot ${malStatus}"></div>
            <img class="al-list-thumb" src="${escHtml(thumb)}" loading="lazy">
            <div class="al-list-title">${escHtml(title)}</div>
            <div class="al-list-stats">
                <div class="al-list-score">${score}</div>
                <div class="al-list-progress">${watched} / ${total}</div>
            </div>
        `;
        el.onclick = () => openMalEditModal(item);
        listContainer.appendChild(el);
    });

    grid.appendChild(listContainer);
}

function openMalEditModal(item) {
    activeMalEditEntry = item;
    const node = item.node || {};
    const ls = item.list_status || {};

    document.getElementById('mal-edit-title').textContent = node.title || 'Unknown';
    document.getElementById('mal-edit-total-eps').textContent = node.num_episodes || '?';

    const statusEl = document.getElementById('mal-edit-status');
    statusEl.value = ls.status || 'watching';

    const progressEl = document.getElementById('mal-edit-progress');
    progressEl.value = ls.num_episodes_watched || 0;
    if (node.num_episodes) progressEl.max = node.num_episodes;
    else progressEl.removeAttribute('max');

    document.getElementById('mal-edit-score').value = ls.score || 0;
    document.getElementById('mal-edit-start').value = ls.start_date || '';
    document.getElementById('mal-edit-finish').value = ls.finish_date || '';

    const modal = document.getElementById('mal-edit-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);

    document.getElementById('mal-save-btn').onclick = saveMalEdit;
    document.getElementById('mal-delete-btn').onclick = deleteMalEntry;

    progressEl.oninput = () => {
        const max = node.num_episodes;
        if (max) progressEl.value = Math.min(parseInt(progressEl.value || '0', 10) || 0, max);
    };
}
window.openMalEditModal = openMalEditModal;

function closeMalEditModal() {
    const modal = document.getElementById('mal-edit-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 280);
    activeMalEditEntry = null;
}
window.closeMalEditModal = closeMalEditModal;

async function saveMalEdit() {
    if (!activeMalEditEntry) return;
    const btn = document.getElementById('mal-save-btn');
    const oldText = btn.textContent;
    btn.innerHTML = '<span class="loader-spinner" style="width:14px;height:14px;border-width:2px;"></span> Saving...';
    btn.disabled = true;

    const animeId = activeMalEditEntry.node?.id;
    const payload = {
        animeId,
        status: document.getElementById('mal-edit-status').value,
        progress: parseInt(document.getElementById('mal-edit-progress').value, 10) || 0,
        score: parseInt(document.getElementById('mal-edit-score').value, 10) || 0,
        start_date: document.getElementById('mal-edit-start').value || null,
        finish_date: document.getElementById('mal-edit-finish').value || null,
    };

    try {
        const res = await fetch('/api/mal/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('kv_token')}` },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            if (window.showToast) showToast('Updated', 'MAL entry updated successfully.');
            closeMalEditModal();
            loadMalLists();
        } else {
            throw new Error('Failed to save');
        }
    } catch (e) {
        if (window.showToast) showToast('Error', 'Failed to update MAL entry.', 'error');
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

async function deleteMalEntry() {
    if (!activeMalEditEntry?.node?.id) return;
    if (!confirm('Remove this anime from your MAL list?')) return;

    const animeId = activeMalEditEntry.node.id;
    try {
        const res = await fetch('/api/mal/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('kv_token')}` },
            body: JSON.stringify({ animeId })
        });
        if (res.ok) {
            if (window.showToast) showToast('Deleted', 'Removed from your MAL list.');
            closeMalEditModal();
            loadMalLists();
        } else {
            const d = await res.json();
            if (window.showToast) showToast('Error', d.error || 'Delete failed.', 'error');
        }
    } catch (e) {
        if (window.showToast) showToast('Error', 'Delete failed.', 'error');
    }
}
