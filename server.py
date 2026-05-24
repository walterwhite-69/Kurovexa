from flask import Flask, send_from_directory, request, jsonify, make_response
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import urllib.request, json, os, re, datetime, gzip, hashlib, hmac, time, mimetypes, email.utils
import bcrypt
import base64
import jwt as pyjwt
try: from dotenv import load_dotenv; load_dotenv()
except ImportError: pass
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

try:
    import brotli as _brotli
    _BR_AVAILABLE = True
except ImportError:
    _brotli = None
    _BR_AVAILABLE = False

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024
CORS(app)
ROOT = os.path.dirname(os.path.abspath(__file__))

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],
    storage_uri="memory://",
)

_GZIP_TYPES = (
    'text/html', 'text/css', 'text/plain', 'text/javascript',
    'application/javascript', 'application/json', 'application/xml',
    'image/svg+xml', 'application/manifest+json',
)
_GZIP_MIN_BYTES = 512

_STATIC_CACHE = {}
_STATIC_CACHE_MAX_BYTES = 64 * 1024 * 1024

def _is_compressible_mime(mime: str) -> bool:
    if not mime:
        return False
    m = mime.split(';', 1)[0].strip().lower()
    if m in _GZIP_TYPES:
        return True
    return (m.startswith('text/') or 'javascript' in m or 'json' in m
            or 'xml' in m or m == 'image/svg+xml' or 'wasm' in m)

def _build_static_entry(abs_path: str):
    try:
        st = os.stat(abs_path)
    except OSError:
        return None
    with open(abs_path, 'rb') as f:
        raw = f.read()
    etag = '"' + hashlib.md5(raw).hexdigest() + '"'
    mime = mimetypes.guess_type(abs_path)[0] or 'application/octet-stream'
    if mime.startswith('text/') or 'javascript' in mime or 'json' in mime or 'xml' in mime or 'svg' in mime:
        if 'charset' not in mime:
            mime = mime + '; charset=utf-8'
    entry = {
        'mtime_ns': st.st_mtime_ns,
        'size': st.st_size,
        'etag': etag,
        'mime': mime,
        'raw': raw,
        'gzip': None,
        'br': None,
        'last_modified': email.utils.formatdate(st.st_mtime, usegmt=True),
    }
    if _is_compressible_mime(mime) and len(raw) >= _GZIP_MIN_BYTES:
        try:
            gz = gzip.compress(raw, compresslevel=9)
            if len(gz) < len(raw):
                entry['gzip'] = gz
        except Exception:
            pass
        if _BR_AVAILABLE:
            try:
                br = _brotli.compress(raw, quality=5)
                if len(br) < len(raw):
                    entry['br'] = br
            except Exception:
                entry['br'] = None
    return entry

def _get_static_entry(abs_path: str):
    try:
        st = os.stat(abs_path)
    except OSError:
        _STATIC_CACHE.pop(abs_path, None)
        return None
    cached = _STATIC_CACHE.get(abs_path)
    if cached and cached['mtime_ns'] == st.st_mtime_ns and cached['size'] == st.st_size:
        return cached
    entry = _build_static_entry(abs_path)
    if entry is None:
        return None
    total = sum(e['size'] + (len(e['gzip']) if e['gzip'] else 0) + (len(e['br']) if e['br'] else 0)
                for e in _STATIC_CACHE.values())
    if total + entry['size'] > _STATIC_CACHE_MAX_BYTES:
        _STATIC_CACHE.clear()
    _STATIC_CACHE[abs_path] = entry
    return entry

def _negotiate_encoding(accept: str, entry):
    if not accept:
        return None
    a = accept.lower()
    if entry.get('br') is not None and 'br' in a:
        return 'br'
    if entry.get('gzip') is not None and 'gzip' in a:
        return 'gzip'
    return None

def _set_static_cache_control(resp, path: str):
    has_version = any(k.lower().startswith('v') for k in request.args.keys())
    if has_version:
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        return
    lower = path.lower()
    if lower.endswith(('.css', '.js', '.mjs', '.json', '.svg', '.ico',
                       '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
                       '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm')):
        resp.headers['Cache-Control'] = 'public, max-age=86400'
    else:
        resp.headers['Cache-Control'] = 'no-cache'

@app.after_request
def _gzip_text_responses(resp):
    try:
        if resp.headers.get('Content-Encoding'):
            return resp
        if resp.direct_passthrough:
            return resp
        if resp.status_code < 200 or resp.status_code >= 300 or resp.status_code == 204:
            return resp
        accept_enc = request.headers.get('Accept-Encoding', '').lower()
        if not accept_enc:
            return resp
        ctype = (resp.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
        if not any(ctype == t or ctype.startswith(t + ';') for t in _GZIP_TYPES):
            return resp
        data = resp.get_data()
        if len(data) < _GZIP_MIN_BYTES:
            return resp
        body = None
        enc = None
        if _BR_AVAILABLE and 'br' in accept_enc:
            try:
                br = _brotli.compress(data, quality=4)
                if len(br) < len(data):
                    body, enc = br, 'br'
            except Exception:
                body = None
        if body is None and 'gzip' in accept_enc:
            try:
                gz = gzip.compress(data, compresslevel=6)
                if len(gz) < len(data):
                    body, enc = gz, 'gzip'
            except Exception:
                body = None
        if body is None or enc is None:
            return resp
        resp.set_data(body)
        resp.headers['Content-Encoding'] = enc
        resp.headers['Content-Length'] = str(len(body))
        vary = resp.headers.get('Vary')
        if not vary:
            resp.headers['Vary'] = 'Accept-Encoding'
        elif 'accept-encoding' not in vary.lower():
            resp.headers['Vary'] = vary + ', Accept-Encoding'
    except Exception:
        pass
    return resp

API  = os.getenv('ANIME_API_URL', 'YOUR_API_URL')

TURSO_URL   = os.getenv('TURSO_URL', 'YOUR_TURSO_URL')
TURSO_TOKEN = os.getenv('TURSO_TOKEN', 'YOUR_TURSO_TOKEN')
JWT_SECRET  = os.getenv('JWT_SECRET', 'YOUR_JWT_SECRET')
JWT_ALGO   = 'HS256'
RENDER_SALT = os.getenv('RENDER_SALT', 'YOUR_RENDER_SALT')

JWT_EXPIRY_DAYS = 7

def _page_build_token():
    window = str(int(time.time()) // 3600)
    return hmac.new(RENDER_SALT.encode(), window.encode(), hashlib.sha256).hexdigest()

ANILIST_CLIENT_ID = os.getenv("ANILIST_CLIENT_ID", "YOUR_ANILIST_CLIENT_ID")
ANILIST_CLIENT_SECRET = os.getenv("ANILIST_CLIENT_SECRET", "YOUR_ANILIST_CLIENT_SECRET")
ANILIST_REDIRECT_URI = os.getenv("ANILIST_REDIRECT_URI", "YOUR_ANILIST_REDIRECT_URI")

MAL_CLIENT_ID     = os.getenv("MAL_CLIENT_ID",     "YOUR_MAL_CLIENT_ID")
MAL_CLIENT_SECRET = os.getenv("MAL_CLIENT_SECRET",  "YOUR_MAL_CLIENT_SECRET")
MAL_REDIRECT_URI  = os.getenv("MAL_REDIRECT_URI",   "YOUR_MAL_REDIRECT_URI")

def _mal_make_state(user_id, code_verifier):
    import hmac as _hmac, base64 as _b64
    payload = f"{user_id or ''}:{code_verifier}"
    b64 = _b64.urlsafe_b64encode(payload.encode('utf-8')).rstrip(b'=').decode('ascii')
    sig = _hmac.new(JWT_SECRET.encode('utf-8'), b64.encode('ascii'), 'sha256').hexdigest()[:16]
    return f"{b64}.{sig}"

def _mal_parse_state(state):
    import hmac as _hmac, base64 as _b64
    try:
        b64, sig = state.rsplit('.', 1)
    except ValueError:
        return None, None
    expected = _hmac.new(JWT_SECRET.encode('utf-8'), b64.encode('ascii'), 'sha256').hexdigest()[:16]
    if not _hmac.compare_digest(sig, expected):
        return None, None
    try:
        decoded = _b64.urlsafe_b64decode(b64 + '=' * (-len(b64) % 4)).decode('utf-8')
        uid, cv = decoded.split(':', 1)
        return uid or None, cv
    except Exception:
        return None, None

RECAPTCHA_SECRET = os.getenv('RECAPTCHA_SECRET', '')

TVDB_API_KEY = os.getenv('TVDB_API_KEY', 'YOUR_TVDB_API_KEY')
_tvdb_token = None
_tvdb_token_expiry = 0


def get_tvdb_token():
    global _tvdb_token, _tvdb_token_expiry
    if _tvdb_token and time.time() < _tvdb_token_expiry:
        return _tvdb_token
    req = urllib.request.Request(
        'https://api4.thetvdb.com/v4/login',
        data=json.dumps({'apikey': TVDB_API_KEY}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'Kurovexa/1.0'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        _tvdb_token = json.loads(r.read())['data']['token']
    _tvdb_token_expiry = time.time() + 82800
    return _tvdb_token

_key_material = (JWT_SECRET + ':kurovexa-aes-v1').encode('utf-8')
SESSION_AES_KEY = hashlib.sha256(_key_material).digest()
SESSION_AES_B64 = base64.b64encode(SESSION_AES_KEY).decode('utf-8')
print(f"  [SECURITY] AES session key derived (deterministic, from JWT_SECRET)")

def encrypt_payload(data: bytes) -> str:
    """Encrypts raw bytes using the AES-GCM session key and returns a base64 string."""
    aesgcm = AESGCM(SESSION_AES_KEY)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, data, None)
    return base64.b64encode(nonce + ct).decode('utf-8')

def decrypt_payload(b64_str: str) -> bytes:
    """Decrypts a base64 AES-GCM string using the session key."""
    raw = base64.b64decode(b64_str)
    nonce, ct = raw[:12], raw[12:]
    aesgcm = AESGCM(SESSION_AES_KEY)
    return aesgcm.decrypt(nonce, ct, None)

@app.route('/api/health')
def health_check():
    return jsonify({
        "status": "online",
        "backend": "server.py",
        "turso": "ready" if TURSO_URL else "not configured"
    }), 200

@app.route('/api/pbt')
def page_build_token_endpoint():
    return jsonify({'t': _page_build_token()}), 200

def get_base_url():
    """Detect the appropriate base URL for redirects."""
    forwarded_host = request.headers.get('X-Forwarded-Host', '')
    host = forwarded_host.split(',')[0].strip() if forwarded_host else request.headers.get('Host', 'localhost:5500')
    proto = request.headers.get('X-Forwarded-Proto', '')
    if not proto:
        proto = 'https' if ('replit' in host or request.is_secure) else 'http'
    else:
        proto = proto.split(',')[0].strip()
    return f"{proto}://{host}"

def get_mal_redirect_uri():
    """Get the correct MAL redirect URI for the current environment."""
    replit_domains = os.getenv('REPLIT_DOMAINS', '')
    if replit_domains:
        domain = replit_domains.split(',')[0].strip()
        return f"https://{domain}/api/auth/mal/callback"
    explicit = os.getenv('MAL_REDIRECT_URI', '')
    if explicit:
        return explicit
    return get_base_url() + '/api/auth/mal/callback'

def verify_recaptcha(token, action=None, min_score=0.5):
    """Verify reCAPTCHA v3 token with Google. Returns True if valid, False otherwise."""
    if not RECAPTCHA_SECRET:
        return True
    if not token:
        print('[reCAPTCHA] Warning: No token received — skipping (script may not be loaded)')
        return True
    try:
        import urllib.parse
        params = urllib.parse.urlencode({'secret': RECAPTCHA_SECRET, 'response': token}).encode()
        req = urllib.request.Request('https://www.google.com/recaptcha/api/siteverify',
                                     data=params, method='POST')
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read())
        if not result.get('success'):
            return False
        score = result.get('score', 0)
        if score < min_score:
            print(f'[reCAPTCHA] Low score: {score} for action={result.get("action")}')
            return False
        return True
    except Exception as e:
        print(f'[reCAPTCHA] Verification error: {e}')
        return True

_SQLI = re.compile(
    r"((select|insert|update|delete|drop|union|exec|cast|convert|declare|xp_|char|nchar"
    r"|varchar|alter|create|truncate|sleep|benchmark|waitfor|information_schema)"
    r"|--|;|/\*|\*/|0x[0-9a-fA-F]+"
    r"|\bor\b\s+.{0,30}[=<>]"
    r"|\band\b\s+.{0,30}[=<>]"
    r"|'\s*(or|and)\s*'[^']*'\s*=\s*'[^']*'"
    r"|(\d+)\s*=\s*\2)",
    re.IGNORECASE | re.DOTALL
)

def check_sqli(*values):
    for v in values:
        if v and _SQLI.search(str(v)):
            return True
    return False

def _turso_param(p):
    """Convert a Python value to a Turso typed argument."""
    if p is None:
        return {"type": "null"}
    if isinstance(p, bool):
        return {"type": "integer", "value": str(int(p))}
    if isinstance(p, int):
        return {"type": "integer", "value": str(p)}
    if isinstance(p, float):
        return {"type": "float", "value": str(p)}
    return {"type": "text", "value": str(p)}

def turso_exec(sql, params=None):
    """Execute a parameterised SQL statement via Turso HTTP API."""
    stmt = {"sql": sql}
    if params:
        stmt["args"] = [_turso_param(p) for p in params]
    payload = json.dumps({"requests": [{"type": "execute", "stmt": stmt},
                                        {"type": "close"}]}).encode()
    req = urllib.request.Request(
        f"{TURSO_URL}/v2/pipeline",
        data=payload,
        headers={
            "Authorization": f"Bearer {TURSO_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def turso_query(sql, params=None):
    """Execute a SELECT and return list-of-dicts rows.
    Safely handles Turso null columns (type='null', no 'value' key).
    """
    result = turso_exec(sql, params)
    try:
        res = result["results"][0]["response"]["result"]
        cols = [c["name"] for c in res["cols"]]
        def _val(v):
            if v.get("type") == "null":
                return None
            return v.get("value")
        return [dict(zip(cols, [_val(v) for v in row])) for row in res["rows"]]
    except Exception as _qe:
        print(f"  [turso_query] ERROR: {_qe!r}")
        print(f"  [turso_query] raw result: {str(result)[:300]}")
        return []

def init_db():
    turso_exec("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            email TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    try: turso_exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''")
    except Exception: pass
    try: turso_exec("ALTER TABLE users ADD COLUMN bg_url TEXT DEFAULT ''")
    except Exception: pass

    try: turso_exec("ALTER TABLE users ADD COLUMN anilist_token TEXT DEFAULT ''")
    except Exception: pass
    try: turso_exec("ALTER TABLE users ADD COLUMN anilist_username TEXT DEFAULT ''")
    except Exception: pass
    try: turso_exec("ALTER TABLE users ADD COLUMN anilist_id INTEGER DEFAULT 0")
    except Exception: pass

    try: turso_exec("ALTER TABLE users ADD COLUMN mal_access_token TEXT DEFAULT ''")
    except Exception: pass
    try: turso_exec("ALTER TABLE users ADD COLUMN mal_refresh_token TEXT DEFAULT ''")
    except Exception: pass
    try: turso_exec("ALTER TABLE users ADD COLUMN mal_id INTEGER DEFAULT 0")
    except Exception: pass
    try: turso_exec("ALTER TABLE users ADD COLUMN mal_username TEXT DEFAULT ''")
    except Exception: pass
    try: turso_exec("ALTER TABLE users ADD COLUMN tracking_mode TEXT DEFAULT 'none'")
    except Exception: pass

    turso_exec("""
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            anime_id TEXT NOT NULL,
            episode TEXT NOT NULL,
            parent_id INTEGER DEFAULT NULL,
            content TEXT NOT NULL,
            is_deleted INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    """)

    turso_exec("""
        CREATE TABLE IF NOT EXISTS kv_lists (
            user_id TEXT NOT NULL,
            media_id TEXT NOT NULL,
            title TEXT DEFAULT '',
            poster TEXT DEFAULT '',
            status TEXT DEFAULT 'Planning',
            added_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, media_id)
        )
    """)

try:
    init_db()
    print("  [DB] Turso connected & users table ready")
except Exception as e:
    print(f"  [DB] Warning: {e}")

def make_token(user_id, username, email):
    payload = {
        "sub": str(user_id),
        "username": username,
        "email": email,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=JWT_EXPIRY_DAYS),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def verify_token(token):
    return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])

_SAFE_URL_RE = re.compile(r'^https?://[a-zA-Z0-9\-._~:/?#\[\]@!$&\'()*+,;=%]{1,512}$')

def _validate_url(url):
    if not url:
        return False
    if len(url) > 512:
        return False
    return bool(_SAFE_URL_RE.match(url))

_IMGPROXY_ALLOWLIST = {
    'static.crunchyroll.com', 'cdn.myanimelist.net', 'img.anili.st',
    'img1.ak.crunchyroll.com', 's4.anilist.co', 'media.kitsu.io',
    'artworks.thetvdb.com', 'image.tmdb.org', 'serveproxy.com',
    'i.imgur.com', 'cdn.discordapp.com', 'media.tenor.com',
    'i.giphy.com', 'cdn.anilist.co', 'uploads.mangadex.org',
    'api.mangadex.org', 'catbox.moe', 'files.catbox.moe',
}

_GIF_ALLOWLIST = {
    'media.tenor.com', 'c.tenor.com', 'media1.tenor.com',
    'media2.tenor.com', 'media3.tenor.com',
    'i.giphy.com', 'media.giphy.com', 'media0.giphy.com',
    'media1.giphy.com', 'media2.giphy.com',
    'i.imgur.com', 'files.catbox.moe',
}

@app.route('/api/auth/register', methods=['POST'])
@limiter.limit("10 per hour")
def register():
    try:
        data = request.get_json() or {}
        username = (data.get('username') or '').strip()
        email    = (data.get('email')    or '').strip().lower()
        password = (data.get('password') or '').strip()
        if check_sqli(username, email, password):
            return jsonify({"error": "Nice try bozo, shit isnt vulneranle in 2026"}), 400

        if not username or len(username) < 3:
            return jsonify({"error": "Username must be at least 3 characters"}), 400
        if not re.match(r'^[a-zA-Z0-9_.-]{3,15}$', username):
            return jsonify({"error": "Username can only contain letters, numbers, _, - and . (max 15 characters)"}), 400
        if not email or not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            return jsonify({"error": "Invalid email address"}), 400
        if len(email) > 20:
            return jsonify({"error": "Email address is too long (max 20 characters)"}), 400
        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400
        if len(password) > 18:
            return jsonify({"error": "Password too long (max 18 characters)"}), 400

        existing = turso_query("SELECT id FROM users WHERE username = ? OR email = ?", [username, email])
        if existing:

            by_user  = turso_query("SELECT id FROM users WHERE username = ?", [username])
            if by_user:
                return jsonify({"error": "Username is already taken"}), 409
            return jsonify({"error": "Email is already registered"}), 409

        pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
        default_avatar = 'https://serveproxy.com/url?url=https://static.crunchyroll.com/assets/avatar/170x170/bluelock_bachira_teaser_avatar.png'
        default_bg = 'https://serveproxy.com/url?url=https://static.crunchyroll.com/assets/wallpaper/360x115/bluelock_background.png'
        turso_exec(
            "INSERT INTO users (username, email, password_hash, avatar_url, bg_url) VALUES (?, ?, ?, ?, ?)",
            [username, email, pw_hash, default_avatar, default_bg]
        )
        new_user = turso_query("SELECT id FROM users WHERE username = ?", [username])
        user_id  = new_user[0]["id"] if new_user else 0

        token = make_token(user_id, username, email)
        return jsonify({"token": token, "username": username, "email": email}), 201
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/auth/login', methods=['POST'])
@limiter.limit("20 per hour")
def login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    recaptcha_token = data.get('recaptchaToken')

    if not verify_recaptcha(recaptcha_token, action='login'):
        return jsonify({"error": "Security check failed. Please try again."}), 400

    if check_sqli(username, password):
        return jsonify({"error": "Nice try bozo"}), 400

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    rows = turso_query("SELECT id, username, email, password_hash FROM users WHERE username = ?", [username])
    if not rows:
        return jsonify({"error": "Invalid username or password"}), 401

    user = rows[0]
    if not bcrypt.checkpw(password.encode(), user["password_hash"].encode()):
        return jsonify({"error": "Invalid username or password"}), 401

    token = make_token(user["id"], user["username"], user["email"])
    return jsonify({"token": token, "username": user["username"], "email": user["email"]}), 200

@app.route('/api/auth/me', methods=['GET'])
def me():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        payload = verify_token(auth[7:])
        user_id = payload["sub"]

        rows = turso_query("SELECT avatar_url, bg_url, anilist_username, mal_username, tracking_mode FROM users WHERE id = ?", [user_id])
        avatar_url, bg_url, anilist_username, mal_username, tracking_mode = "", "", "", "", "none"
        if rows:
            avatar_url      = rows[0].get("avatar_url", "")
            bg_url          = rows[0].get("bg_url", "")
            anilist_username = rows[0].get("anilist_username", "")
            mal_username    = rows[0].get("mal_username", "")
            tracking_mode   = rows[0].get("tracking_mode", "none") or "none"

        return jsonify({
            "username":        payload["username"],
            "email":           payload["email"],
            "initial":         payload["username"][0].upper(),
            "avatar_url":      avatar_url,
            "bg_url":          bg_url,
            "anilist_username": anilist_username,
            "mal_username":    mal_username,
            "mal_connected":   bool(mal_username),
            "tracking_mode":   tracking_mode
        }), 200
    except pyjwt.ExpiredSignatureError:
        print("[AUTH] Token expired")
        return jsonify({"error": "Session expired"}), 401
    except Exception as e:
        print(f"[AUTH] Token invalid: {str(e)}")
        return jsonify({"error": "Invalid token"}), 401

def parse_proxy_list(filename):
    path = os.path.join(ROOT, filename)
    if not os.path.exists(path): return {}
    res = {}
    current_category = "General"
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            if line.startswith('http'):
                res.setdefault(current_category, []).append(line)
            else:
                current_category = line
    return res

@app.route('/api/auth/assets', methods=['GET'])
def get_assets():
    avatars = parse_proxy_list('crunchyroll_avatars_full_list_proxy.txt')
    bgs = parse_proxy_list('crunchyroll_backgrounds_full_list_proxy.txt')
    return jsonify({"avatars": avatars, "backgrounds": bgs}), 200

@app.route('/api/auth/profile', methods=['POST'])
@limiter.limit("30 per hour")
def update_profile():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        payload = verify_token(auth[7:])
        user_id = payload["sub"]

        data = request.get_json() or {}
        avatar_url = data.get('avatar_url')
        bg_url = data.get('bg_url')

        updates, params = [], []
        if avatar_url is not None:
            if not _validate_url(avatar_url):
                return jsonify({"error": "Invalid avatar URL"}), 400
            try:
                import urllib.parse as _up
                _host = _up.urlparse(avatar_url).hostname or ''
                _host = _host.lower()
                if not any(_host == d or _host.endswith('.' + d) for d in _IMGPROXY_ALLOWLIST):
                    return jsonify({"error": "Avatar URL domain not allowed"}), 400
            except Exception:
                return jsonify({"error": "Invalid avatar URL"}), 400
            updates.append("avatar_url = ?")
            params.append(avatar_url)
        if bg_url is not None:
            if not _validate_url(bg_url):
                return jsonify({"error": "Invalid background URL"}), 400
            try:
                import urllib.parse as _up
                _host = _up.urlparse(bg_url).hostname or ''
                _host = _host.lower()
                if not any(_host == d or _host.endswith('.' + d) for d in _IMGPROXY_ALLOWLIST):
                    return jsonify({"error": "Background URL domain not allowed"}), 400
            except Exception:
                return jsonify({"error": "Invalid background URL"}), 400
            updates.append("bg_url = ?")
            params.append(bg_url)

        if updates:
            params.append(user_id)
            turso_exec(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)

        return jsonify({"success": True}), 200
    except pyjwt.ExpiredSignatureError:
        return jsonify({"error": "Session expired"}), 401
    except Exception:
        return jsonify({"error": "Update failed"}), 401

@app.route('/api/mylist', methods=['GET'])
def get_mylist():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        payload = verify_token(auth[7:])
        user_id = payload["sub"]
        rows = turso_query(
            "SELECT media_id, title, poster, status, added_at FROM kv_lists WHERE user_id = ? ORDER BY added_at DESC",
            [user_id]
        )
        return jsonify({"list": rows or []})
    except Exception:
        return jsonify({"error": "Invalid token"}), 401

@app.route('/api/mylist', methods=['POST'])
@limiter.limit("120 per hour")
def save_mylist():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        payload = verify_token(auth[7:])
        user_id = payload["sub"]
        data = request.get_json() or {}
        media_id = str(data.get('media_id', '')).strip()
        title    = str(data.get('title', '')).strip()[:200]
        poster   = str(data.get('poster', '')).strip()[:500]
        status   = str(data.get('status', 'Planning')).strip()
        if status not in ('Watching', 'Planning', 'Completed', 'Dropped', 'Paused'):
            status = 'Planning'
        if not media_id:
            return jsonify({"error": "media_id required"}), 400
        turso_exec(
            "INSERT OR REPLACE INTO kv_lists (user_id, media_id, title, poster, status, added_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
            [user_id, media_id, title, poster, status]
        )
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"error": "Invalid token"}), 401

@app.route('/api/mylist/<media_id>', methods=['DELETE'])
def delete_mylist(media_id):
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        payload = verify_token(auth[7:])
        user_id = payload["sub"]
        turso_exec("DELETE FROM kv_lists WHERE user_id = ? AND media_id = ?", [user_id, str(media_id)])
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"error": "Invalid token"}), 401

@app.route('/api/auth/anilist/login', methods=['GET'])
def anilist_login():
    auth = request.headers.get('Authorization', '')
    jwt_token = auth[7:] if auth.startswith('Bearer ') else 'none'

    redirect_uri = os.getenv("ANILIST_REDIRECT_URI")
    if not redirect_uri or 'http' not in redirect_uri:
        redirect_uri = f"{get_base_url()}/api/auth/anilist/callback"

    url = f"https://anilist.co/api/v2/oauth/authorize?client_id={ANILIST_CLIENT_ID}&redirect_uri={urllib.parse.quote(redirect_uri, safe='')}&response_type=code&state={jwt_token}"
    return jsonify({"url": url})

@app.route('/api/auth/anilist/callback', methods=['GET'])
def anilist_callback():
    code = request.args.get('code')
    state = request.args.get('state')

    if not code or not state:
        return "Missing code or state", 400

    user_id = None
    if state != 'none':
        try:
            payload = verify_token(state)
            user_id = payload["sub"]
        except Exception:
            return "Invalid session", 401

    data = urllib.parse.urlencode({
        'grant_type': 'authorization_code',
        'client_id': ANILIST_CLIENT_ID,
        'client_secret': ANILIST_CLIENT_SECRET,
        'redirect_uri': ANILIST_REDIRECT_URI,
        'code': code
    }).encode('utf-8')

    req = urllib.request.Request("https://anilist.co/api/v2/oauth/token", data=data, headers={
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    try:
        with urllib.request.urlopen(req) as response:
            res = json.loads(response.read())
            access_token = res.get('access_token')
    except Exception as e:
        return f"Failed to get token: {e}", 400

    query = '''
    query {
      Viewer {
        id
        name
      }
    }
    '''
    req_graphql = urllib.request.Request('https://graphql.anilist.co',
        data=json.dumps({'query': query}).encode('utf-8'),
        headers={
            'Authorization': 'Bearer ' + access_token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }, method='POST')

    try:
        with urllib.request.urlopen(req_graphql) as response:
            viewer_data = json.loads(response.read())
            viewer = viewer_data['data']['Viewer']
            anilist_id = viewer['id']
            anilist_name = viewer['name']
    except Exception as e:
        return f"Failed to get AniList user info: {e}", 400

    if user_id:
        turso_exec("UPDATE users SET anilist_token = ?, anilist_id = ?, anilist_username = ? WHERE id = ?",
                   [access_token, anilist_id, anilist_name, user_id])
        return f"""
        <!DOCTYPE html><html><head><title>Linking AniList...</title>
        <style>
            body {{ background: #0b0f19; color: white; font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
            .card {{ background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 32px; border-radius: 16px; text-align: center; backdrop-filter: blur(10px); }}
            .loader {{ border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #7c3aed; border-radius: 50%; width: 32px; height: 32px; animation: spin 1s linear infinite; margin: 0 auto 16px; }}
            @keyframes spin {{ 0% {{ transform: rotate(0deg); }} 100% {{ transform: rotate(360deg); }} }}
        </style>
        </head>
        <body>
            <div class="card">
                <div class="loader"></div>
                <h2 style="margin:0; font-size: 1.2rem; font-weight: 500;">Linking AniList...</h2>
                <p style="opacity:0.6; font-size: 0.9rem; margin-top: 8px;">Connecting your profile now.</p>
            </div>
            <script>
                try {{
                    if (window.opener) {{
                        console.log("Notifying opener of successful connection...");
                        window.opener.postMessage({{type: 'anilist_connected'}}, '*');
                        setTimeout(() => window.close(), 1000);
                    }} else {{
                        setTimeout(() => window.location.href = '/profile.html', 1500);
                    }}
                }} catch (e) {{
                    console.error(e);
                    setTimeout(() => window.location.href = '/profile.html', 1500);
                }}
            </script>
        </body></html>
        """

    rows = turso_query("SELECT id, username, email FROM users WHERE anilist_id = ?", [anilist_id])
    if rows:
        user_id = rows[0]["id"]
        turso_exec("UPDATE users SET anilist_token = ?, anilist_username = ? WHERE id = ?", [access_token, anilist_name, user_id])
        username = rows[0]["username"]
        email = rows[0]["email"]
    else:
        username = anilist_name
        email = f"{anilist_id}@anilist.local"
        turso_exec("INSERT INTO users (username, email, password_hash, anilist_token, anilist_id, anilist_username) VALUES (?, ?, 'ANILIST_OAUTH', ?, ?, ?)",
                   [username, email, access_token, anilist_id, anilist_name])
        rows = turso_query("SELECT id FROM users WHERE anilist_id = ?", [anilist_id])
        user_id = rows[0]["id"]

    token = make_token(user_id, username, email)
    return f"""
    <!DOCTYPE html><html><head><title>Login Successful</title>
    <style>
        body {{ background: #0b0f19; color: white; font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
        .card {{ background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 32px; border-radius: 16px; text-align: center; backdrop-filter: blur(10px); }}
        .loader {{ border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #7c3aed; border-radius: 50%; width: 32px; height: 32px; animation: spin 1s linear infinite; margin: 0 auto 16px; }}
        @keyframes spin {{ 0% {{ transform: rotate(0deg); }} 100% {{ transform: rotate(360deg); }} }}
    </style>
    </head>
    <body>
        <div class="card">
            <div class="loader"></div>
            <h2 style="margin:0; font-size: 1.2rem; font-weight: 500;">Login Successful</h2>
            <p style="opacity:0.6; font-size: 0.9rem; margin-top: 8px;">Authenticating with Kurovexa...</p>
        </div>
        <script>
            try {{
                if (window.opener) {{
                    console.log("Sending token to main window...");
                    window.opener.postMessage({{type: 'anilist_logged_in', token: '{token}'}}, '*');
                    setTimeout(() => window.close(), 1000);
                }} else {{
                    console.warn("Opener lost. Setting token manually...");
                    localStorage.setItem('kv_token', '{token}');
                    setTimeout(() => window.location.href = '/index.html', 1500);
                }}
            }} catch (e) {{
                console.error(e);
                localStorage.setItem('kv_token', '{token}');
                setTimeout(() => window.location.href = '/index.html', 1500);
            }}
        </script>
    </body></html>
    """

def get_anilist_auth(user_id):
    rows = turso_query("SELECT anilist_token, anilist_id FROM users WHERE id = ?", [user_id])
    if not rows or not rows[0].get("anilist_token"):
        return None
    return rows[0]

@app.route('/api/auth/anilist/disconnect', methods=['POST'])
def anilist_disconnect():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
    except Exception:
        return jsonify({"error": "Invalid token"}), 401
    turso_exec("UPDATE users SET anilist_token='', anilist_id=0, anilist_username='' WHERE id=?", [user_id])
    return jsonify({"ok": True})

@app.route('/api/auth/mal/login', methods=['GET'])
def mal_login():
    auth = request.headers.get('Authorization', '')
    user_id = None
    if auth.startswith('Bearer '):
        try:
            user_id = verify_token(auth[7:])["sub"]
        except Exception:
            pass

    import os as _os, base64 as _b64
    cv_bytes = _os.urandom(32)
    cv = _b64.urlsafe_b64encode(cv_bytes).rstrip(b'=').decode('ascii')

    state = _mal_make_state(user_id, cv)

    url = (
        f"https://myanimelist.net/v1/oauth2/authorize"
        f"?response_type=code"
        f"&client_id={MAL_CLIENT_ID}"
        f"&redirect_uri={urllib.parse.quote(MAL_REDIRECT_URI, safe='')}"
        f"&state={urllib.parse.quote(state, safe='')}"
        f"&code_challenge={cv}"
        f"&code_challenge_method=plain"
    )
    return jsonify({"url": url})

@app.route('/api/auth/mal/callback', methods=['GET'])
def mal_callback():
    code  = request.args.get('code')
    state = request.args.get('state')

    if not code or not state:
        return "Invalid or expired session", 400

    user_id, code_verifier = _mal_parse_state(state)
    if not code_verifier:
        return "Invalid or expired session", 400

    data = urllib.parse.urlencode({
        'client_id':     MAL_CLIENT_ID,
        'client_secret': MAL_CLIENT_SECRET,
        'grant_type':    'authorization_code',
        'code':          code,
        'redirect_uri':  MAL_REDIRECT_URI,
        'code_verifier': code_verifier,
    }).encode()

    req = urllib.request.Request(
        'https://myanimelist.net/v1/oauth2/token',
        data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            tokens = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        return f"Token exchange failed ({e.code}): {body} [redirect_uri used: {MAL_REDIRECT_URI}]", 400
    except Exception as e:
        return f"Token exchange failed: {e}", 400

    access_token  = tokens.get('access_token')
    refresh_token = tokens.get('refresh_token', '')

    user_req = urllib.request.Request(
        'https://api.myanimelist.net/v2/users/@me',
        headers={'Authorization': f'Bearer {access_token}', 'Accept': 'application/json'}
    )
    try:
        with urllib.request.urlopen(user_req, timeout=10) as r:
            mal_user = json.loads(r.read())
    except Exception as e:
        return f"Failed to get MAL user info: {e}", 400

    mal_id       = mal_user.get('id')
    mal_username = mal_user.get('name', '')

    if user_id:
        turso_exec(
            "UPDATE users SET mal_access_token=?, mal_refresh_token=?, mal_id=?, mal_username=? WHERE id=?",
            [access_token, refresh_token, mal_id, mal_username, user_id]
        )
        return f"""<!DOCTYPE html><html><head><title>Linking MAL...</title>
        <style>body{{background:#0b0f19;color:white;font-family:'Outfit',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}}
        .card{{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:32px;border-radius:16px;text-align:center;}}
        .loader{{border:3px solid rgba(255,255,255,0.1);border-top:3px solid #7c3aed;border-radius:50%;width:32px;height:32px;animation:spin 1s linear infinite;margin:0 auto 16px;}}
        @keyframes spin{{0%{{transform:rotate(0deg);}}100%{{transform:rotate(360deg);}}}}</style>
        </head><body><div class="card"><div class="loader"></div>
        <h2 style="margin:0;font-size:1.2rem;font-weight:500;">Linking MyAnimeList...</h2>
        <p style="opacity:0.6;font-size:0.9rem;margin-top:8px;">Connecting your profile now.</p></div>
        <script>try{{if(window.opener){{window.opener.postMessage({{type:'mal_connected'}},'*');setTimeout(()=>window.close(),1000);}}else{{setTimeout(()=>window.location.href='/profile.html',1500);}}}}catch(e){{setTimeout(()=>window.location.href='/profile.html',1500);}}</script>
        </body></html>"""

    rows = turso_query("SELECT id, username, email FROM users WHERE mal_id=?", [mal_id])
    if rows:
        user_id  = rows[0]["id"]
        turso_exec("UPDATE users SET mal_access_token=?, mal_refresh_token=?, mal_username=? WHERE id=?",
                   [access_token, refresh_token, mal_username, user_id])
        username = rows[0]["username"]
        email    = rows[0]["email"]
    else:
        username = mal_username
        email    = f"{mal_id}@mal.local"
        turso_exec(
            "INSERT INTO users (username, email, password_hash, mal_access_token, mal_refresh_token, mal_id, mal_username) VALUES (?,?,?,?,?,?,?)",
            [username, email, 'MAL_OAUTH', access_token, refresh_token, mal_id, mal_username]
        )
        rows    = turso_query("SELECT id FROM users WHERE mal_id=?", [mal_id])
        user_id = rows[0]["id"]

    token = make_token(user_id, username, email)
    return f"""<!DOCTYPE html><html><head><title>Login Successful</title>
    <style>body{{background:#0b0f19;color:white;font-family:'Outfit',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}}
    .card{{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:32px;border-radius:16px;text-align:center;}}
    .loader{{border:3px solid rgba(255,255,255,0.1);border-top:3px solid #7c3aed;border-radius:50%;width:32px;height:32px;animation:spin 1s linear infinite;margin:0 auto 16px;}}
    @keyframes spin{{0%{{transform:rotate(0deg);}}100%{{transform:rotate(360deg);}}}}</style>
    </head><body><div class="card"><div class="loader"></div>
    <h2 style="margin:0;font-size:1.2rem;font-weight:500;">Login Successful</h2>
    <p style="opacity:0.6;font-size:0.9rem;margin-top:8px;">Authenticating with Kurovexa...</p></div>
    <script>try{{if(window.opener){{window.opener.postMessage({{type:'mal_logged_in',token:'{token}'}},'*');setTimeout(()=>window.close(),1000);}}else{{localStorage.setItem('kv_token','{token}');setTimeout(()=>window.location.href='/index.html',1500);}}}}catch(e){{localStorage.setItem('kv_token','{token}');setTimeout(()=>window.location.href='/index.html',1500);}}</script>
    </body></html>"""

@app.route('/api/auth/mal/disconnect', methods=['POST'])
def mal_disconnect():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
    except Exception:
        return jsonify({"error": "Invalid token"}), 401
    turso_exec("UPDATE users SET mal_access_token='', mal_refresh_token='', mal_id=0, mal_username='' WHERE id=?", [user_id])
    return jsonify({"ok": True})

def _mal_refresh(user_id):
    rows = turso_query("SELECT mal_refresh_token FROM users WHERE id=?", [user_id])
    if not rows or not rows[0].get("mal_refresh_token"):
        return None
    rf = rows[0]["mal_refresh_token"]
    data = urllib.parse.urlencode({
        'client_id':     MAL_CLIENT_ID,
        'client_secret': MAL_CLIENT_SECRET,
        'grant_type':    'refresh_token',
        'refresh_token': rf,
    }).encode()
    req = urllib.request.Request(
        'https://myanimelist.net/v1/oauth2/token',
        data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            tokens = json.loads(r.read())
        at = tokens.get('access_token')
        rt = tokens.get('refresh_token', rf)
        turso_exec("UPDATE users SET mal_access_token=?, mal_refresh_token=? WHERE id=?", [at, rt, user_id])
        return at
    except Exception:
        return None

@app.route('/api/mal/save', methods=['POST'])
def mal_save():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
    except Exception:
        return jsonify({"error": "Invalid token"}), 401

    body       = request.get_json(force=True) or {}
    anime_id   = body.get('animeId') or body.get('anime_id')
    status     = body.get('status', 'watching')
    progress   = body.get('progress')
    score      = body.get('score')
    start_date = body.get('start_date')
    finish_date = body.get('finish_date')

    if not anime_id:
        return jsonify({"error": "animeId required"}), 400

    _STATUS_MAP = {
        'CURRENT': 'watching', 'WATCHING': 'watching',
        'COMPLETED': 'completed', 'DROPPED': 'dropped',
        'PAUSED': 'on_hold', 'PLANNING': 'plan_to_watch',
        'REPEATING': 'rewatching',
    }
    mal_status = _STATUS_MAP.get(str(status).upper(), status.lower())

    rows = turso_query("SELECT mal_access_token FROM users WHERE id=?", [user_id])
    if not rows or not rows[0].get("mal_access_token"):
        return jsonify({"error": "MAL not connected"}), 400
    access_token = rows[0]["mal_access_token"]

    def _do_update(token):
        fields = {'status': mal_status}
        if progress is not None:
            fields['num_watched_episodes'] = int(progress)
        if score is not None:
            fields['score'] = int(score)
        if start_date:
            fields['start_date'] = str(start_date)
        if finish_date:
            fields['finish_date'] = str(finish_date)
        body_enc = urllib.parse.urlencode(fields).encode()
        req = urllib.request.Request(
            f'https://api.myanimelist.net/v2/anime/{anime_id}/my_list_status',
            data=body_enc,
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/x-www-form-urlencoded'},
            method='PATCH'
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())

    try:
        result = _do_update(access_token)
        return jsonify({"ok": True, "data": result})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            new_token = _mal_refresh(user_id)
            if new_token:
                try:
                    result = _do_update(new_token)
                    return jsonify({"ok": True, "data": result})
                except Exception as e2:
                    return jsonify({"error": str(e2)}), 400
        return jsonify({"error": f"MAL API error: {e.code}"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/api/mal/lists', methods=['GET'])
def mal_lists():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
    except Exception:
        return jsonify({"error": "Invalid token"}), 401

    rows = turso_query("SELECT mal_access_token FROM users WHERE id=?", [user_id])
    if not rows or not rows[0].get("mal_access_token"):
        return jsonify({"error": "MAL not connected"}), 400
    access_token = rows[0]["mal_access_token"]

    def _fetch_all(token):
        results = []
        url = (
            'https://api.myanimelist.net/v2/users/@me/animelist'
            '?fields=list_status,num_episodes,main_picture,title'
            '&limit=1000&sort=list_updated_at'
        )
        while url:
            req = urllib.request.Request(
                url,
                headers={'Authorization': f'Bearer {token}', 'User-Agent': 'Kurovexa/1.0'}
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read())
            results.extend(data.get('data', []))
            url = data.get('paging', {}).get('next')
        return results

    try:
        items = _fetch_all(access_token)
        return jsonify({"ok": True, "data": items})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            new_token = _mal_refresh(user_id)
            if new_token:
                try:
                    items = _fetch_all(new_token)
                    return jsonify({"ok": True, "data": items})
                except Exception as e2:
                    return jsonify({"error": str(e2)}), 400
        return jsonify({"error": f"MAL API error: {e.code}"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/api/mal/delete', methods=['POST'])
def mal_delete():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
    except Exception:
        return jsonify({"error": "Invalid token"}), 401

    body = request.get_json(force=True) or {}
    anime_id = body.get('animeId') or body.get('anime_id')
    if not anime_id:
        return jsonify({"error": "animeId required"}), 400

    rows = turso_query("SELECT mal_access_token FROM users WHERE id=?", [user_id])
    if not rows or not rows[0].get("mal_access_token"):
        return jsonify({"error": "MAL not connected"}), 400
    access_token = rows[0]["mal_access_token"]

    def _do_delete(token):
        req = urllib.request.Request(
            f'https://api.myanimelist.net/v2/anime/{anime_id}/my_list_status',
            headers={'Authorization': f'Bearer {token}'},
            method='DELETE'
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status

    try:
        _do_delete(access_token)
        return jsonify({"ok": True})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            new_token = _mal_refresh(user_id)
            if new_token:
                try:
                    _do_delete(new_token)
                    return jsonify({"ok": True})
                except Exception as e2:
                    return jsonify({"error": str(e2)}), 400
        if e.code == 404:
            return jsonify({"ok": True})
        return jsonify({"error": f"MAL API error: {e.code}"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/api/tracking/mode', methods=['GET', 'POST'])
def tracking_mode():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
    except Exception:
        return jsonify({"error": "Invalid token"}), 401

    if request.method == 'GET':
        rows = turso_query("SELECT tracking_mode FROM users WHERE id=?", [user_id])
        mode = (rows[0].get("tracking_mode") if rows else None) or "none"
        return jsonify({"mode": mode})

    body = request.get_json(force=True) or {}
    mode = body.get('mode', 'none')
    if mode not in ('none', 'anilist', 'mal', 'both'):
        return jsonify({"error": "Invalid mode"}), 400
    turso_exec("UPDATE users SET tracking_mode=? WHERE id=?", [mode, user_id])
    return jsonify({"ok": True, "mode": mode})

@app.route('/api/anilist/stats', methods=['GET'])
def anilist_stats():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
        al_auth = get_anilist_auth(user_id)
        if not al_auth: return jsonify({"error": "AniList not connected"}), 400

        query = '''
        query($id: Int!) {
          User(id: $id) {
            statistics {
              anime {
                count
                minutesWatched
                meanScore
              }
            }
          }
        }
        '''
        req = urllib.request.Request('https://graphql.anilist.co',
            data=json.dumps({'query': query, 'variables': {'id': al_auth['anilist_id']}}).encode('utf-8'),
            headers={
                'Authorization': 'Bearer ' + al_auth['anilist_token'],
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }, method='POST')
        with urllib.request.urlopen(req) as response:
            return jsonify(json.loads(response.read())), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/anilist/lists', methods=['GET'])
def anilist_lists():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
        al_auth = get_anilist_auth(user_id)
        if not al_auth: return jsonify({"error": "AniList not connected"}), 400

        query = '''
        query($id: Int!) {
          MediaListCollection(userId: $id, type: ANIME) {
            lists {
              name
              entries {
                id
                status
                score
                progress
                notes
                repeat
                startedAt { year month day }
                completedAt { year month day }
                media {
                  id
                  title { romaji english native }
                  coverImage { large }
                  format
                  episodes
                }
              }
            }
          }
        }
        '''
        req = urllib.request.Request('https://graphql.anilist.co',
            data=json.dumps({'query': query, 'variables': {'id': al_auth['anilist_id']}}).encode('utf-8'),
            headers={
                'Authorization': 'Bearer ' + al_auth['anilist_token'],
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }, method='POST')
        with urllib.request.urlopen(req) as response:
            return jsonify(json.loads(response.read())), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

from flask import make_response

PAGES_DIR = os.path.join(ROOT, 'pages')

def serve_html_with_key(filename):
    """Reads an HTML file from pages/, injects the session key meta tag, and serves it."""
    safe_name = os.path.basename(filename)
    path = os.path.join(PAGES_DIR, safe_name)
    if not os.path.exists(path):
        legacy = os.path.join(ROOT, safe_name)
        if os.path.exists(legacy):
            path = legacy
        else:
            return "Not found", 404
    with open(path, 'rb') as f:
        raw = f.read()
    html = raw.decode('utf-8', errors='replace')

    meta_tag = f'\n    <meta name="k-session" content="{SESSION_AES_B64}">\n    <meta name="x-request-id" content="{_page_build_token()}">\n'
    new_html, count = re.subn(r'(?i)</head>', meta_tag + '</head>', html, count=1)
    if count == 0:

        new_html = meta_tag + html

    resp = make_response(new_html)
    resp.headers['Content-Type'] = 'text/html; charset=utf-8'
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/')
def index():
    return serve_html_with_key('landing.html')

_ms_cache = {'data': None, 'exp': 0}

@app.route('/api/most-searched')
def most_searched():
    import requests
    now = time.time()
    if _ms_cache['data'] and now < _ms_cache['exp']:
        return jsonify(_ms_cache['data']), 200
    try:
        r = requests.get(
            'https://anikai.to/',
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            timeout=8
        )
        block = re.search(r'<div[^>]*class="most-searched"[^>]*>(.*?)</div>', r.text, re.S | re.I)
        keywords = []
        if block:
            for m in re.finditer(r'<a[^>]*>([^<]+)</a>', block.group(1)):
                kw = m.group(1).strip()
                if kw and kw not in keywords:
                    keywords.append(kw)
        if not keywords:
            raise ValueError('no keywords parsed')
        payload = {'keywords': keywords, 'source': 'anikai.to'}
        _ms_cache['data'] = payload
        _ms_cache['exp'] = now + 1800
        return jsonify(payload), 200
    except Exception as e:
        fallback = {
            'keywords': ['One Piece', 'Solo Leveling', 'Demon Slayer', 'Jujutsu Kaisen', 'Frieren', 'Attack on Titan'],
            'source': 'fallback',
            'error': str(e)
        }
        return jsonify(fallback), 200

@app.route('/home')
def home_alias():
    return serve_html_with_key('index.html')

@app.route('/api/anime/<path:subpath>')
def unified_proxy(subpath):

    full_path = '/' + subpath
    if request.query_string:
        full_path += '?' + request.query_string.decode()
    return proxy_backend(full_path)

@app.route('/proxy')
def proxy_api():
    path = request.args.get('path', '/')
    return proxy_backend(path)

SWIFTSTREAM_UPSTREAM = 'https://swiftstream.top/proxy'
SWIFTSTREAM_REFERER = 'https://animetsu.live/'
SWIFTSTREAM_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
)

@app.route('/proxy/swiftstream/<path:subpath>', methods=['GET', 'HEAD'])
@limiter.limit("200 per minute")
def swiftstream_proxy(subpath):
    import requests
    upstream = f'{SWIFTSTREAM_UPSTREAM}/{subpath}'
    qs = request.query_string.decode()
    if qs:
        upstream += '?' + qs

    fwd_headers = {
        'User-Agent': SWIFTSTREAM_UA,
        'Referer': SWIFTSTREAM_REFERER,
        'Origin': 'https://animetsu.live',
        'Accept': '*/*',
    }

    rng = request.headers.get('Range')
    if rng:
        fwd_headers['Range'] = rng

    try:
        upstream_resp = requests.get(
            upstream,
            headers=fwd_headers,
            stream=True,
            timeout=20,
            allow_redirects=True,
        )
    except requests.RequestException as e:
        return jsonify({'error': 'upstream fetch failed', 'detail': str(e)}), 502

    excluded = {
        'content-encoding', 'transfer-encoding', 'connection',
        'keep-alive', 'proxy-authenticate', 'proxy-authorization',
        'te', 'trailers', 'upgrade',
    }
    passthrough = [
        (k, v) for (k, v) in upstream_resp.raw.headers.items()
        if k.lower() not in excluded
    ]

    def generate():
        try:
            for chunk in upstream_resp.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream_resp.close()

    from flask import Response
    return Response(
        generate(),
        status=upstream_resp.status_code,
        headers=passthrough,
    )

_FLASK_HLS_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)

_HLS_ALLOWED_HOSTS = {
    'megaup.nl', 'hub26link.site', 'mp4.24stream.xyz', 'tools.fast4speed.rsvp',
}

def _flask_hls_resolve_referer(hostname, ref_param=None):
    if hostname.startswith('rrr.'):
        return 'https://megaup.nl/', 'https://megaup.nl'
    if hostname == 'megaup.nl' or hostname.endswith('.megaup.nl'):
        return 'https://megaup.nl/', 'https://megaup.nl'
    if hostname == 'hub26link.site' or hostname.endswith('.hub26link.site'):
        return 'https://megaup.nl/', 'https://megaup.nl'
    if ref_param:
        try:
            import urllib.parse as _up
            p = _up.urlparse(ref_param)
            return ref_param, p.scheme + '://' + p.netloc
        except Exception:
            return ref_param, ref_param
    return None, None

def _rewrite_m3u8_flask(text, base_url, proxy_base, referer):
    """Rewrite all segment/playlist/key URIs in an M3U8 through proxy_base."""
    import urllib.parse as _up
    lines = text.split('\n')
    out = []
    for raw in lines:
        line = raw.strip()
        if line.startswith('#') and 'URI="' in line:
            def _sub(m, _b=base_url, _pb=proxy_base, _r=referer):
                uri = m.group(1)
                abs_uri = _up.urljoin(_b, uri)
                q = f"{_pb}?url={_up.quote(abs_uri, safe='')}"
                if _r:
                    q += f"&ref={_up.quote(_r, safe='')}"
                return f'URI="{q}"'
            out.append(re.sub(r'URI="([^"]+)"', _sub, line))
            continue
        if line and not line.startswith('#'):
            abs_uri = _up.urljoin(base_url, line)
            q = f"{proxy_base}?url={_up.quote(abs_uri, safe='')}"
            if referer:
                q += f"&ref={_up.quote(referer, safe='')}"
            out.append(q)
            continue
        out.append(raw)
    return '\n'.join(out)

@app.route('/proxy/hls', methods=['GET', 'HEAD', 'OPTIONS'])
@limiter.limit("300 per minute")
def flask_hls_proxy():
    """Flask-side HLS proxy for CDNs that block Cloudflare Worker IPs (e.g. megaup/arc/Zenith)."""
    import requests as _req
    import urllib.parse as _up
    from flask import Response, stream_with_context

    if request.method == 'OPTIONS':
        r = make_response('', 204)
        r.headers['Access-Control-Allow-Origin'] = '*'
        r.headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
        r.headers['Access-Control-Allow-Headers'] = 'Range, Content-Type'
        return r

    target_raw = request.args.get('url')
    ref_raw    = request.args.get('ref')

    if not target_raw:
        return jsonify({'error': 'Missing ?url= parameter'}), 400

    target_url = _up.unquote(target_raw)
    ref_param  = _up.unquote(ref_raw) if ref_raw else None

    try:
        parsed = _up.urlparse(target_url)
        if parsed.scheme not in ('http', 'https'):
            raise ValueError('https only')
    except Exception as exc:
        return jsonify({'error': f'Invalid URL: {exc}'}), 400

    hostname = parsed.hostname.lower()
    referer, origin = _flask_hls_resolve_referer(hostname, ref_param)

    if not referer:
        return jsonify({'error': f'Host not in allowlist: {hostname}. Pass ?ref= to allow.'}), 403

    hdrs = {
        'User-Agent':      _FLASK_HLS_UA,
        'Accept':          '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         referer,
        'Origin':          origin,
        'Sec-Fetch-Dest':  'empty',
        'Sec-Fetch-Mode':  'cors',
        'Sec-Fetch-Site':  'cross-site',
        'Cache-Control':   'no-cache',
        'Pragma':          'no-cache',
    }
    rng = request.headers.get('Range')
    if rng:
        hdrs['Range'] = rng

    try:
        upstream = _req.get(
            target_url, headers=hdrs, stream=True, timeout=20, allow_redirects=True,
        )
    except _req.RequestException as exc:
        return jsonify({'error': 'Upstream fetch failed', 'detail': str(exc)}), 502

    content_type = upstream.headers.get('Content-Type', 'application/octet-stream').lower()
    is_m3u8 = ('mpegurl' in content_type or 'x-mpegurl' in content_type or
                target_url.split('?')[0].endswith('.m3u8'))

    _cors = {
        'Access-Control-Allow-Origin':   '*',
        'Access-Control-Allow-Methods':  'GET, HEAD, OPTIONS',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
    }

    if request.method == 'HEAD':
        r = make_response('', upstream.status_code)
        r.headers['Content-Type'] = upstream.headers.get('Content-Type', 'application/octet-stream')
        r.headers.update(_cors)
        cl = upstream.headers.get('Content-Length')
        if cl:
            r.headers['Content-Length'] = cl
        upstream.close()
        return r

    if not upstream.ok and upstream.status_code != 206:
        body = upstream.text
        upstream.close()
        r = make_response(jsonify({'error': 'Upstream error', 'status': upstream.status_code,
                                   'host': hostname}), upstream.status_code)
        r.headers.update(_cors)
        return r

    if is_m3u8:
        text = upstream.text
        upstream.close()
        proto      = request.headers.get('X-Forwarded-Proto', 'https')
        host       = request.headers.get('Host', request.host)
        proxy_base = f"{proto}://{host}/proxy/hls"
        rewritten  = _rewrite_m3u8_flask(text, target_url, proxy_base, referer)
        r = make_response(rewritten, 200)
        r.headers['Content-Type']  = 'application/vnd.apple.mpegurl'
        r.headers['Cache-Control'] = 'no-cache'
        r.headers.update(_cors)
        return r

    pass_hdrs = {
        'Content-Type':  upstream.headers.get('Content-Type', 'application/octet-stream'),
        'Cache-Control': 'public, max-age=86400',
    }
    pass_hdrs.update(_cors)
    cl = upstream.headers.get('Content-Length')
    if cl:
        pass_hdrs['Content-Length'] = cl
    cr = upstream.headers.get('Content-Range')
    if cr:
        pass_hdrs['Content-Range'] = cr

    def _gen():
        try:
            for chunk in upstream.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return Response(stream_with_context(_gen()), status=upstream.status_code, headers=pass_hdrs)

@app.route('/api/secure/pipe', methods=['GET'])
def secure_pipe():
    """
    Miruro-style encrypted endpoint.
    Expects ?e=<base64_encrypted_payload>
    Decrypts the payload, runs the proxy request, and returns an AES-GCM encrypted JSON string.
    """
    e_b64 = request.args.get('e')
    if not e_b64:
        return jsonify({"error": "Missing payload"}), 400

    try:
        decrypted_bytes = decrypt_payload(e_b64)
        payload = json.loads(decrypted_bytes.decode('utf-8'))

        path = payload.get('path', '/')
        if not path.startswith('/'):
            path = '/' + path

        resp = proxy_backend(path)

        if hasattr(resp, 'get_data'):
            raw_data = resp.get_data()
            status = resp.status_code
        elif isinstance(resp, tuple):
            raw_data = resp[0].get_data() if hasattr(resp[0], 'get_data') else json.dumps(resp[0]).encode()
            status = resp[1]
        else:
            raw_data = str(resp).encode()
            status = 200

        compressed = gzip.compress(raw_data)

        encrypted_b64 = encrypt_payload(compressed)

        final_resp = make_response(encrypted_b64, status)
        final_resp.headers['Content-Type'] = 'text/plain'
        return final_resp

    except Exception as ex:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Invalid secure payload"}), 400

def proxy_backend(path):
    import requests
    try:
        if path.startswith('/spotlight'):
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            }
            items = []
            try:
                fb_url = f"{API}/trending?page=1&per_page=10"
                print(f"[PROXY] GET (spotlight) -> {fb_url}")
                fb = requests.get(fb_url, headers=headers, timeout=15)
                fb.raise_for_status()
                fb_payload = fb.json()
                if isinstance(fb_payload, dict):
                    raw = fb_payload.get('info') or fb_payload.get('results') or fb_payload.get('data') or []
                elif isinstance(fb_payload, list):
                    raw = fb_payload
                else:
                    raw = []
                if isinstance(raw, list):
                    items = raw[:10]
            except Exception as e:
                print(f"[PROXY] Spotlight failed: {e}")

            payload = {'info': items}
            resp = make_response(json.dumps(payload).encode('utf-8'), 200)
            resp.headers['Content-Type'] = 'application/json'
            resp.headers['Access-Control-Allow-Origin'] = '*'
            resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            resp.headers['Pragma'] = 'no-cache'
            return resp

        if path.startswith('/themes/') or path == '/themes':
            from werkzeug.test import EnvironBuilder

            path_only, _, qs = path.partition('?')
            sub = path_only[len('/themes'):] or '/'
            handler_map = {
                '/search':       (themes_search,      []),
                '/recent':       (themes_recent,      []),
                '/top-artists':  (themes_top_artists, []),
            }
            target = None
            args = []
            if sub in handler_map:
                target = handler_map[sub][0]
            elif sub.startswith('/anime/'):
                target = themes_anime
                args = [sub[len('/anime/'):]]
            elif sub.startswith('/artist/'):
                target = themes_artist
                args = [sub[len('/artist/'):]]
            elif sub.startswith('/year/'):
                year_val = sub[len('/year/'):]
                try:
                    target = themes_year
                    args = [int(year_val)]
                except ValueError:
                    return jsonify({'error': 'bad year'}), 400
            if target is None:
                return jsonify({'error': 'unknown themes path'}), 404

            builder = EnvironBuilder(method='GET', query_string=qs)
            with app.request_context(builder.get_environ()):
                return target(*args)

        if path.startswith('/manga/'):
            vault_path = path[len('/manga'):]
            vault_url = os.getenv('MANGA_VAULT_URL', 'YOUR_MANGA_VAULT_URL') + vault_path
            v_headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
            }
            try:
                print(f"[PROXY] GET (manga) -> {vault_url}")
                vr = requests.get(vault_url, headers=v_headers, timeout=20)
                content_type = vr.headers.get('Content-Type', 'application/json')
                resp = make_response(vr.content, vr.status_code)
                resp.headers['Content-Type'] = content_type
                resp.headers['Access-Control-Allow-Origin'] = '*'
                return resp
            except Exception as e:
                print(f"[PROXY] Manga vault error: {e}")
                return jsonify({"error": str(e)}), 502

        parts = path.split('?', 1)
        import urllib.parse
        encoded_path = urllib.parse.quote(parts[0])
        if len(parts) > 1:
            encoded_path += '?' + parts[1].replace(' ', '%20')

        full_url = API + encoded_path

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': f'https://{request.host}/',
            'Origin': f'https://{request.host}'
        }

        excluded_headers = [
            'content-encoding', 'content-length', 'transfer-encoding',
            'connection', 'host', 'accept-encoding'
        ]
        for h, v in request.headers.items():
            if h.lower() not in excluded_headers:
                headers[h] = v

        print(f"[PROXY] {request.method} -> {full_url}")
        r = requests.get(full_url, headers=headers, timeout=20)

        content_type = r.headers.get('Content-Type', 'application/json')
        resp = make_response(r.content, r.status_code)
        resp.headers['Content-Type'] = content_type
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp

    except requests.exceptions.RequestException as e:
        status_code = getattr(e.response, 'status_code', 500) if hasattr(e, 'response') else 500
        print(f'[PROXY] Error fetching {path}: {e}')
        return jsonify({"error": str(e)}), status_code
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/imgproxy')
@limiter.limit("120 per minute")
def proxy_image():
    url = request.args.get('url', '')
    if not url or not url.startswith('http'):
        return 'Bad request', 400
    try:
        import urllib.parse as _urlparse
        from flask import Response
        _parsed_host = _urlparse.urlparse(url).hostname or ''
        _parsed_host = _parsed_host.lower()
        if not any(_parsed_host == d or _parsed_host.endswith('.' + d) for d in _IMGPROXY_ALLOWLIST):
            return jsonify({'error': 'Domain not allowed'}), 403
        _host = _urlparse.urlparse(url).netloc
        if 'atsu.moe' in _host:
            try:
                import cloudscraper
                _scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False})
                r = _scraper.get(url, timeout=15)
                data = r.content
                content_type = r.headers.get('Content-Type', 'image/jpeg')
            except Exception:
                import requests as _req
                r = _req.get(url, timeout=10, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Referer': 'https://atsu.moe/',
                    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                })
                data = r.content
                content_type = r.headers.get('Content-Type', 'image/jpeg')
        else:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': f'https://{_host}/',
            })
            with urllib.request.urlopen(req, timeout=10) as r:
                data = r.read()
                content_type = r.headers.get('Content-Type', 'image/png')
        resp = Response(data, content_type=content_type)
        resp.headers['Cache-Control'] = 'public, max-age=86400'
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tvdb-banner')
def tvdb_banner():
    anilist_id = request.args.get('id', '').strip()
    if not anilist_id:
        return jsonify({'url': None, 'error': 'missing id'}), 400
    try:
        eps_req = urllib.request.Request(
            f'{API}/episodes/{anilist_id}',
            headers={'User-Agent': 'Kurovexa/1.0'}
        )
        with urllib.request.urlopen(eps_req, timeout=10) as r:
            eps_data = json.loads(r.read())

        tvdb_id = eps_data.get('thetvdbId')
        if not tvdb_id:
            return jsonify({'url': None}), 200

        token = get_tvdb_token()
        art_req = urllib.request.Request(
            f'https://api4.thetvdb.com/v4/series/{tvdb_id}/artworks',
            headers={
                'Authorization': f'Bearer {token}',
                'User-Agent': 'Kurovexa/1.0',
            }
        )
        with urllib.request.urlopen(art_req, timeout=10) as r:
            art_data = json.loads(r.read())

        artworks = art_data.get('data', {}).get('artworks', [])
        backgrounds = [a for a in artworks if a.get('type') == 3 and a.get('image')]
        if not backgrounds:
            return jsonify({'url': None}), 200

        best = max(backgrounds, key=lambda a: a.get('score', 0))
        return jsonify({'url': best['image']})

    except Exception as e:
        return jsonify({'url': None, 'error': str(e)}), 200

@app.route('/api/anilist/save', methods=['POST'])
def anilist_save():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        data = request.json
        user_id = verify_token(auth[7:])["sub"]
        al_auth = get_anilist_auth(user_id)
        if not al_auth: return jsonify({"error": "AniList not connected"}), 400

        query = '''
        mutation ($mediaId: Int, $status: MediaListStatus, $score: Float, $progress: Int, $notes: String, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput, $repeat: Int) {
          SaveMediaListEntry (mediaId: $mediaId, status: $status, score: $score, progress: $progress, notes: $notes, startedAt: $startedAt, completedAt: $completedAt, repeat: $repeat) {
            id
            status
            progress
            score
            notes
          }
        }
        '''
        variables = {
            'mediaId': data.get('mediaId'),
            'status': data.get('status'),
            'score': data.get('score'),
            'progress': data.get('progress'),
            'notes': data.get('notes'),
            'startedAt': data.get('startedAt'),
            'completedAt': data.get('completedAt'),
            'repeat': data.get('repeat')
        }

        variables = {k: v for k, v in variables.items() if v is not None}

        if variables.get('mediaId') and variables.get('progress') is not None:
            try:
                progress_val = int(variables['progress'])
            except Exception:
                progress_val = 0
            progress_val = max(0, progress_val)
            variables['progress'] = progress_val

            try:
                episodes_query = '''
                query ($mediaId: Int) {
                  Media(id: $mediaId, type: ANIME) {
                    episodes
                  }
                }
                '''
                episodes_req = urllib.request.Request(
                    'https://graphql.anilist.co',
                    data=json.dumps({'query': episodes_query, 'variables': {'mediaId': variables['mediaId']}}).encode('utf-8'),
                    headers={
                        'Authorization': 'Bearer ' + al_auth['anilist_token'],
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'User-Agent': 'Kurovexa/1.0'
                    },
                    method='POST'
                )
                with urllib.request.urlopen(episodes_req, timeout=8) as episodes_resp:
                    episodes_data = json.loads(episodes_resp.read())
                    total_eps = (((episodes_data or {}).get('data') or {}).get('Media') or {}).get('episodes')
                    if isinstance(total_eps, int) and total_eps > 0:
                        variables['progress'] = min(progress_val, total_eps)
            except Exception as ep_err:
                print(f'[AniList] episode limit check failed: {ep_err}')

        is_new = False
        prev_status = None
        try:
            check_query2 = 'query($mediaId:Int){MediaList(mediaId:$mediaId,type:ANIME){id status}}'
            check_req = urllib.request.Request('https://graphql.anilist.co',
                data=json.dumps({'query': check_query2, 'variables': {'mediaId': variables['mediaId']}}).encode('utf-8'),
                headers={
                    'Authorization': 'Bearer ' + al_auth['anilist_token'],
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'Kurovexa/1.0'
                }, method='POST')
            with urllib.request.urlopen(check_req, timeout=8) as check_resp:
                check_res_data = json.loads(check_resp.read())
                media_list = check_res_data.get('data', {}).get('MediaList')
                has_errors = bool(check_res_data.get('errors'))
                is_new = (not media_list) or has_errors
                prev_status = media_list.get('status') if media_list else None
                print(f'[AniList] pre-save: is_new={is_new}, prev_status={prev_status}, mediaId={variables["mediaId"]}')
        except Exception as check_err:
            print(f'[AniList] pre-save check failed (assume new): {check_err}')
            is_new = True
            prev_status = None

        req = urllib.request.Request('https://graphql.anilist.co',
            data=json.dumps({'query': query, 'variables': variables}).encode('utf-8'),
            headers={
                'Authorization': 'Bearer ' + al_auth['anilist_token'],
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }, method='POST')
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read())
            if isinstance(result, dict) and 'data' in result:
                result['is_new'] = is_new
                result['prev_status'] = prev_status
            return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/anilist/delete', methods=['POST'])
def anilist_delete():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        data = request.json
        list_id = data.get('id')
        if not list_id: return jsonify({"error": "Missing entry ID"}), 400

        user_id = verify_token(auth[7:])["sub"]
        al_auth = get_anilist_auth(user_id)
        if not al_auth: return jsonify({"error": "AniList not connected"}), 400

        query = '''
        mutation ($id: Int) {
          DeleteMediaListEntry (id: $id) {
            deleted
          }
        }
        '''
        req = urllib.request.Request('https://graphql.anilist.co',
            data=json.dumps({'query': query, 'variables': {'id': list_id}}).encode('utf-8'),
            headers={
                'Authorization': 'Bearer ' + al_auth['anilist_token'],
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }, method='POST')
        with urllib.request.urlopen(req) as response:
            return jsonify(json.loads(response.read())), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/comments', methods=['GET'])
def get_comments():
    anime_id = request.args.get('anime_id')
    episode = request.args.get('ep')
    if not anime_id or not episode:
        return jsonify({"error": "Missing anime_id or ep"}), 400

    query = """
        SELECT c.id, c.user_id, c.parent_id, c.content, c.created_at, c.is_deleted,
               c.is_spoiler, c.gif_url,
               u.username, u.avatar_url, u.anilist_username
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.anime_id = ? AND c.episode = ?
        ORDER BY c.created_at DESC
    """
    import sys
    sys.stderr.write(f"\\nDEBUG get_comments:\\n  anime_id: '{anime_id}', ep: '{episode}'\\n")
    rows = turso_query(query, [anime_id, episode])
    sys.stderr.write(f"  rows returned: {len(rows)}\\n\\n")
    return jsonify({"comments": rows}), 200

@app.route('/api/comments', methods=['POST'])
@limiter.limit("10 per minute")
def post_comment():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]
        data = request.json or {}
        anime_id = str(data.get('anime_id', '')).strip()
        episode = str(data.get('ep', '')).strip()
        parent_id = data.get('parent_id')
        content = str(data.get('content', '')).strip()

        if len(anime_id) > 64 or len(episode) > 32:
            return jsonify({"error": "Invalid data"}), 400

        is_spoiler = 1 if data.get('is_spoiler') else 0
        raw_gif = data.get('gif_url')
        gif_url = str(raw_gif).strip() if raw_gif else None

        if gif_url and (gif_url.lower() == 'none' or gif_url.lower() == 'null'):
            gif_url = None

        if gif_url:
            if not _validate_url(gif_url):
                return jsonify({"error": "Invalid GIF URL"}), 400
            try:
                import urllib.parse as _up
                _gif_host = (_up.urlparse(gif_url).hostname or '').lower()
                if not any(_gif_host == d or _gif_host.endswith('.' + d) for d in _GIF_ALLOWLIST):
                    return jsonify({"error": "GIF domain not allowed"}), 400
            except Exception:
                return jsonify({"error": "Invalid GIF URL"}), 400

        if not anime_id or not episode or (not content and not gif_url):
            return jsonify({"error": "Invalid data"}), 400

        if len(content) > 1000:
            return jsonify({"error": "Comment too long (max 1000 chars)"}), 400

        if parent_id:
            try: parent_id = int(parent_id)
            except ValueError: parent_id = None

        turso_exec(
            "INSERT INTO comments (user_id, anime_id, episode, parent_id, content, is_spoiler, gif_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [user_id, anime_id, episode, parent_id, content, is_spoiler, gif_url]
        )
        return jsonify({"success": True}), 201
    except Exception:
        return jsonify({"error": "Failed to post comment"}), 401

@app.route('/api/comments/<int:comment_id>', methods=['DELETE'])
def delete_comment(comment_id):
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        user_id = verify_token(auth[7:])["sub"]

        rows = turso_query("SELECT user_id FROM comments WHERE id = ?", [comment_id])
        if not rows:
            return jsonify({"error": "Not found"}), 404

        if str(rows[0]['user_id']) != str(user_id):
             return jsonify({"error": "Forbidden"}), 403

        turso_exec("UPDATE comments SET is_deleted = 1 WHERE id = ?", [comment_id])
        return jsonify({"success": True}), 200

    except Exception:
        return jsonify({"error": "Action failed"}), 401

_themes_cache = {}
_THEMES_TTL = 600

def _at_proxy(path, query=''):
    import requests, urllib.parse as _up
    key = path + '?' + query
    now = time.time()
    hit = _themes_cache.get(key)
    if hit and now < hit['exp']:
        return hit['data']
    url = 'https://api.animethemes.moe' + path
    if query:
        url += '?' + query
    try:
        r = requests.get(url, headers={'Accept': 'application/json', 'User-Agent': 'Kurovexa/1.0'}, timeout=12)
        data = r.json()
    except Exception as e:
        return {'error': str(e)}
    _themes_cache[key] = {'data': data, 'exp': now + _THEMES_TTL}
    if len(_themes_cache) > 200:
        for k in list(_themes_cache.keys())[:80]:
            _themes_cache.pop(k, None)
    return data

@app.route('/api/themes/search')
def themes_search():
    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({'anime': [], 'songs': [], 'artists': [], 'animethemes': []}), 200
    import urllib.parse as _up
    qs = (
        'q=' + _up.quote(q) +
        '&fields[search]=anime,animethemes,artists,songs' +
        '&include[anime]=images,animethemes.song.artists,animethemes.animethemeentries.videos.audio' +
        '&include[animetheme]=song.artists,anime.images,animethemeentries.videos.audio' +
        '&include[artist]=images' +
        '&include[song]=artists,animethemes.anime'
    )
    data = _at_proxy('/search', qs)
    if 'error' in data:
        return jsonify(data), 502
    return jsonify(data.get('search') or data), 200

@app.route('/api/themes/anime/<aid>')
def themes_anime(aid):
    qs = ('include=images,animethemes.song.artists,'
          'animethemes.animethemeentries.videos.audio,'
          'resources,studios,series')
    slug = aid
    if aid.isdigit():
        lookup = _at_proxy('/anime', 'filter[id]=' + aid + '&fields[anime]=id,slug')
        if 'error' in lookup:
            return jsonify(lookup), 502
        items = lookup.get('anime') or []
        if not items:
            return jsonify({'anime': None}), 200
        slug = items[0].get('slug') or aid
    data = _at_proxy('/anime/' + slug, qs)
    if 'error' in data:
        return jsonify(data), 502
    return jsonify({'anime': data.get('anime')}), 200

@app.route('/api/themes/artist/<slug>')
def themes_artist(slug):
    qs = ('include=images,songs.artists,'
          'songs.animethemes.anime.images,'
          'songs.animethemes.animethemeentries.videos.audio')
    data = _at_proxy('/artist/' + slug, qs)
    if 'error' in data:
        return jsonify(data), 502
    return jsonify(data), 200

@app.route('/api/themes/recent')
def themes_recent():
    qs = ('sort=-year,-season,name'
          '&filter[has]=animethemes'
          '&include=images,animethemes.song.artists,'
          'animethemes.animethemeentries.videos.audio'
          '&page[size]=24')
    data = _at_proxy('/anime', qs)
    if 'error' in data:
        return jsonify(data), 502
    return jsonify(data), 200

@app.route('/api/themes/year/<int:year>')
def themes_year(year):
    qs = ('filter[year]=' + str(year) +
          '&filter[has]=animethemes'
          '&sort=-season,name'
          '&include=images,animethemes.song.artists,'
          'animethemes.animethemeentries.videos.audio'
          '&page[size]=40')
    data = _at_proxy('/anime', qs)
    if 'error' in data:
        return jsonify(data), 502
    return jsonify(data), 200

@app.route('/api/themes/top-artists')
def themes_top_artists():
    qs = 'include=images&sort=name&page[size]=24'
    data = _at_proxy('/artist', qs)
    if 'error' in data:
        return jsonify(data), 502
    return jsonify(data), 200

_LYRICS_CACHE = {}
_LYRICS_CACHE_TTL = 60 * 60 * 6

def _lyrics_clean(s):
    if not s:
        return ''

    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'\[[^\]]*\]', '', s)
    return s.strip()

def _lrclib_get(track, artist, album=''):
    import urllib.parse as _up
    params = {'track_name': track, 'artist_name': artist}
    if album:
        params['album_name'] = album
    qs = _up.urlencode(params)
    url = f'https://lrclib.net/api/get?{qs}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Kurovexa/1.0 (lyrics)'})
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except Exception:
        return None

def _lrclib_search(track, artist):
    import urllib.parse as _up
    qs = _up.urlencode({'track_name': track, 'artist_name': artist})
    url = f'https://lrclib.net/api/search?{qs}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Kurovexa/1.0 (lyrics)'})
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read())
    except Exception:
        return []

@app.route('/api/lyrics')
def lyrics_lookup():
    title  = (request.args.get('title')  or '').strip()
    artist = (request.args.get('artist') or '').strip()
    try:
        target_dur = float(request.args.get('duration') or 0)
    except (TypeError, ValueError):
        target_dur = 0.0
    if not title:
        return jsonify({'lyrics': '', 'synced': '', 'source': None, 'error': 'missing title'}), 400

    dur_bucket = int(round(target_dur / 5.0)) if target_dur else 0
    cache_key = (title.lower(), artist.lower(), dur_bucket)
    now = time.time()
    cached = _LYRICS_CACHE.get(cache_key)
    if cached and (now - cached['t']) < _LYRICS_CACHE_TTL:
        return jsonify(cached['data']), 200

    titles  = [title, _lyrics_clean(title)]
    artists = [artist, _lyrics_clean(artist)] if artist else ['']
    titles  = [t for t in dict.fromkeys(titles) if t]
    artists = [a for a in dict.fromkeys(artists) if a is not None]

    def _has_lyrics(r):
        return bool(r and (r.get('plainLyrics') or r.get('syncedLyrics')))

    candidates = []
    seen_ids = set()
    def _add(r):
        if not _has_lyrics(r):
            return
        rid = r.get('id') or (r.get('trackName'), r.get('artistName'), r.get('duration'))
        if rid in seen_ids:
            return
        seen_ids.add(rid)
        candidates.append(r)

    for t in titles:
        for a in artists:
            if not a:
                continue
            _add(_lrclib_get(t, a))

    if artists:
        for t in titles:
            for r in (_lrclib_search(t, artists[0]) or []):
                _add(r)

    def _score(r):

        d = r.get('duration') or 0
        try:
            d = float(d)
        except (TypeError, ValueError):
            d = 0.0
        delta = abs(d - target_dur) if (target_dur and d) else 9999.0
        synced_bonus = 0.0 if r.get('syncedLyrics') else 2.0
        return (delta, synced_bonus)

    found = None
    if candidates:
        if target_dur:
            candidates.sort(key=_score)
        else:

            candidates.sort(key=lambda r: 0 if r.get('syncedLyrics') else 1)
        found = candidates[0]

    if not found:
        payload = {'lyrics': '', 'synced': '', 'source': None}
        _LYRICS_CACHE[cache_key] = {'t': now, 'data': payload}
        return jsonify(payload), 200

    payload = {
        'lyrics':  found.get('plainLyrics')  or '',
        'synced':  found.get('syncedLyrics') or '',
        'source':  'lrclib',
        'duration': found.get('duration') or None,
        'matched': {
            'title':  found.get('trackName')  or title,
            'artist': found.get('artistName') or artist,
            'album':  found.get('albumName')  or '',
        },
    }
    _LYRICS_CACHE[cache_key] = {'t': now, 'data': payload}
    return jsonify(payload), 200

WORKER_API = os.getenv('WORKER_API', 'YOUR_WORKER_API')
STREAM_PROXY = os.getenv('STREAM_PROXY', 'YOUR_STREAM_PROXY')
CDN_BASE = os.getenv('CDN_BASE', 'YOUR_CDN_BASE')
CDN_REFERER = os.getenv('CDN_REFERER', 'YOUR_CDN_REFERER')

_worker_slug_cache = {}

def _hf_norm(s):
    """Normalise a title string for fuzzy comparison."""
    import re
    s = (s or '').lower()
    s = re.sub(r'[\u2010-\u2015\-]', ' ', s)
    s = re.sub(r"['\"`\u2018\u2019\u02bc]", '', s)
    s = re.sub(r'[^\w\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def _hf_strip_season(s):
    """Remove trailing season/part/cour markers."""
    import re
    s = re.sub(r'\b(season|part|cour|arc)\s*\d+\b', '', s, flags=re.I)
    s = re.sub(r'\b(s|p)\s*\d+\b', '', s, flags=re.I)
    s = re.sub(r'\b\d+(st|nd|rd|th)\s+season\b', '', s, flags=re.I)
    s = re.sub(r'\b(ii+|iii|iv|vi*)\b', '', s, flags=re.I)
    return re.sub(r'\s+', ' ', s).strip()

def _hf_score(query_norm, candidate_norm):
    """Score a candidate title against a normalised query. Returns 0–1."""
    import difflib
    if not query_norm or not candidate_norm:
        return 0.0
    if query_norm == candidate_norm:
        return 1.0
    seq = difflib.SequenceMatcher(None, query_norm, candidate_norm).ratio()
    q_words = set(query_norm.split())
    c_words = set(candidate_norm.split())
    if q_words:
        overlap = len(q_words & c_words) / len(q_words)
    else:
        overlap = 0.0
    prefix = 0.15 if candidate_norm.startswith(query_norm) else 0.0
    return min(1.0, seq * 0.5 + overlap * 0.5 + prefix)

def _hf_build_variants(title):
    """Build a list of search query variants from a title, best-first."""
    stripped = _hf_strip_season(title)
    words = title.split()
    variants = [title]
    if stripped and stripped.lower() != title.lower():
        variants.append(stripped)
    if len(words) > 4:
        variants.append(' '.join(words[:4]))
    if len(words) > 3:
        variants.append(' '.join(words[:3]))
    seen = set()
    out = []
    for v in variants:
        k = v.lower().strip()
        if k and k not in seen:
            seen.add(k)
            out.append(v)
    return out


@app.route('/api/worker/map', methods=['GET'])
def worker_map():
    """
    GET /api/worker/map?title=<anime title>
    Searches the 123animes worker for the best matching slug.
    Returns { slug, title, confidence, cached }
    """
    import requests as _req

    title = (request.args.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'Missing ?title= parameter'}), 400

    cache_key = title.lower()
    if cache_key in _worker_slug_cache:
        cached = _worker_slug_cache[cache_key]
        return jsonify({**cached, 'cached': True}), 200

    variants = _hf_build_variants(title)

    all_results = {}
    last_error = None
    for query in variants:
        try:
            r = _req.get(
                f'{WORKER_API}/search',
                params={'keyword': query, 'page': 1},
                timeout=10,
                headers={'User-Agent': 'Kurovexa/1.0'}
            )
            r.raise_for_status()
            for item in r.json().get('results', []):
                slug = item.get('id', '')
                if slug and slug not in all_results:
                    all_results[slug] = item
        except Exception as e:
            last_error = e

    if not all_results:
        if last_error:
            return jsonify({'error': f'Worker search failed: {last_error}'}), 502
        return jsonify({'slug': None, 'confidence': 0}), 200

    title_norm = _hf_norm(title)
    stripped_norm = _hf_norm(_hf_strip_season(title))

    best_slug = None
    best_score = -1.0
    best_title = None

    for slug, item in all_results.items():
        if slug.endswith('-dub'):
            continue
        item_title = item.get('title', '')
        item_norm = _hf_norm(item_title)

        s1 = _hf_score(title_norm, item_norm)
        s2 = _hf_score(stripped_norm, item_norm) if stripped_norm != title_norm else 0.0
        score = max(s1, s2)

        if score > best_score:
            best_score = score
            best_slug = slug
            best_title = item_title

    if best_slug is None:
        for slug, item in all_results.items():
            if not slug.endswith('-dub'):
                best_slug = slug
                best_title = item.get('title', '')
                best_score = 0.1
                break

    payload = {
        'slug': best_slug,
        'title': best_title,
        'confidence': round(best_score, 3),
        'cached': False,
    }

    if best_slug:
        if len(_worker_slug_cache) >= 500:
            for _k in list(_worker_slug_cache.keys())[:100]:
                _worker_slug_cache.pop(_k, None)
        _worker_slug_cache[cache_key] = payload

    return jsonify(payload), 200


@app.route('/api/worker/stream', methods=['GET'])
def worker_stream():
    """
    GET /api/worker/stream?slug=<slug>&ep=<episode_number>
    Returns the proxied stream URL and track info for a given 123animes slug + episode.
    { streamUrl, qualities: [{quality, url}], tracks, intro, outro }
    """
    import requests as _req
    import urllib.parse as _up

    slug = (request.args.get('slug') or '').strip()
    ep   = (request.args.get('ep') or '').strip()

    if not slug or not ep:
        return jsonify({'error': 'Missing ?slug= or ?ep= parameter'}), 400

    try:
        r = _req.get(
            f'{WORKER_API}/anime/{slug}/episodes/{ep}/sources',
            params={'server': 'vidstreaming.io'},
            timeout=10,
            headers={'User-Agent': 'Kurovexa/1.0'}
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        return jsonify({'error': f'Worker sources failed: {e}'}), 502

    sources = data.get('sources', [])
    if not sources:
        return jsonify({'error': 'No sources found', 'slug': slug, 'ep': ep}), 404

    def _proxy(cdn_url):
        return f"{STREAM_PROXY}?url={_up.quote(cdn_url, safe='')}&referer={_up.quote(CDN_REFERER, safe='')}"

    auto_src = next((s for s in sources if s.get('quality') == 'auto'), sources[0])
    stream_url = _proxy(auto_src['url'])

    qualities = [
        {'quality': s.get('quality', 'auto'), 'url': _proxy(s['url'])}
        for s in sources if s.get('url')
    ]

    return jsonify({
        'streamUrl': stream_url,
        'qualities': qualities,
        'tracks': data.get('sources', [{}])[0].get('tracks', []),
        'intro': auto_src.get('intro'),
        'outro': auto_src.get('outro'),
        'slug': slug,
        'ep': ep,
    }), 200


@app.route('/<path:path>')
def static_files(path):
    if path.startswith('pages/') or path.startswith('pages\\'):
        return "Not found", 404
    if path.endswith('.html'):
        return serve_html_with_key(path)

    safe = path.replace('\\', '/').lstrip('/')
    if not safe or '..' in safe.split('/'):
        return "Not found", 404
    abs_path = os.path.join(ROOT, safe)

    if os.path.isfile(abs_path):
        entry = _get_static_entry(abs_path)
        if entry is not None:
            inm = request.headers.get('If-None-Match', '')
            if inm and entry['etag'] in inm:
                resp = make_response('', 304)
                resp.headers['ETag'] = entry['etag']
                resp.headers['Last-Modified'] = entry['last_modified']
                _set_static_cache_control(resp, path)
                return resp
            ims = request.headers.get('If-Modified-Since', '')
            if ims:
                try:
                    ims_ts = email.utils.parsedate_to_datetime(ims).timestamp()
                    if int(ims_ts) >= entry['mtime_ns'] // 1_000_000_000:
                        resp = make_response('', 304)
                        resp.headers['ETag'] = entry['etag']
                        resp.headers['Last-Modified'] = entry['last_modified']
                        _set_static_cache_control(resp, path)
                        return resp
                except (TypeError, ValueError):
                    pass

            accept_enc = request.headers.get('Accept-Encoding', '')
            enc = _negotiate_encoding(accept_enc, entry)
            if enc == 'br':
                body = entry['br']
            elif enc == 'gzip':
                body = entry['gzip']
            else:
                body, enc = entry['raw'], None

            resp = make_response(body)
            resp.headers['Content-Type'] = entry['mime']
            resp.headers['Content-Length'] = str(len(body))
            resp.headers['ETag'] = entry['etag']
            resp.headers['Last-Modified'] = entry['last_modified']
            if enc:
                resp.headers['Content-Encoding'] = enc
                resp.headers['Vary'] = 'Accept-Encoding'
            elif _is_compressible_mime(entry['mime']):
                resp.headers['Vary'] = 'Accept-Encoding'
            _set_static_cache_control(resp, path)
            return resp

    resp = make_response(send_from_directory(ROOT, path))
    lower_path = path.lower()
    if lower_path.endswith(('.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.map')):
        resp.direct_passthrough = False
    _set_static_cache_control(resp, path)
    return resp

def _warm_static_cache():
    asset_dirs = ['css', 'js', 'icon', 'assets', 'pages']
    candidates = []
    for d in asset_dirs:
        full = os.path.join(ROOT, d)
        if not os.path.isdir(full):
            continue
        for dirpath, _, filenames in os.walk(full):
            for fn in filenames:
                ext = os.path.splitext(fn)[1].lower()
                if ext in ('.css', '.js', '.mjs', '.json', '.svg', '.html',
                           '.txt', '.xml', '.ico', '.png', '.webp', '.woff', '.woff2'):
                    candidates.append(os.path.join(dirpath, fn))
    for fav in ('favicon.ico', 'favicon.svg'):
        p = os.path.join(ROOT, fav)
        if os.path.isfile(p):
            candidates.append(p)
    for p in candidates:
        try:
            _get_static_entry(p)
        except Exception:
            pass

try:
    _warm_static_cache()
    _warmed = sum(1 for _ in _STATIC_CACHE)
    _br_count = sum(1 for e in _STATIC_CACHE.values() if e.get('br'))
    _gz_count = sum(1 for e in _STATIC_CACHE.values() if e.get('gzip'))
    print(f'  Static cache warmed: {_warmed} files (br={_br_count}, gz={_gz_count}, brotli_available={_BR_AVAILABLE})')
except Exception as _e:
    print(f'  Warm-up skipped: {_e}')

if __name__ == '__main__':
    port = int(os.getenv('PORT', '5000'))
    host = os.getenv('HOST', '0.0.0.0')
    print(f'\n  Kurovexa -> http://{host}:{port}\n')
    app.run(host=host, port=port, debug=False)
