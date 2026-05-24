
const AUTH_BASE = '';

async function getReCaptchaToken(action) {
    try {

        for (let i = 0; i < 20 && typeof grecaptcha === 'undefined'; i++) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (typeof grecaptcha === 'undefined') return null;
        await new Promise(r => grecaptcha.ready(r));
        return await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
    } catch (e) {
        console.warn('[reCAPTCHA] token error:', e);
        return null;
    }
}

const SQLI_RE = /(\b(select|insert|update|delete|drop|union|exec|cast|convert|declare|xp_|char|nchar|varchar|alter|create|truncate|sleep|benchmark|waitfor|information_schema)\b|--|;|\/\*|\*\/|0x[0-9a-fA-F]+|\bor\b\s+.{0,30}[=<>]|\band\b\s+.{0,30}[=<>])/i;
function hasSQLI(val) { return SQLI_RE.test(val); }

console.log('[Auth] Script loading...');
function runInit() {
    console.log('[Auth] Initializing UI and state...');
    injectAuthUI();
    initAuth();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit);
} else {
    runInit();
}

function injectAuthUI() {

    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.className = 'auth-overlay';
    overlay.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-label="Sign in or Register">
        <button class="auth-modal-close" id="auth-close" aria-label="Close">✕</button>

        <div class="auth-modal-logo">
            <span class="auth-modal-logo-text">KUROVEXA</span>
        </div>

        <div class="auth-tabs">
            <button class="auth-tab active" data-tab="login" id="tab-login">Sign In</button>
            <button class="auth-tab" data-tab="register" id="tab-register">Create Account</button>
        </div>

        <div class="auth-panel active" id="panel-login">
            <div class="auth-error" id="login-error"></div>
            <div class="auth-field">
                <label class="auth-label">Username</label>
                <input class="auth-input" id="login-username" type="text" placeholder="your_username" autocomplete="username" maxlength="15">
            </div>
            <div class="auth-field">
                <label class="auth-label">Password</label>
                <input class="auth-input" id="login-password" type="password" placeholder="••••••••" autocomplete="current-password" maxlength="18">
            </div>
            <button class="auth-submit" id="login-submit">
                <span class="auth-submit-text">Sign In</span>
                <span class="auth-submit-spinner"></span>
            </button>

            <div class="auth-divider">OR</div>

            <button class="auth-anilist-btn" onclick="openAnilistAuth('login')">
                <img src="https://anilist.co/img/icons/icon.svg" style="width:20px;height:20px;" alt="AniList">
                <span>Continue with AniList</span>
            </button>

            <p class="auth-switch">No account? <a id="switch-to-register">Create one</a></p>
        </div>

        <div class="auth-panel" id="panel-register">
            <div class="auth-error" id="register-error"></div>
            <div class="auth-field">
                <label class="auth-label">Username</label>
                <input class="auth-input" id="reg-username" type="text" placeholder="cool_username" autocomplete="username" maxlength="15">
            </div>
            <div class="auth-field">
                <label class="auth-label">Email</label>
                <input class="auth-input" id="reg-email" type="email" placeholder="you@example.com" autocomplete="email" maxlength="20">
            </div>
            <div class="auth-field">
                <label class="auth-label">Password <span style="color:#475569;font-weight:400;text-transform:none;letter-spacing:0">(min 6 characters)</span></label>
                <input class="auth-input" id="reg-password" type="password" placeholder="••••••••" autocomplete="new-password" maxlength="18">
                <div class="auth-pw-bar"><div class="auth-pw-fill" id="pw-fill"></div></div>
            </div>
            <button class="auth-submit" id="register-submit">
                <span class="auth-submit-text">Create Account</span>
                <span class="auth-submit-spinner"></span>
            </button>

            <div class="auth-divider">OR</div>

            <button class="auth-anilist-btn" onclick="openAnilistAuth('register')">
                <img src="https://anilist.co/img/icons/icon.svg" style="width:20px;height:20px;" alt="AniList">
                <span>Continue with AniList</span>
            </button>

            <p class="auth-switch">Already have an account? <a id="switch-to-login">Sign in</a></p>
        </div>

        <div class="auth-recaptcha-terms">
            This site is protected by reCAPTCHA and the Google
            <a href="https://policies.google.com/privacy" target="_blank">Privacy Policy</a> and
            <a href="https://policies.google.com/terms" target="_blank">Terms of Service</a> apply.
        </div>
    </div>`;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) closeAuthModal(); });
    document.getElementById('auth-close').addEventListener('click', closeAuthModal);

    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    document.getElementById('switch-to-register').addEventListener('click', () => switchTab('register'));
    document.getElementById('switch-to-login').addEventListener('click', () => switchTab('login'));

    document.getElementById('login-submit').addEventListener('click', handleLogin);
    document.getElementById('register-submit').addEventListener('click', handleRegister);

    ['login-username', 'login-password'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
    });
    ['reg-username', 'reg-email', 'reg-password'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') handleRegister(); });
    });

    document.getElementById('reg-password').addEventListener('input', e => updatePwStrength(e.target.value));
}

function switchTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('panel-login').classList.toggle('active', tab === 'login');
    document.getElementById('panel-register').classList.toggle('active', tab === 'register');
    clearErrors();
}

function openAuthModal(tab = 'login') {
    switchTab(tab);
    document.getElementById('auth-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
        const el = tab === 'login'
            ? document.getElementById('login-username')
            : document.getElementById('reg-username');
        el?.focus();
    }, 200);
}

function closeAuthModal() {
    document.getElementById('auth-overlay').classList.remove('open');
    document.body.style.overflow = '';
    clearErrors();
}

function showError(panelId, msg) {
    const el = document.getElementById(panelId);
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
}
function clearErrors() {
    document.querySelectorAll('.auth-error').forEach(e => { e.textContent = ''; e.classList.remove('show'); });
    document.querySelectorAll('.auth-input').forEach(i => i.classList.remove('error'));
}

function updatePwStrength(pw) {
    const fill = document.getElementById('pw-fill');
    if (!fill) return;
    const score = [/.{8,}/, /[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
    const w = ['0%', '25%', '45%', '70%', '100%'][score];
    const c = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#7c3aed'][score - 1] || '#334155';
    fill.style.width = pw ? w : '0%';
    fill.style.background = c;
}

async function authFetch(path, body) {
    const r = await fetch(AUTH_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
}

async function handleLogin() {
    clearErrors();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (hasSQLI(username) || hasSQLI(password)) {
        showError('login-error', 'Nice try bozo 😐');
        return;
    }

    if (!username) { showError('login-error', 'Enter your username'); return; }
    if (!password) { showError('login-error', 'Enter your password'); return; }

    setLoading('login-submit', true);
    const recaptchaToken = await getReCaptchaToken('login');
    const { ok, data } = await authFetch('/api/auth/login', { username, password, recaptchaToken });
    setLoading('login-submit', false);

    if (!ok) { showError('login-error', data.error || 'Login failed'); return; }

    localStorage.setItem('kv_token', data.token);
    closeAuthModal();
    await initAuth();
    showAuthToast(`Welcome back, ${data.username}! 👋`);
}

async function handleRegister() {
    clearErrors();
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    if (hasSQLI(username) || hasSQLI(email) || hasSQLI(password)) {
        showError('register-error', 'Nice try bozo 😐');
        return;
    }

    if (!username || username.length < 3) { showError('register-error', 'Username must be at least 3 characters'); return; }
    if (username.length > 15) { showError('register-error', 'Username must be 15 characters or less'); return; }
    if (!email || !email.includes('@')) { showError('register-error', 'Enter a valid email'); return; }
    if (email.length > 20) { showError('register-error', 'Email must be 20 characters or less'); return; }
    if (password.length < 6) { showError('register-error', 'Password must be at least 6 characters'); return; }

    setLoading('register-submit', true);
    const { ok, data } = await authFetch('/api/auth/register', { username, email, password });
    setLoading('register-submit', false);

    if (!ok) { showError('register-error', data.error || 'Registration failed'); return; }

    localStorage.setItem('kv_token', data.token);
    closeAuthModal();
    await initAuth();
    showAuthToast(`Welcome to Kurovexa, ${data.username}! 🎉`);
}

function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle('loading', loading);
}

async function openAnilistAuth(type) {
    const btnId = type === 'login' ? 'login-submit' : 'register-submit';
    setLoading(btnId, true);
    try {
        const token = localStorage.getItem('kv_token') || '';
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const r = await fetch(AUTH_BASE + '/api/auth/anilist/login', { headers });
        const data = await r.json();

        if (data.url) {
            const width = 500, height = 700;
            const left = (window.innerWidth / 2) - (width / 2);
            const top = (window.innerHeight / 2) - (height / 2);
            window.open(data.url, 'Anilist Auth', `width=${width},height=${height},top=${top},left=${left}`);
        }
    } catch (e) {
        showError(`${type}-error`, 'Anilist login temporarily unavailable');
    } finally {
        setLoading(btnId, false);
    }
}

window.addEventListener('message', async (e) => {
    console.log("Kurovexa Auth Message Received:", e.origin, e.data);

    const isLocal = (url) => url.includes('localhost') || url.includes('127.0.0.1');
    const sameOrigin = e.origin === window.location.origin;
    const bothLocal = isLocal(e.origin) && isLocal(window.location.origin);

    if (!sameOrigin && !bothLocal) {
        console.warn("Origin mismatch blocked:", e.origin, "expected:", window.location.origin);
        return;
    }
    if (e.data?.type === 'anilist_logged_in') {
        localStorage.setItem('kv_token', e.data.token);
        closeAuthModal();
        await initAuth();
        showAuthToast(`Welcome via AniList! 🎉`);
    } else if (e.data?.type === 'anilist_connected') {
        if (window.location.pathname.includes('profile')) {
            window.location.reload();
        } else {
            showAuthToast('AniList account linked successfully!');
        }
    }
});

async function initAuth() {
    console.log('[Auth] Running initAuth...');
    const navs = [document.getElementById('auth-nav'), document.getElementById('mobile-auth-nav')].filter(Boolean);
    console.log(`[Auth] Target nav containers found: ${navs.length}`);

    if (!navs.length) {
        console.warn('[Auth] No navigation containers found (auth-nav or mobile-auth-nav)');
        return;
    }

    const token = localStorage.getItem('kv_token');
    if (!token) {
        console.log('[Auth] No token found, rendering Sign In buttons');
        navs.forEach(renderSignInBtn);
        window.dispatchEvent(new CustomEvent('kvAuthChange', { detail: { loggedIn: false } }));
        return;
    }

    console.log('[Auth] Token found, verifying...');
    try {
        const r = await fetch(AUTH_BASE + '/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!r.ok) throw new Error('invalid');
        const user = await r.json();
        console.log(`[Auth] User verified: ${user.username}`);
        window._kvUser = user;
        navs.forEach(nav => renderAuthNav(user, nav));
        window.dispatchEvent(new CustomEvent('kvAuthChange', { detail: { loggedIn: true, user } }));
    } catch (err) {
        console.error('[Auth] Verification failed:', err);
        localStorage.removeItem('kv_token');
        navs.forEach(renderSignInBtn);
        window.dispatchEvent(new CustomEvent('kvAuthChange', { detail: { loggedIn: false } }));
    }
}

function renderSignInBtn(nav) {
    if (!nav) return;
    const isMobile = nav.id === 'mobile-auth-nav';
    const dropId = `auth-drop-guest-${isMobile ? 'mobile' : 'desk'}`;
    nav.innerHTML = `
        <div class="auth-avatar-wrap" ${isMobile ? 'style="margin-bottom:16px;width:100%;"' : ''}>
            <button class="auth-avatar-btn" ${isMobile ? 'style="width:100%;justify-content:space-between;"' : ''} onclick="document.getElementById('${dropId}').classList.toggle('open');event.stopPropagation();" aria-label="Guest profile">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="auth-avatar-circle" style="overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <span style="font-size:0.85rem;font-weight:600;">Guest</span>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6,9 12,15 18,9"/></svg>
            </button>
            <div class="auth-dropdown" id="${dropId}" ${isMobile ? 'style="position:static;margin-top:8px;width:100%;box-shadow:none;border-color:rgba(255,255,255,0.1);"' : ''}>
                <div class="auth-drop-info">
                    <div class="auth-drop-name">Guest</div>
                    <div class="auth-drop-email">Not signed in</div>
                </div>
                <button class="auth-drop-btn profile" onclick="window.location.href='profile.html';">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    My Profile
                </button>
                <button class="auth-drop-btn" onclick="openAuthModal('login');">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10,17 15,12 10,7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                    Sign In
                </button>
            </div>
        </div>`;

    document.addEventListener('click', () => {
        document.getElementById(dropId)?.classList.remove('open');
    }, { once: false });
}

function renderAuthNav(user, nav) {
    if (!nav) return;
    const isMobile = nav.id === 'mobile-auth-nav';
    const dropId = `auth-drop-${isMobile ? 'mobile' : 'desk'}`;

    nav.innerHTML = `
        <div class="auth-avatar-wrap" ${isMobile ? 'style="margin-bottom:16px;width:100%;"' : ''}>
            <button class="auth-avatar-btn" ${isMobile ? 'style="width:100%;justify-content:space-between;"' : ''} onclick="document.getElementById('${dropId}').classList.toggle('open');event.stopPropagation();" aria-label="Account menu">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div class="auth-avatar-circle" style="overflow:hidden; display:flex; align-items:center; justify-content:center;">
                        ${user.avatar_url ? `<img src="${user.avatar_url}" style="width:100%; height:100%; object-fit:cover;">` : (user.initial || user.username[0].toUpperCase())}
                    </div>
                    <span>${user.username}</span>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6,9 12,15 18,9"/></svg>
            </button>
            <div class="auth-dropdown" id="${dropId}" ${isMobile ? 'style="position:static;margin-top:8px;width:100%;box-shadow:none;border-color:rgba(255,255,255,0.1);"' : ''}>
                <div class="auth-drop-info">
                    <div class="auth-drop-name">${user.username}</div>
                    <div class="auth-drop-email">${user.email || ''}</div>
                </div>
                <button class="auth-drop-btn profile" onclick="window.location.href='profile.html';">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    My Profile
                </button>
                <button class="auth-drop-btn logout" onclick="localStorage.removeItem('kv_token');window.location.href='index.html';">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign Out
                </button>
            </div>
        </div>`;

    document.addEventListener('click', () => {
        document.getElementById(dropId)?.classList.remove('open');
    }, { once: false });
}

function showAuthToast(msg) {
    const t = document.createElement('div');
    t.className = 'auth-toast';
    t.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20,6 9,17 4,12"/></svg> ${msg}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

window.openAuthModal  = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.initAuth       = initAuth;
