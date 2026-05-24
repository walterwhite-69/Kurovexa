

class CommentsController {
    constructor() {
        this.animeId = null;
        this.episodeNum = null;
        this.comments = [];
        this.user = null;
        this.activeReplyId = null;
        this.MAX_CHARS = 1000;
        this.SHOW_MORE_THRESHOLD = 5;
        this.selectedGifUrl = null;

        this.DOM = {
            section:           document.getElementById('comments-section'),
            count:             document.getElementById('comments-count'),
            list:              document.getElementById('comments-list'),
            mainInput:         document.getElementById('main-comment-input'),
            mainCharCount:     document.getElementById('main-char-count'),
            mainPostBtn:       document.getElementById('main-comment-btn'),
            currentUserAvatar: document.getElementById('current-user-avatar'),
            loginOverlay:      document.getElementById('comment-login-overlay'),
            listWrapper:       document.querySelector('.comments-list-wrapper'),
            fadeMask:          document.getElementById('comments-fade-mask'),
            showMoreBtn:       document.getElementById('show-more-comments-btn'),
            mainSpoiler:       document.getElementById('main-comment-spoiler'),
            mainGifBtn:        document.getElementById('main-gif-toggle-btn'),
            mainGifPreview:    document.getElementById('main-gif-preview'),
            gifModal:          document.getElementById('gif-picker-modal'),
            gifSearchInput:    document.getElementById('gif-search-input'),
            gifCloseBtn:       document.getElementById('close-gif-picker'),
            gifGrid:           document.getElementById('gif-results-grid'),
            gifLoading:        document.getElementById('gif-loading-spinner'),
        };

        this.DOM.mainInput.addEventListener('mousedown', () => {
             if (!this.user && window.openAuthModal) window.openAuthModal('login');
        });

        this.bindEvents();

        const params = new URLSearchParams(window.location.search);
        const aid    = params.get('id');
        const ep     = params.get('ep');

        if (aid && ep) {
            this.load(aid, ep);
        } else {

            if (this.DOM.section) this.DOM.section.style.display = 'none';
        }
    }

    async init() {
        await this.refreshUser();
        this.updateUIAuth();
    }

    async load(animeId, episodeNum) {
        if (!animeId || !episodeNum) return;

        this.animeId = animeId;
        this.episodeNum = episodeNum;

        if (this.DOM.section) {
            this.DOM.section.style.display = 'block';
        }

        if (!this.user) {
            await this.refreshUser();
            this.updateUIAuth();
        }

        await this.fetchComments();
    }

    async refreshUser() {
        const token = localStorage.getItem('kv_token');
        if (!token) { this.user = null; return; }
        try {
            const r = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            this.user = r.ok ? await r.json() : null;
        } catch (e) {
            this.user = null;
        }
    }

    selectGif(url) {
        this.selectedGifUrl = url;
        this.DOM.gifModal.classList.remove('active');
        if (this.DOM.mainGifPreview) {
            this.DOM.mainGifPreview.innerHTML = `
                <button class="remove-gif-btn" title="Remove GIF">×</button>
                <img src="${url}" alt="Selected GIF">
            `;
            this.DOM.mainGifPreview.style.display = 'block';
            this.DOM.mainGifPreview.querySelector('.remove-gif-btn').addEventListener('click', () => {
                this.selectedGifUrl = null;
                this.DOM.mainGifPreview.innerHTML = '';
                this.DOM.mainGifPreview.style.display = 'none';
                if (this.DOM.mainInput.value.trim().length === 0) {
                    this.DOM.mainPostBtn.disabled = true;
                }
            });
        }
        this.DOM.mainPostBtn.disabled = false;
    }

    async fetchGifs(type = 'trending', query = '') {
        const API_KEY = 'LIVDSRZULELA';
        this.DOM.gifGrid.innerHTML = '';
        this.DOM.gifLoading.style.display = 'flex';

        let url = `https://g.tenor.com/v1/trending?key=${API_KEY}&limit=20&media_filter=minimal`;
        if (type === 'search' && query) {
            url = `https://g.tenor.com/v1/search?key=${API_KEY}&q=${encodeURIComponent(query)}&limit=20&media_filter=minimal`;
        }

        try {
            const r = await fetch(url);
            const data = await r.json();
            this.DOM.gifLoading.style.display = 'none';

            if (data.results) {
                data.results.forEach(gif => {
                    const imgUrl = gif.media[0].tinygif.url;
                    const fullUrl = gif.media[0].gif.url;
                    const img = document.createElement('img');
                    img.src = imgUrl;
                    img.className = 'gif-result-item';
                    img.loading = 'lazy';
                    img.addEventListener('click', () => {
                        this.selectGif(fullUrl);
                    });
                    this.DOM.gifGrid.appendChild(img);
                });
            }
        } catch (e) {
            console.error('[Tenor] error:', e);
            this.DOM.gifLoading.style.display = 'none';
        }
    }

    updateUIAuth() {
        if (!this.user) {
            this.DOM.loginOverlay.classList.add('active');
            this.DOM.mainPostBtn.disabled = true;
            this.DOM.mainInput.disabled   = true;
            this.DOM.currentUserAvatar.src = 'favicon.svg';
        } else {
            this.DOM.loginOverlay.classList.remove('active');
            this.DOM.mainPostBtn.disabled = false;
            this.DOM.mainInput.disabled   = false;
            this.DOM.currentUserAvatar.src = this.user.avatar_url
                ? this.user.avatar_url
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(this.user.username)}&background=7c3aed&color=fff&size=96`;
        }
    }

    bindEvents() {

        if (this.DOM.mainGifBtn) {
            this.DOM.mainGifBtn.addEventListener('click', () => {
                this.DOM.gifModal.classList.add('active');
                this.DOM.gifSearchInput.focus();
                this.fetchGifs('trending');
            });
        }

        if (this.DOM.gifCloseBtn) {
            this.DOM.gifCloseBtn.addEventListener('click', () => {
                this.DOM.gifModal.classList.remove('active');
            });
            this.DOM.gifModal.addEventListener('click', (e) => {
                if (e.target === this.DOM.gifModal) this.DOM.gifModal.classList.remove('active');
            });
        }

        if (this.DOM.gifSearchInput) {
            let debounceTimer;
            this.DOM.gifSearchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                const q = e.target.value.trim();
                debounceTimer = setTimeout(() => {
                    this.fetchGifs(q ? 'search' : 'trending', q);
                }, 400);
            });
        }

        this.DOM.mainInput.addEventListener('input', () => {
            const len = this.DOM.mainInput.value.length;
            this.DOM.mainCharCount.textContent = `${len}/${this.MAX_CHARS}`;
            this.DOM.mainCharCount.style.color  = len > this.MAX_CHARS ? '#ef4444' : '';
            this.DOM.mainPostBtn.disabled = len === 0 || len > this.MAX_CHARS;
            this.DOM.mainInput.style.height = 'auto';
            this.DOM.mainInput.style.height = this.DOM.mainInput.scrollHeight + 'px';
        });

        this.DOM.mainInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!this.DOM.mainPostBtn.disabled) this.postComment();
            }
        });

        this.DOM.mainPostBtn.addEventListener('click', () => this.postComment());

        this.DOM.showMoreBtn.addEventListener('click', () => {
            this.DOM.listWrapper.classList.add('expanded');
            this.DOM.fadeMask.classList.remove('active');
        });

        this.DOM.list.addEventListener('click', (e) => {
            const replyBtn       = e.target.closest('.reply-btn');
            const delBtn         = e.target.closest('.delete-btn');
            const submitReplyBtn = e.target.closest('.submit-reply-btn');
            const cancelReplyBtn = e.target.closest('.cancel-reply-btn');
            const optionsBtn     = e.target.closest('.options-btn');

            if (optionsBtn) {
                e.stopPropagation();
                const menu = optionsBtn.nextElementSibling;
                const wasActive = menu.classList.contains('active');

                document.querySelectorAll('.comment-dropdown-menu.active').forEach(m => m.classList.remove('active'));

                if (!wasActive) menu.classList.add('active');
                return;
            }

            if (replyBtn) {
                if (!this.user) {
                    if (window.openAuthModal) window.openAuthModal('login');
                    return;
                }
                this.toggleReplyBox(replyBtn.dataset.id);
            }
            if (cancelReplyBtn) {
                this.toggleReplyBox(null);
            }
            if (submitReplyBtn) {
                this.postReply(submitReplyBtn.dataset.parent);
            }
            if (delBtn) {
                e.stopPropagation();
                if (!delBtn.classList.contains('confirming')) {

                    delBtn.classList.add('confirming');
                    delBtn.textContent = 'Confirm?';

                    setTimeout(() => {
                        if (delBtn.classList.contains('confirming')) {
                            delBtn.classList.remove('confirming');
                            delBtn.textContent = 'Delete';
                        }
                    }, 3000);
                } else {

                    this.deleteComment(delBtn.dataset.id);
                }
            }
        });

        document.addEventListener('click', () => {
            document.querySelectorAll('.comment-dropdown-menu.active').forEach(m => m.classList.remove('active'));

            document.querySelectorAll('.delete-btn.confirming').forEach(b => {
                b.classList.remove('confirming');
                b.textContent = 'Delete';
            });
        });
    }

    async fetchComments() {
        this.DOM.list.innerHTML = `
            <div class="comments-loading">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
            </div>`;
        try {
            const r    = await fetch(`/api/comments?anime_id=${encodeURIComponent(this.animeId)}&ep=${encodeURIComponent(this.episodeNum)}`);
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'fetch failed');
            this.comments = data.comments || [];
            this.render();
        } catch (e) {
            console.error('[Comments] fetch error:', e);
            this.DOM.list.innerHTML = `<div class="comments-error">⚠ Could not load comments. Please try refreshing.</div>`;
        }
    }

    render() {
        const total = this.comments.length;
        this.DOM.count.textContent = total === 1 ? '1 Comment' : `${total} Comments`;

        if (total === 0) {
            this.DOM.list.innerHTML = `
                <div class="comments-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <p>No comments yet — start the discussion!</p>
                </div>`;
            this.DOM.fadeMask.classList.remove('active');
            this.DOM.listWrapper.classList.add('expanded');
            return;
        }

        const cmap = new Map();
        this.comments.forEach(c => {
            c.id        = parseInt(c.id, 10);
            c.parent_id = c.parent_id ? parseInt(c.parent_id, 10) : null;

            c.is_deleted = c.is_deleted === 1 || c.is_deleted === '1' || c.is_deleted === true;
            c.is_spoiler = c.is_spoiler === 1 || c.is_spoiler === '1' || c.is_spoiler === true;
            c.children  = [];
            cmap.set(c.id, c);
        });

        const roots = [];
        this.comments.forEach(c => {
            if (c.parent_id && cmap.has(c.parent_id)) {
                cmap.get(c.parent_id).children.push(c);
            } else {
                roots.push(c);
            }
        });

        let html = '';
        roots.forEach(root => { html += this.renderNode(root, 0); });
        this.DOM.list.innerHTML = html;

        const needsCollapse = roots.length > this.SHOW_MORE_THRESHOLD;
        if (needsCollapse && !this.DOM.listWrapper.classList.contains('expanded')) {
            this.DOM.fadeMask.classList.add('active');
        } else {
            this.DOM.fadeMask.classList.remove('active');
            this.DOM.listWrapper.classList.add('expanded');
        }

        this.DOM.showMoreBtn.textContent = `Show All ${total} Comments`;
    }

    renderNode(node, depth) {
        if (node.is_deleted) return '';

        const isOwner = this.user && (this.user.username === node.username);
        const avatar  = (node.avatar_url && node.avatar_url !== '')
            ? node.avatar_url
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(node.username || '?')}&background=7c3aed&color=fff&size=80`;

        const timeStr = this.timeAgo(node.created_at);
        const maxDepth = 4;

        let contentHtml = '';
        if (node.is_deleted) {
            contentHtml = `<p class="comment-body deleted"><em>[Deleted by user]</em></p>`;
        } else {
            let escaped = this.escapeHTML(node.content);
            if (node.is_spoiler) {
                contentHtml = `<div class="comment-body-wrapper">
                    <p class="comment-body spoiler-hidden" onclick="this.parentElement.classList.add('revealed');this.classList.remove('spoiler-hidden');this.classList.add('spoiler-revealed')">${escaped}</p>
                    <div class="spoiler-overlay-msg" onclick="this.parentElement.classList.add('revealed');this.previousElementSibling.classList.remove('spoiler-hidden');this.previousElementSibling.classList.add('spoiler-revealed')">Click to reveal spoiler</div>
                </div>`;
            } else {
                contentHtml = escaped ? `<p class="comment-body">${escaped}</p>` : '';
            }
            if (node.gif_url && !['null', 'none'].includes(node.gif_url.toLowerCase()) && node.gif_url.trim() !== '') {
                contentHtml += `<img src="${node.gif_url}" class="comment-gif-display" loading="lazy">`;
            }
        }

        const controls = node.is_deleted ? '' : `
            <div class="comment-controls">
                <button class="comment-control-btn reply-btn" data-id="${node.id}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                    </svg> Reply
                </button>
                ${isOwner ? `
                <div class="comment-dropdown" tabindex="0">
                    <button class="comment-control-btn options-btn">•••</button>
                    <div class="comment-dropdown-menu">
                        <button class="delete-btn" data-id="${node.id}">Delete</button>
                    </div>
                </div>` : ''}
            </div>`;

        const childrenHtml = (node.children && node.children.length > 0 && depth < maxDepth)
            ? `<div class="comment-replies">${node.children.map(c => this.renderNode(c, depth + 1)).join('')}</div>`
            : '';

        return `
        <div class="comment-item" id="comment-${node.id}">
            <img src="${avatar}" alt="${this.escapeHTML(node.username || '?')}" class="comment-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(node.username || '?')}&background=7c3aed&color=fff'">
            <div class="comment-content">
                <div class="comment-meta">
                    <span class="comment-author">${this.escapeHTML(node.username || 'Unknown')}</span>
                    <span class="comment-time" title="${node.created_at}">${timeStr}</span>
                </div>
                ${contentHtml}
                ${controls}
                <div id="reply-box-${node.id}"></div>
                ${childrenHtml}
            </div>
        </div>`;
    }

    toggleReplyBox(parentId) {

        if (this.activeReplyId) {
            const old = document.getElementById(`reply-box-${this.activeReplyId}`);
            if (old) old.innerHTML = '';
        }
        this.activeReplyId = parentId;
        if (!parentId) return;

        const box = document.getElementById(`reply-box-${parentId}`);
        if (!box) return;

        const avatar = (this.user?.avatar_url && this.user.avatar_url !== '')
            ? this.user.avatar_url
            : `https://ui-avatars.com/api/?name=${encodeURIComponent(this.user?.username || '?')}&background=7c3aed&color=fff&size=80`;

        box.innerHTML = `
            <div class="reply-input-area">
                <img src="${avatar}" alt="You" class="comment-avatar" style="width:32px;height:32px;">
                <div class="comment-input-wrapper">
                    <textarea id="reply-ta-${parentId}" class="comment-textarea" placeholder="Write a reply…" rows="1"></textarea>
                    <div class="comment-actions">
                        <span class="comment-char-count" id="reply-cc-${parentId}">0/${this.MAX_CHARS}</span>
                        <button class="btn btn-ghost btn-sm cancel-reply-btn">Cancel</button>
                        <button class="btn btn-primary btn-sm submit-reply-btn" data-parent="${parentId}">Reply</button>
                    </div>
                </div>
            </div>`;

        const ta = document.getElementById(`reply-ta-${parentId}`);
        const cc = document.getElementById(`reply-cc-${parentId}`);
        if (ta) {
            ta.focus();
            ta.addEventListener('input', () => {
                const len = ta.value.length;
                if (cc) cc.textContent = `${len}/${this.MAX_CHARS}`;
                ta.style.height = 'auto';
                ta.style.height = ta.scrollHeight + 'px';
            });
            ta.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.postReply(parentId);
                }
                if (e.key === 'Escape') this.toggleReplyBox(null);
            });
        }
    }

    async postComment() {
        const text = this.DOM.mainInput.value.trim();
        const isSpoiler = this.DOM.mainSpoiler ? this.DOM.mainSpoiler.checked : false;
        if ((!text && !this.selectedGifUrl) || text.length > this.MAX_CHARS) return;

        this.setPostBtnState(true);
        const ok = await this.apiPost(text, null, isSpoiler, this.selectedGifUrl);
        this.setPostBtnState(false);

        if (ok) {
            this.DOM.mainInput.value = '';
            this.DOM.mainCharCount.textContent = `0/${this.MAX_CHARS}`;
            this.DOM.mainInput.style.height = 'auto';
            if (this.DOM.mainSpoiler) this.DOM.mainSpoiler.checked = false;
            this.selectedGifUrl = null;
            if (this.DOM.mainGifPreview) {
                 this.DOM.mainGifPreview.innerHTML = '';
                 this.DOM.mainGifPreview.style.display = 'none';
            }
            this.DOM.listWrapper.classList.add('expanded');
            await this.fetchComments();
        } else {
            this.showInlineError('Could not post comment. Please try again.');
        }
    }

    async postReply(parentId) {
        const ta = document.getElementById(`reply-ta-${parentId}`);
        const text = ta ? ta.value.trim() : '';
        if (!text || text.length > this.MAX_CHARS) return;

        const btn = document.querySelector(`.submit-reply-btn[data-parent="${parentId}"]`);
        if (btn) { btn.disabled = true; btn.textContent = '...'; }

        const ok = await this.apiPost(text, parentId);
        if (ok) {
            this.activeReplyId = null;
            this.DOM.listWrapper.classList.add('expanded');
            await this.fetchComments();
        } else {
            if (btn) { btn.disabled = false; btn.textContent = 'Reply'; }
            this.showInlineError('Could not post reply.');
        }
    }

    setPostBtnState(loading) {
        this.DOM.mainPostBtn.disabled     = loading;
        this.DOM.mainPostBtn.textContent  = loading ? 'Posting…' : 'Post';
    }

    async apiPost(content, parentId, isSpoiler=false, gifUrl=null) {
        try {
            const r = await fetch('/api/comments', {
                method: 'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('kv_token')}`
                },
                body: JSON.stringify({
                    anime_id:  this.animeId,
                    ep:        this.episodeNum,
                    parent_id: parentId || null,
                    content:   content,
                    is_spoiler: isSpoiler,
                    gif_url: gifUrl
                })
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                console.error('[Comments] POST error:', data.error);
            }
            return r.ok;
        } catch (e) {
            console.error('[Comments] apiPost exception:', e);
            return false;
        }
    }

    async deleteComment(id) {
        try {
            const r = await fetch(`/api/comments/${id}`, {
                method:  'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('kv_token')}` }
            });
            if (r.ok) {
                await this.fetchComments();
            } else {
                this.showInlineError('Could not delete comment.');
            }
        } catch (e) {
            console.error('[Comments] delete error:', e);
        }
    }

    timeAgo(isoString) {
        if (!isoString) return '';

        const cleaned = isoString.replace(' ', 'T').replace(/Z?$/, 'Z');
        const date    = new Date(cleaned);
        if (isNaN(date)) return '';
        const diff    = Math.floor((Date.now() - date) / 1000);
        if (diff < 10)   return 'just now';
        if (diff < 60)   return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    }

    escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    showInlineError(msg) {
        let el = document.getElementById('comments-inline-error');
        if (!el) {
            el = document.createElement('div');
            el.id = 'comments-inline-error';
            el.style.cssText = 'color:#ef4444;font-size:.85rem;padding:8px 0;';
            this.DOM.mainPostBtn.parentNode.appendChild(el);
        }
        el.textContent = msg;
        setTimeout(() => { if (el.parentNode) el.remove(); }, 4000);
    }
}

function bootComments() {
    if (document.getElementById('comments-section')) {
        window.kvComments = new CommentsController();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootComments);
} else {
    bootComments();
}

window.addEventListener('kvAuthChange', async (e) => {
    const ctrl = window.kvComments;
    if (!ctrl) return;

    if (e.detail?.loggedIn && e.detail?.user) {

        ctrl.user = e.detail.user;
    } else if (!e.detail?.loggedIn) {
        ctrl.user = null;
    } else {

        await ctrl.refreshUser();
    }
    ctrl.updateUIAuth();
});
