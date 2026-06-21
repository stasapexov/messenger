const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const cors = require("cors");
const multer = require("multer");
const webpush = require("web-push");
const { DatabaseSync } = require("node:sqlite");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: true, credentials: true },
});
const onlineUsers = new Map();

function parsePort(value, fallback) {
    const text = String(value || "").trim();
    if (!text) return fallback;

    const direct = Number(text);
    if (Number.isInteger(direct) && direct > 0 && direct < 65536) return direct;

    try {
        const url = new URL(text.includes("://") ? text : `tcp://${text}`);
        const parsed = Number(url.port);
        if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
    } catch {
        // Fall back to extracting numeric chunks below.
    }

    const candidates = [...text.matchAll(/\d+/g)]
        .map((match) => Number(match[0]))
        .filter((parsed) => Number.isInteger(parsed) && parsed > 0 && parsed < 65536);

    return candidates.length ? candidates[candidates.length - 1] : fallback;
}

function readEnvFlag(name, fallback) {
    if (process.env[name] === undefined) return fallback;
    return ["1", "true", "yes", "on"].includes(String(process.env[name]).trim().toLowerCase());
}

const PORT = parsePort(process.env.PORT, 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 250);
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const MOBILE_SESSION_DAYS = Number(process.env.MOBILE_SESSION_DAYS || 30);
const COOKIE_SECURE = readEnvFlag("COOKIE_SECURE", process.env.NODE_ENV === "production");
const WEB_PUSH_SUBJECT = process.env.WEB_PUSH_SUBJECT || "mailto:admin@example.com";

function ensureWritableDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
}

function uniquePaths(paths) {
    return [...new Set(paths.filter(Boolean).map((item) => path.resolve(item)))];
}

function resolveWritableDir(label, preferredPath, fallbackPath) {
    const candidates = uniquePaths([
        preferredPath,
        fallbackPath,
        path.join(os.tmpdir(), "messenger", label.toLowerCase()),
    ]);

    for (const candidate of candidates) {
        try {
            const resolved = ensureWritableDir(candidate);
            if (path.resolve(preferredPath) !== resolved) {
                console.warn(`${label} is not writable at ${preferredPath}; using ${resolved}`);
            }
            return resolved;
        } catch (error) {
            console.warn(`${label} path is not writable: ${candidate} (${error.code || error.message})`);
        }
    }

    throw new Error(`Cannot find writable ${label} directory`);
}

function resolveWritableFile(label, preferredPath, fallbackPath) {
    const candidates = uniquePaths([
        preferredPath,
        fallbackPath,
        path.join(os.tmpdir(), "messenger", "data", path.basename(fallbackPath)),
    ]);

    for (const candidate of candidates) {
        try {
            ensureWritableDir(path.dirname(candidate));
            if (fs.existsSync(candidate)) {
                fs.accessSync(candidate, fs.constants.W_OK);
            }
            if (path.resolve(preferredPath) !== candidate) {
                console.warn(`${label} is not writable at ${preferredPath}; using ${candidate}`);
            }
            return candidate;
        } catch (error) {
            console.warn(`${label} path is not writable: ${candidate} (${error.code || error.message})`);
        }
    }

    throw new Error(`Cannot find writable ${label} file`);
}

const STORAGE_DIR = resolveWritableDir(
    "STORAGE_DIR",
    process.env.STORAGE_DIR || path.join(__dirname, "storage"),
    path.join(process.cwd(), ".runtime", "storage")
);
const DATA_DIR = resolveWritableDir(
    "DATA_DIR",
    process.env.DATA_DIR || path.join(STORAGE_DIR, "data"),
    path.join(STORAGE_DIR, "data")
);
const FILE_DIR = resolveWritableDir(
    "FILE_DIR",
    process.env.FILE_DIR || path.join(STORAGE_DIR, "files"),
    path.join(STORAGE_DIR, "files")
);
const DB_FILE = resolveWritableFile(
    "DB_FILE",
    process.env.DB_FILE || path.join(DATA_DIR, "messenger.sqlite"),
    path.join(DATA_DIR, "messenger.sqlite")
);

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, FILE_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 16);
            cb(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`);
        },
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

function now() {
    return new Date().toISOString();
}

function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
}

function run(sql, params = []) {
    return db.prepare(sql).run(...params);
}

function get(sql, params = []) {
    return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
    return db.prepare(sql).all(...params);
}

function tx(fn) {
    db.exec("BEGIN IMMEDIATE;");
    try {
        const result = fn();
        db.exec("COMMIT;");
        return result;
    } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
    }
}

function jsonList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return String(value)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }
}

function normalizeLogin(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizeTag(value) {
    return String(value || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 24);
}

function validateLogin(login) {
    return /^[a-z0-9_.-]{3,32}$/.test(login);
}

function generateCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const chunk = () =>
        Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    return `MSG-${chunk()}-${chunk()}-${chunk()}`;
}

function generatePassword() {
    return `Temp-${crypto.randomBytes(4).toString("hex")}`;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
    const [type, salt, hash] = String(storedHash || "").split("$");
    if (type !== "scrypt" || !salt || !hash) return false;

    const expected = Buffer.from(hash, "hex");
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function tokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(header) {
    return String(header || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
            const index = part.indexOf("=");
            if (index === -1) return acc;
            const key = decodeURIComponent(part.slice(0, index));
            const value = decodeURIComponent(part.slice(index + 1));
            acc[key] = value;
            return acc;
        }, {});
}

function cookieOptions(maxAgeSeconds) {
    const parts = [
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAgeSeconds}`,
    ];

    if (COOKIE_SECURE) parts.push("Secure");
    return parts.join("; ");
}

function setSessionCookie(res, token) {
    res.setHeader("Set-Cookie", `session=${encodeURIComponent(token)}; ${cookieOptions(SESSION_DAYS * 86400)}`);
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", `session=; ${cookieOptions(0)}`);
}

function publicFile(file) {
    if (!file) return null;

    return {
        id: file.id,
        url: `/files/${file.id}`,
        originalName: file.original_name,
        mimeType: file.mime_type,
        size: file.size,
        type: fileType(file.mime_type),
    };
}

function fileType(mimeType) {
    const mime = String(mimeType || "");
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "file";
}

function publicUser(user) {
    if (!user) return null;
    const role = userRole(user);

    return {
        id: user.id,
        login: user.login,
        name: user.name,
        tag: user.tag,
        role,
        bio: user.bio || "",
        isAdmin: role === "admin",
        isSubadmin: role === "subadmin",
        canPublish: ["admin", "subadmin"].includes(role),
        isBanned: Boolean(user.banned_at),
        banReason: user.banned_reason || "",
        isOnline: onlineUsers.has(user.id),
        lastSeenAt: onlineUsers.has(user.id) ? null : user.last_seen_at || user.updated_at || user.created_at,
        avatar: user.avatar_file_id ? `/files/${user.avatar_file_id}` : null,
        createdAt: user.created_at,
    };
}

function getUserById(id) {
    return get("SELECT * FROM users WHERE id = ?", [id]);
}

function getUserFromCookie(cookieHeader) {
    const token = parseCookies(cookieHeader).session;
    if (!token) return null;

    const session = get(
        `SELECT sessions.*, users.*
         FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
        [tokenHash(token), now()]
    );

    return session || null;
}

function createMobileSession(user, req) {
    const token = crypto.randomBytes(32).toString("base64url");
    const createdAt = now();
    const expiresAt = new Date(Date.now() + MOBILE_SESSION_DAYS * 86400 * 1000).toISOString();

    run(
        `INSERT INTO mobile_sessions (id, user_id, token_hash, user_agent, ip, created_at, expires_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            makeId("mobile"),
            user.id,
            tokenHash(token),
            String(req.headers["user-agent"] || "").slice(0, 500),
            req.ip || "",
            createdAt,
            expiresAt,
            createdAt,
        ]
    );

    return { token, expiresAt };
}

function mobileTokenFromRequest(req) {
    const header = String(req.headers.authorization || "");
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return String(match?.[1] || req.body?.mobileToken || req.query?.mobileToken || "").trim();
}

function getUserFromMobileToken(token) {
    if (!token) return null;

    const session = get(
        `SELECT mobile_sessions.id AS mobile_session_id, users.*
         FROM mobile_sessions
         JOIN users ON users.id = mobile_sessions.user_id
         WHERE mobile_sessions.token_hash = ?
           AND mobile_sessions.expires_at > ?
           AND mobile_sessions.revoked_at IS NULL`,
        [tokenHash(token), now()]
    );

    if (session?.mobile_session_id) {
        run("UPDATE mobile_sessions SET last_used_at = ? WHERE id = ?", [now(), session.mobile_session_id]);
    }

    return session || null;
}

function requireMobileUser(req, res, next) {
    const token = mobileTokenFromRequest(req);
    const user = getUserFromMobileToken(token);
    if (!user) {
        return res.status(401).json({ error: "Mobile token is invalid or expired" });
    }

    req.currentUser = user;
    req.mobileToken = token;
    req.mobileSessionId = user.mobile_session_id;
    next();
}

function requireUser(req, res, next) {
    const user = getUserFromCookie(req.headers.cookie);
    if (!user) {
        return res.status(401).json({ error: "Нужно войти в аккаунт" });
    }

    req.currentUser = user;
    next();
}

function normalizeRole(role) {
    return ["admin", "subadmin", "user"].includes(role) ? role : "user";
}

function userRole(user) {
    if (!user) return "user";
    if (user.is_admin) return "admin";
    return normalizeRole(user.role);
}

function isAdmin(user) {
    return userRole(user) === "admin";
}

function canPublish(user) {
    return ["admin", "subadmin"].includes(userRole(user));
}

function ensureNotBanned(user) {
    if (!user?.banned_at) return;
    const error = new Error(user.banned_reason ? `Вы забанены: ${user.banned_reason}` : "Вы забанены");
    error.status = 403;
    throw error;
}

function requireAdmin(req, res, next) {
    requireUser(req, res, () => {
        if (!isAdmin(req.currentUser)) {
            return res.status(403).json({ error: "Доступ только для админа" });
        }
        next();
    });
}

function requirePublisher(req, res, next) {
    requireUser(req, res, () => {
        if (!canPublish(req.currentUser)) {
            return res.status(403).json({ error: "Доступ только для админа или под-админа" });
        }
        next();
    });
}

function createSession(user, req, res) {
    const token = crypto.randomBytes(32).toString("base64url");
    const createdAt = now();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();

    run(
        `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            makeId("session"),
            user.id,
            tokenHash(token),
            String(req.headers["user-agent"] || "").slice(0, 500),
            req.ip || "",
            createdAt,
            expiresAt,
        ]
    );

    setSessionCookie(res, token);
}

function createSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            login TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            tag TEXT NOT NULL UNIQUE,
            avatar_file_id TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            bio TEXT NOT NULL DEFAULT '',
            banned_at TEXT,
            banned_reason TEXT NOT NULL DEFAULT '',
            last_seen_at TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            user_agent TEXT,
            ip TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS mobile_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            user_agent TEXT,
            ip TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_used_at TEXT,
            revoked_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS invite_codes (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            created_by TEXT,
            max_uses INTEGER NOT NULL DEFAULT 1,
            used_count INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT,
            role_on_signup TEXT NOT NULL DEFAULT 'user',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT NOT NULL UNIQUE,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
            title TEXT,
            owner_id TEXT,
            avatar_file_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS chat_members (
            chat_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
            joined_at TEXT NOT NULL,
            PRIMARY KEY (chat_id, user_id),
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS direct_chats (
            user_a TEXT NOT NULL,
            user_b TEXT NOT NULL,
            chat_id TEXT NOT NULL UNIQUE,
            PRIMARY KEY (user_a, user_b),
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            reply_to_message_id TEXT,
            body TEXT,
            kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'file', 'voice')),
            style TEXT NOT NULL DEFAULT '',
            client_nonce TEXT,
            deleted_for_all INTEGER NOT NULL DEFAULT 0,
            edited_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS message_attachments (
            message_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            PRIMARY KEY (message_id, file_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS message_deletions (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            deleted_at TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS message_reads (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            read_at TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS news (
            id TEXT PRIMARY KEY,
            author_id TEXT NOT NULL,
            text TEXT NOT NULL,
            image_file_id TEXT NOT NULL,
            visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all', 'selected')),
            created_at TEXT NOT NULL,
            updated_at TEXT,
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (image_file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS news_audience_users (
            news_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            PRIMARY KEY (news_id, user_id),
            FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS news_audience_chats (
            news_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            PRIMARY KEY (news_id, chat_id),
            FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS news_likes (
            news_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (news_id, user_id),
            FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS news_comments (
            id TEXT PRIMARY KEY,
            news_id TEXT NOT NULL,
            parent_id TEXT,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES news_comments(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS profile_posts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            image_file_id TEXT NOT NULL,
            caption TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (image_file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS profile_post_comments (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            parent_id TEXT,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (post_id) REFERENCES profile_posts(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES profile_post_comments(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS stickers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (user_id, file_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_wallpapers (
            chat_id TEXT PRIMARY KEY,
            color TEXT NOT NULL DEFAULT '',
            image_file_id TEXT,
            sticker_file_ids TEXT NOT NULL DEFAULT '[]',
            updated_by TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
            FOREIGN KEY (image_file_id) REFERENCES files(id) ON DELETE SET NULL,
            FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_user ON mobile_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_token ON mobile_sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_message_id);
        CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id, read_at);
        CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
        CREATE INDEX IF NOT EXISTS idx_profile_posts_user ON profile_posts(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_profile_post_comments_post ON profile_post_comments(post_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_stickers_user ON stickers(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
    `);
}

function migrateSchema() {
    const userColumns = all("PRAGMA table_info(users)");
    if (!userColumns.some((column) => column.name === "role")) {
        run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
        run("UPDATE users SET role = CASE WHEN is_admin = 1 THEN 'admin' ELSE 'user' END");
    }
    if (!userColumns.some((column) => column.name === "bio")) {
        run("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
    }
    if (!userColumns.some((column) => column.name === "banned_at")) {
        run("ALTER TABLE users ADD COLUMN banned_at TEXT");
    }
    if (!userColumns.some((column) => column.name === "banned_reason")) {
        run("ALTER TABLE users ADD COLUMN banned_reason TEXT NOT NULL DEFAULT ''");
    }
    if (!userColumns.some((column) => column.name === "last_seen_at")) {
        run("ALTER TABLE users ADD COLUMN last_seen_at TEXT");
    }

    const messageColumns = all("PRAGMA table_info(messages)");
    if (!messageColumns.some((column) => column.name === "reply_to_message_id")) {
        run("ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT");
    }
    if (!messageColumns.some((column) => column.name === "style")) {
        run("ALTER TABLE messages ADD COLUMN style TEXT NOT NULL DEFAULT ''");
    }
    if (!messageColumns.some((column) => column.name === "client_nonce")) {
        run("ALTER TABLE messages ADD COLUMN client_nonce TEXT");
    }
    run("CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_message_id)");
    run("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_nonce ON messages(sender_id, client_nonce) WHERE client_nonce IS NOT NULL");

    db.exec(`
        CREATE TABLE IF NOT EXISTS message_reads (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            read_at TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id, read_at);
        CREATE TABLE IF NOT EXISTS profile_posts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            image_file_id TEXT NOT NULL,
            caption TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (image_file_id) REFERENCES files(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_profile_posts_user ON profile_posts(user_id, created_at);
        CREATE TABLE IF NOT EXISTS profile_post_comments (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            parent_id TEXT,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (post_id) REFERENCES profile_posts(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES profile_post_comments(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_profile_post_comments_post ON profile_post_comments(post_id, created_at);
        CREATE TABLE IF NOT EXISTS stickers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (user_id, file_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_stickers_user ON stickers(user_id, created_at);
    `);

    const newsCommentColumns = all("PRAGMA table_info(news_comments)");
    if (!newsCommentColumns.some((column) => column.name === "parent_id")) {
        run("ALTER TABLE news_comments ADD COLUMN parent_id TEXT");
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            user_agent TEXT,
            ip TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_used_at TEXT,
            revoked_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_user ON mobile_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_token ON mobile_sessions(token_hash);
        CREATE TABLE IF NOT EXISTS chat_wallpapers (
            chat_id TEXT PRIMARY KEY,
            color TEXT NOT NULL DEFAULT '',
            image_file_id TEXT,
            sticker_file_ids TEXT NOT NULL DEFAULT '[]',
            updated_by TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
            FOREIGN KEY (image_file_id) REFERENCES files(id) ON DELETE SET NULL,
            FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
        );
    `);
}

function getSetting(key) {
    return get("SELECT value FROM settings WHERE key = ?", [key])?.value || null;
}

function setSetting(key, value) {
    run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value]
    );
}

function ensureVapidKeys() {
    let publicKey = process.env.VAPID_PUBLIC_KEY || getSetting("vapid_public_key");
    let privateKey = process.env.VAPID_PRIVATE_KEY || getSetting("vapid_private_key");

    if (!publicKey || !privateKey) {
        const keys = webpush.generateVAPIDKeys();
        publicKey = keys.publicKey;
        privateKey = keys.privateKey;
        setSetting("vapid_public_key", publicKey);
        setSetting("vapid_private_key", privateKey);
    }

    webpush.setVapidDetails(WEB_PUSH_SUBJECT, publicKey, privateKey);
}

function ensureBootstrapAdmin() {
    const count = get("SELECT COUNT(*) AS count FROM users").count;
    if (count > 0) return;

    const createdAt = now();
    const login = normalizeLogin(process.env.ADMIN_LOGIN || "admin");
    const password = process.env.ADMIN_PASSWORD || "admin123";
    const name = process.env.ADMIN_NAME || "Админ";

    run(
        `INSERT INTO users (id, login, password_hash, name, tag, role, is_admin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'admin', 1, ?, ?)`,
        [makeId("user"), login, hashPassword(password), name, normalizeTag(login), createdAt, createdAt]
    );

    console.log(`Bootstrap admin created: ${login} / ${password}`);
}

function ensureInitialInvite() {
    const count = get("SELECT COUNT(*) AS count FROM invite_codes").count;
    if (count > 0) return;

    const admin = get("SELECT id FROM users WHERE is_admin = 1 OR role = 'admin' ORDER BY created_at LIMIT 1");
    const code = process.env.INITIAL_INVITE_CODE || generateCode();

    run(
        `INSERT INTO invite_codes (id, code, created_by, max_uses, role_on_signup, created_at)
         VALUES (?, ?, ?, 5, 'user', ?)`,
        [makeId("invite"), code, admin?.id || null, now()]
    );

    console.log(`Initial invite code: ${code}`);
}

function fileFromUpload(file, ownerId) {
    if (!file) return null;

    const id = makeId("file");
    run(
        `INSERT INTO files (id, owner_id, original_name, stored_name, mime_type, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            ownerId,
            file.originalname || "file",
            file.filename,
            file.mimetype || "application/octet-stream",
            file.size || 0,
            now(),
        ]
    );

    return get("SELECT * FROM files WHERE id = ?", [id]);
}

function memberRow(chatId, userId) {
    return get("SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?", [chatId, userId]);
}

function requireChatMember(chatId, userId) {
    const member = memberRow(chatId, userId);
    if (!member) {
        const error = new Error("Нет доступа к чату");
        error.status = 403;
        throw error;
    }
    return member;
}

function canManageChat(chatId, user) {
    if (isAdmin(user)) return true;
    const member = memberRow(chatId, user.id);
    return member && ["owner", "admin"].includes(member.role);
}

function getChatMembers(chatId) {
    return all(
        `SELECT users.*, chat_members.role AS chat_role
         FROM chat_members
         JOIN users ON users.id = chat_members.user_id
         WHERE chat_members.chat_id = ?
         ORDER BY users.name`,
        [chatId]
    );
}

function wallpaperForClient(chatId) {
    const row = get("SELECT * FROM chat_wallpapers WHERE chat_id = ?", [chatId]);
    if (!row) {
        return {
            color: "",
            image: null,
            stickers: [],
            updatedAt: null,
        };
    }

    const stickerIds = jsonList(row.sticker_file_ids).slice(0, 40);
    const stickers = stickerIds
        .map((fileId) => publicFile(get("SELECT * FROM files WHERE id = ?", [fileId])))
        .filter(Boolean);

    return {
        color: row.color || "",
        image: publicFile(get("SELECT * FROM files WHERE id = ?", [row.image_file_id])),
        stickers,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
    };
}

function saveChatWallpaper(chatId, user, payload = {}, imageFile = null) {
    requireChatMember(chatId, user.id);
    ensureNotBanned(user);

    const color = String(payload.color || "").trim().slice(0, 140);
    const resetImage = payload.clearImage === "1" || payload.clearImage === true;
    const existing = get("SELECT * FROM chat_wallpapers WHERE chat_id = ?", [chatId]);
    const imageFileId = imageFile ? fileFromUpload(imageFile, user.id).id : resetImage ? null : existing?.image_file_id || null;
    const stickerIds = jsonList(payload.stickerFileIds)
        .map((fileId) => String(fileId || "").trim())
        .filter(Boolean)
        .slice(0, 40);

    stickerIds.forEach((fileId) => {
        const file = get("SELECT * FROM files WHERE id = ?", [fileId]);
        if (!file || !String(file.mime_type || "").startsWith("image/") || !canAccessFile(user.id, fileId)) {
            const error = new Error("РЎС‚РёРєРµСЂ РґР»СЏ РѕР±РѕРµРІ РЅРµ РЅР°Р№РґРµРЅ");
            error.status = 404;
            throw error;
        }
    });

    const stamp = now();
    run(
        `INSERT INTO chat_wallpapers (chat_id, color, image_file_id, sticker_file_ids, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
            color = excluded.color,
            image_file_id = excluded.image_file_id,
            sticker_file_ids = excluded.sticker_file_ids,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
        [chatId, color, imageFileId, JSON.stringify(stickerIds), user.id, stamp]
    );

    return wallpaperForClient(chatId);
}

function chatMediaForClient(chatId, userId) {
    requireChatMember(chatId, userId);
    return all(
        `SELECT messages.id AS message_id, messages.created_at, messages.style, files.*
         FROM message_attachments
         JOIN messages ON messages.id = message_attachments.message_id
         JOIN files ON files.id = message_attachments.file_id
         WHERE messages.chat_id = ?
           AND messages.deleted_for_all = 0
           AND (files.mime_type LIKE 'image/%' OR files.mime_type LIKE 'video/%' OR files.mime_type LIKE 'audio/%')
         ORDER BY messages.created_at DESC`,
        [chatId]
    ).map((row) => ({
        messageId: row.message_id,
        style: row.style || "",
        createdAt: row.created_at,
        file: publicFile(row),
    }));
}

function unreadCount(chatId, userId) {
    return get(
        `SELECT COUNT(*) AS count
         FROM messages
         WHERE messages.chat_id = ?
           AND messages.sender_id != ?
           AND messages.deleted_for_all = 0
           AND NOT EXISTS (
               SELECT 1 FROM message_reads
               WHERE message_reads.message_id = messages.id
                 AND message_reads.user_id = ?
           )
           AND NOT EXISTS (
               SELECT 1 FROM message_deletions
               WHERE message_deletions.message_id = messages.id
                 AND message_deletions.user_id = ?
           )`,
        [chatId, userId, userId, userId]
    ).count;
}

function markChatRead(chatId, userId) {
    requireChatMember(chatId, userId);
    const stamp = now();
    const messages = all(
        `SELECT id FROM messages
         WHERE chat_id = ?
           AND sender_id != ?
           AND deleted_for_all = 0
           AND NOT EXISTS (
               SELECT 1 FROM message_reads
               WHERE message_reads.message_id = messages.id
                 AND message_reads.user_id = ?
           )`,
        [chatId, userId, userId]
    );

    messages.forEach((message) => {
        run(
            "INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)",
            [message.id, userId, stamp]
        );
    });

    return { readMessageIds: messages.map((message) => message.id), readAt: stamp };
}

function emitChatRead(chatId, readerId, result) {
    if (!result.readMessageIds.length) return;
    getChatMembers(chatId).forEach((member) =>
        io.to(`user_${member.id}`).emit("chatRead", {
            chatId,
            readerId,
            readMessageIds: result.readMessageIds,
            readAt: result.readAt,
        })
    );
}

function chatForUser(chat, currentUserId) {
    const members = getChatMembers(chat.id);
    const latest = get(
        `SELECT messages.*
         FROM messages
         WHERE chat_id = ? AND deleted_for_all = 0
         ORDER BY created_at DESC
         LIMIT 1`,
        [chat.id]
    );

    let title = chat.title;
    let subtitle = `${members.length} участников`;
    let avatar = null;

    if (chat.type === "direct") {
        const other = members.find((member) => member.id !== currentUserId) || members[0];
        title = other?.name || "Личный чат";
        subtitle = other?.tag ? `@${other.tag}` : "Личный чат";
        avatar = other?.avatar_file_id ? `/files/${other.avatar_file_id}` : null;
    } else if (chat.avatar_file_id) {
        avatar = `/files/${chat.avatar_file_id}`;
    }

    return {
        id: chat.id,
        type: chat.type,
        title,
        subtitle,
        avatar,
        role: members.find((member) => member.id === currentUserId)?.chat_role || null,
        members: members.map(publicUser),
        unreadCount: unreadCount(chat.id, currentUserId),
        latestMessage: latest ? messageForClient(latest, currentUserId, { includeDeleted: true }) : null,
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
    };
}

function listChats(userId) {
    return all(
        `SELECT chats.*
         FROM chats
         JOIN chat_members ON chat_members.chat_id = chats.id
         WHERE chat_members.user_id = ?
         ORDER BY chats.updated_at DESC`,
        [userId]
    ).map((chat) => chatForUser(chat, userId));
}

function listChatMessages(chatId, userId, options = {}) {
    requireChatMember(chatId, userId);
    const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
    let before = options.beforeCreatedAt || options.before || "9999-12-31T23:59:59.999Z";

    if (options.beforeMessageId) {
        const beforeMessage = get("SELECT created_at FROM messages WHERE id = ? AND chat_id = ?", [options.beforeMessageId, chatId]);
        if (beforeMessage?.created_at) before = beforeMessage.created_at;
    }

    return all(
        `SELECT messages.*
         FROM messages
         WHERE messages.chat_id = ?
           AND messages.created_at < ?
           AND NOT EXISTS (
                SELECT 1 FROM message_deletions
                WHERE message_deletions.message_id = messages.id
                  AND message_deletions.user_id = ?
           )
         ORDER BY messages.created_at DESC
         LIMIT ?`,
        [chatId, before, userId, limit]
    )
        .reverse()
        .map((row) => messageForClient(row, userId))
        .filter(Boolean);
}

function sortedDirectPair(a, b) {
    return [a, b].sort();
}

function ensureDirectChat(currentUserId, targetUserId) {
    if (currentUserId === targetUserId) {
        const error = new Error("Нельзя создать чат с самим собой");
        error.status = 400;
        throw error;
    }

    const target = getUserById(targetUserId);
    if (!target) {
        const error = new Error("Пользователь не найден");
        error.status = 404;
        throw error;
    }

    const [userA, userB] = sortedDirectPair(currentUserId, targetUserId);
    const existing = get("SELECT chat_id FROM direct_chats WHERE user_a = ? AND user_b = ?", [userA, userB]);
    if (existing) return chatForUser(get("SELECT * FROM chats WHERE id = ?", [existing.chat_id]), currentUserId);

    return tx(() => {
        const createdAt = now();
        const chatId = makeId("chat");
        run(
            `INSERT INTO chats (id, type, title, owner_id, created_at, updated_at)
             VALUES (?, 'direct', NULL, ?, ?, ?)`,
            [chatId, currentUserId, createdAt, createdAt]
        );
        run("INSERT INTO direct_chats (user_a, user_b, chat_id) VALUES (?, ?, ?)", [userA, userB, chatId]);
        run("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", [chatId, userA, createdAt]);
        run("INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", [chatId, userB, createdAt]);
        return chatForUser(get("SELECT * FROM chats WHERE id = ?", [chatId]), currentUserId);
    });
}

function attachmentForMessage(messageId) {
    const file = get(
        `SELECT files.*
         FROM message_attachments
         JOIN files ON files.id = message_attachments.file_id
         WHERE message_attachments.message_id = ?
         LIMIT 1`,
        [messageId]
    );
    return publicFile(file);
}

function replyForMessage(message, currentUserId) {
    if (!message.reply_to_message_id || message.deleted_for_all) return null;

    const reply = get("SELECT * FROM messages WHERE id = ?", [message.reply_to_message_id]);
    if (!reply || reply.chat_id !== message.chat_id || reply.deleted_for_all) return null;

    const deletedForMe = get(
        "SELECT 1 FROM message_deletions WHERE message_id = ? AND user_id = ?",
        [reply.id, currentUserId]
    );
    if (deletedForMe) return null;

    const sender = getUserById(reply.sender_id);
    const attachment = attachmentForMessage(reply.id);
    const text = reply.body || attachment?.originalName || "Вложение";

    return {
        id: reply.id,
        sender: publicUser(sender),
        senderId: reply.sender_id,
        text: String(text).slice(0, 180),
    };
}

function messageForClient(message, currentUserId, options = {}) {
    const sender = getUserById(message.sender_id);
    const deletedForMe = get(
        "SELECT 1 FROM message_deletions WHERE message_id = ? AND user_id = ?",
        [message.id, currentUserId]
    );

    if (deletedForMe && !options.includeDeleted) return null;

    const chat = get("SELECT * FROM chats WHERE id = ?", [message.chat_id]);
    const members = getChatMembers(message.chat_id);
    const readRows = all(
        `SELECT message_reads.*, users.name, users.tag
         FROM message_reads
         JOIN users ON users.id = message_reads.user_id
         WHERE message_reads.message_id = ?
           AND message_reads.user_id != ?
         ORDER BY message_reads.read_at ASC`,
        [message.id, message.sender_id]
    );
    const canDeleteAll = Boolean(
        currentUserId === message.sender_id ||
            (chat?.type === "group" && canManageChat(message.chat_id, getUserById(currentUserId) || {}))
    );

    return {
        id: message.id,
        chatId: message.chat_id,
        sender: publicUser(sender),
        senderId: message.sender_id,
        text: message.deleted_for_all ? "" : message.body || "",
        kind: message.deleted_for_all ? "deleted" : message.kind,
        style: message.deleted_for_all ? "" : message.style || "",
        attachment: message.deleted_for_all ? null : attachmentForMessage(message.id),
        replyTo: replyForMessage(message, currentUserId),
        deletedForAll: Boolean(message.deleted_for_all),
        canEdit: currentUserId === message.sender_id && !message.deleted_for_all,
        canDeleteAll,
        readByCount: readRows.length,
        recipientCount: Math.max(0, members.length - 1),
        readBy: readRows.map((row) => ({ id: row.user_id, name: row.name, tag: row.tag, readAt: row.read_at })),
        readByMe: Boolean(get("SELECT 1 FROM message_reads WHERE message_id = ? AND user_id = ?", [message.id, currentUserId])),
        clientNonce: message.client_nonce || null,
        editedAt: message.edited_at,
        createdAt: message.created_at,
    };
}

function insertMessage(user, chatId, payload, options = {}) {
    requireChatMember(chatId, user.id);
    ensureNotBanned(user);

    const text = String(payload.text || "").trim().slice(0, 4000);
    const fileId = payload.fileId || null;
    const kind = payload.kind === "voice" ? "voice" : fileId ? "file" : "text";
    const style = ["sticker", "circle"].includes(payload.style) ? payload.style : "";
    const clientNonce = String(payload.clientNonce || "").slice(0, 120) || null;
    const replyToMessageId = payload.replyToMessageId || null;

    if (!text && !fileId) {
        const error = new Error("Нельзя отправить пустое сообщение");
        error.status = 400;
        throw error;
    }

    if (fileId) {
        const file = get("SELECT * FROM files WHERE id = ?", [fileId]);
        const hasFileAccess = options.ownerOnly ? file?.owner_id === user.id : canAccessFile(user.id, fileId);
        if (!file || !hasFileAccess) {
            const error = new Error("Файл не найден");
            error.status = 404;
            throw error;
        }
    }

    if (replyToMessageId) {
        const reply = get("SELECT * FROM messages WHERE id = ?", [replyToMessageId]);
        if (!reply || reply.chat_id !== chatId || reply.deleted_for_all) {
            const error = new Error("Нельзя ответить на это сообщение");
            error.status = 400;
            throw error;
        }
    }

    if (clientNonce) {
        const existing = get("SELECT * FROM messages WHERE sender_id = ? AND client_nonce = ?", [user.id, clientNonce]);
        if (existing) return messageForClient(existing, user.id);
    }

    return tx(() => {
        const messageId = makeId("msg");
        const createdAt = now();
        run(
            `INSERT INTO messages (id, chat_id, sender_id, reply_to_message_id, body, kind, style, client_nonce, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [messageId, chatId, user.id, replyToMessageId, text, kind, style, clientNonce, createdAt]
        );
        run("INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)", [messageId, user.id, createdAt]);

        if (fileId) {
            run("INSERT INTO message_attachments (message_id, file_id) VALUES (?, ?)", [messageId, fileId]);
        }

        run("UPDATE chats SET updated_at = ? WHERE id = ?", [createdAt, chatId]);
        const message = get("SELECT * FROM messages WHERE id = ?", [messageId]);
        return messageForClient(message, user.id);
    });
}

function visibleNewsWhere(userId) {
    return [
        `(
            news.visibility = 'all'
            OR news.author_id = ?
            OR EXISTS (
                SELECT 1 FROM news_audience_users
                WHERE news_audience_users.news_id = news.id
                  AND news_audience_users.user_id = ?
            )
            OR EXISTS (
                SELECT 1 FROM news_audience_chats
                JOIN chat_members ON chat_members.chat_id = news_audience_chats.chat_id
                WHERE news_audience_chats.news_id = news.id
                  AND chat_members.user_id = ?
            )
        )`,
        [userId, userId, userId],
    ];
}

function newsCanSee(newsId, userId) {
    const [where, params] = visibleNewsWhere(userId);
    return Boolean(get(`SELECT 1 FROM news WHERE id = ? AND ${where}`, [newsId, ...params]));
}

function newsForClient(item, currentUserId) {
    const author = getUserById(item.author_id);
    const image = get("SELECT * FROM files WHERE id = ?", [item.image_file_id]);
    const likesCount = get("SELECT COUNT(*) AS count FROM news_likes WHERE news_id = ?", [item.id]).count;
    const liked = Boolean(get("SELECT 1 FROM news_likes WHERE news_id = ? AND user_id = ?", [item.id, currentUserId]));
    const comments = all(
        `SELECT news_comments.*, users.name, users.tag, users.avatar_file_id, users.login, users.role, users.bio, users.is_admin, users.created_at AS user_created_at
         FROM news_comments
         JOIN users ON users.id = news_comments.user_id
         WHERE news_comments.news_id = ?
         ORDER BY news_comments.created_at ASC`,
        [item.id]
    ).map((comment) => ({
        id: comment.id,
        parentId: comment.parent_id || null,
        text: comment.text,
        createdAt: comment.created_at,
        user: publicUser({
            id: comment.user_id,
            login: comment.login,
            name: comment.name,
            tag: comment.tag,
            avatar_file_id: comment.avatar_file_id,
            role: comment.role,
            bio: comment.bio,
            is_admin: comment.is_admin,
            created_at: comment.user_created_at,
        }),
    }));

    const userIds = all("SELECT user_id FROM news_audience_users WHERE news_id = ?", [item.id]).map((row) => row.user_id);
    const chatIds = all("SELECT chat_id FROM news_audience_chats WHERE news_id = ?", [item.id]).map((row) => row.chat_id);

    return {
        id: item.id,
        text: item.text,
        image: publicFile(image),
        visibility: item.visibility,
        audience: { userIds, chatIds },
        author: publicUser(author),
        likesCount,
        liked,
        canManage: isAdmin(getUserById(currentUserId)) || item.author_id === currentUserId,
        comments,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
    };
}

function saveNewsAudience(newsId, visibility, userIds, chatIds) {
    run("DELETE FROM news_audience_users WHERE news_id = ?", [newsId]);
    run("DELETE FROM news_audience_chats WHERE news_id = ?", [newsId]);

    if (visibility !== "selected") return;

    [...new Set(userIds)].forEach((userId) => {
        if (getUserById(userId)) {
            run("INSERT OR IGNORE INTO news_audience_users (news_id, user_id) VALUES (?, ?)", [newsId, userId]);
        }
    });

    [...new Set(chatIds)].forEach((chatId) => {
        if (get("SELECT id FROM chats WHERE id = ?", [chatId])) {
            run("INSERT OR IGNORE INTO news_audience_chats (news_id, chat_id) VALUES (?, ?)", [newsId, chatId]);
        }
    });
}

function canAccessFile(userId, fileId) {
    const file = get("SELECT * FROM files WHERE id = ?", [fileId]);
    if (!file) return false;
    if (file.owner_id === userId) return true;

    if (get("SELECT 1 FROM users WHERE avatar_file_id = ?", [fileId])) return true;
    if (
        get(
            `SELECT 1
             FROM chats
             JOIN chat_members ON chat_members.chat_id = chats.id
             WHERE chats.avatar_file_id = ?
               AND chat_members.user_id = ?`,
            [fileId, userId]
        )
    ) {
        return true;
    }
    if (get("SELECT 1 FROM stickers WHERE file_id = ? AND user_id = ?", [fileId, userId])) return true;

    if (
        get(
            `SELECT 1
             FROM chat_wallpapers
             JOIN chat_members ON chat_members.chat_id = chat_wallpapers.chat_id
             WHERE chat_members.user_id = ?
               AND (
                    chat_wallpapers.image_file_id = ?
                    OR chat_wallpapers.sticker_file_ids LIKE ?
               )`,
            [userId, fileId, `%"${fileId}"%`]
        )
    ) {
        return true;
    }

    if (
        get(
            `SELECT 1
             FROM message_attachments
             JOIN messages ON messages.id = message_attachments.message_id
             JOIN chat_members ON chat_members.chat_id = messages.chat_id
             WHERE message_attachments.file_id = ?
               AND chat_members.user_id = ?`,
            [fileId, userId]
        )
    ) {
        return true;
    }

    const news = all("SELECT id FROM news WHERE image_file_id = ?", [fileId]);
    if (news.some((item) => newsCanSee(item.id, userId))) return true;

    return Boolean(get("SELECT 1 FROM profile_posts WHERE image_file_id = ?", [fileId]));
}

function sendPushToUsers(userIds, payload) {
    const uniqueIds = [...new Set(userIds)].filter(Boolean);
    uniqueIds.forEach((userId) => {
        const subscriptions = all("SELECT * FROM push_subscriptions WHERE user_id = ?", [userId]);
        subscriptions.forEach((subscription) => {
            const data = {
                endpoint: subscription.endpoint,
                keys: {
                    p256dh: subscription.p256dh,
                    auth: subscription.auth,
                },
            };

            webpush.sendNotification(data, JSON.stringify(payload)).catch((error) => {
                if ([404, 410].includes(error.statusCode)) {
                    run("DELETE FROM push_subscriptions WHERE id = ?", [subscription.id]);
                } else {
                    console.error("Push error:", error.message);
                }
            });
        });
    });
}

function notifyChatMembers(chatId, senderId, message) {
    const rawMessage = get("SELECT * FROM messages WHERE id = ?", [message.id]);
    const members = getChatMembers(chatId).filter((member) => member.id !== senderId);

    members.forEach((member) => {
        io.to(`user_${member.id}`).emit("newMessage", messageForClient(rawMessage, member.id));
    });

    sendPushToUsers(members.map((member) => member.id), {
        title: "Новое сообщение",
        body: "Откройте Messenger, чтобы прочитать",
        url: `/chat.html?chat=${encodeURIComponent(chatId)}`,
    });
}

function handleError(res, error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    return res.status(status).json({ error: error.message || "Ошибка сервера" });
}

const loginAttempts = new Map();

function allowLoginAttempt(key) {
    const windowMs = 15 * 60 * 1000;
    const limit = 12;
    const current = Date.now();
    const entry = loginAttempts.get(key) || { count: 0, first: current };

    if (current - entry.first > windowMs) {
        loginAttempts.set(key, { count: 1, first: current });
        return true;
    }

    entry.count += 1;
    loginAttempts.set(key, entry);
    return entry.count <= limit;
}

createSchema();
migrateSchema();
ensureVapidKeys();
ensureBootstrapAdmin();
ensureInitialInvite();

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        storage: "sqlite",
        dataDir: DATA_DIR,
        storageDir: STORAGE_DIR,
        dbFile: DB_FILE,
        time: now(),
    });
});

app.get("/push/key", requireUser, (req, res) => {
    res.json({ publicKey: getSetting("vapid_public_key") || process.env.VAPID_PUBLIC_KEY || null });
});

app.post("/push/subscribe", requireUser, (req, res) => {
    const subscription = req.body.subscription || req.body;
    const endpoint = String(subscription.endpoint || "");
    const p256dh = subscription.keys?.p256dh;
    const auth = subscription.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ error: "Некорректная push-подписка" });
    }

    const stamp = now();
    run(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
            user_id = excluded.user_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            updated_at = excluded.updated_at`,
        [makeId("push"), req.currentUser.id, endpoint, p256dh, auth, stamp, stamp]
    );

    res.json({ success: true });
});

app.post("/register", (req, res) => {
    try {
        const login = normalizeLogin(req.body.login);
        const password = String(req.body.password || "");
        const name = String(req.body.name || "").trim().slice(0, 60);
        const inviteCode = String(req.body.inviteCode || "").trim().toUpperCase();

        if (!validateLogin(login)) {
            return res.status(400).json({ error: "Логин: 3-32 символа, латиница, цифры, точка, дефис или _" });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: "Пароль должен быть минимум 6 символов" });
        }
        if (name.length < 2) {
            return res.status(400).json({ error: "Введите имя" });
        }

        const invite = get("SELECT * FROM invite_codes WHERE code = ?", [inviteCode]);
        if (!invite || !invite.is_active || invite.used_count >= invite.max_uses || (invite.expires_at && invite.expires_at < now())) {
            return res.status(403).json({ error: "Инвайт-код недействителен" });
        }

        const user = tx(() => {
            if (get("SELECT id FROM users WHERE login = ?", [login])) {
                const error = new Error("Такой логин уже занят");
                error.status = 409;
                throw error;
            }

            const tag = normalizeTag(login);
            if (get("SELECT id FROM users WHERE tag = ?", [tag])) {
                const error = new Error("Такой тег уже занят");
                error.status = 409;
                throw error;
            }

            const stamp = now();
            const id = makeId("user");
            const role = normalizeRole(invite.role_on_signup);
            run(
                `INSERT INTO users (id, login, password_hash, name, tag, role, is_admin, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, login, hashPassword(password), name, tag, role, role === "admin" ? 1 : 0, stamp, stamp]
            );
            run("UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?", [invite.id]);
            return getUserById(id);
        });

        createSession(user, req, res);
        res.status(201).json({ success: true, user: publicUser(user) });
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/login", (req, res) => {
    const login = normalizeLogin(req.body.login);
    const password = String(req.body.password || "");
    const key = `${req.ip}:${login}`;

    if (!allowLoginAttempt(key)) {
        return res.status(429).json({ error: "Слишком много попыток входа. Попробуйте позже" });
    }

    const user = get("SELECT * FROM users WHERE login = ?", [login]);
    if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ success: false, error: "Неверный логин или пароль" });
    }

    createSession(user, req, res);
    run("UPDATE users SET last_seen_at = ? WHERE id = ?", [now(), user.id]);
    res.json({ success: true, user: publicUser(user) });
});

app.post("/logout", requireUser, (req, res) => {
    const token = parseCookies(req.headers.cookie).session;
    if (token) run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash(token)]);
    clearSessionCookie(res);
    res.json({ success: true });
});

app.get("/me", requireUser, (req, res) => {
    res.json(publicUser(req.currentUser));
});

app.get("/users", requireUser, (req, res) => {
    const q = `%${normalizeTag(req.query.q || "")}%`;
    const users = all(
        `SELECT * FROM users
         WHERE id != ?
           AND (? = '%%' OR tag LIKE ? OR lower(name) LIKE ? OR login LIKE ?)
         ORDER BY name
         LIMIT 50`,
        [req.currentUser.id, q, q, q, q]
    ).map(publicUser);

    res.json(users);
});

app.post("/api/mobile/register", (req, res) => {
    try {
        const login = normalizeLogin(req.body.login);
        const password = String(req.body.password || "");
        const name = String(req.body.name || "").trim().slice(0, 60);
        const inviteCode = String(req.body.inviteCode || "").trim().toUpperCase();

        if (!validateLogin(login)) {
            return res.status(400).json({ error: "Login must be 3-32 characters: latin letters, numbers, dot, dash or underscore" });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }
        if (name.length < 2) {
            return res.status(400).json({ error: "Enter a display name" });
        }

        const invite = get("SELECT * FROM invite_codes WHERE code = ?", [inviteCode]);
        if (!invite || !invite.is_active || invite.used_count >= invite.max_uses || (invite.expires_at && invite.expires_at < now())) {
            return res.status(403).json({ error: "Invite code is invalid" });
        }

        const user = tx(() => {
            if (get("SELECT id FROM users WHERE login = ?", [login])) {
                const error = new Error("Login is already taken");
                error.status = 409;
                throw error;
            }

            const tag = normalizeTag(login);
            if (get("SELECT id FROM users WHERE tag = ?", [tag])) {
                const error = new Error("Tag is already taken");
                error.status = 409;
                throw error;
            }

            const stamp = now();
            const id = makeId("user");
            const role = normalizeRole(invite.role_on_signup);
            run(
                `INSERT INTO users (id, login, password_hash, name, tag, role, is_admin, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, login, hashPassword(password), name, tag, role, role === "admin" ? 1 : 0, stamp, stamp]
            );
            run("UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?", [invite.id]);
            return getUserById(id);
        });

        res.status(201).json({ success: true, user: publicUser(user) });
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/api/mobile/login", (req, res) => {
    try {
        const login = normalizeLogin(req.body.login);
        const password = String(req.body.password || "");
        const key = `${req.ip}:${login}`;

        if (!allowLoginAttempt(key)) {
            return res.status(429).json({ error: "Слишком много попыток входа. Попробуйте позже" });
        }

        const user = get("SELECT * FROM users WHERE login = ?", [login]);
        if (!user || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: "Неверный логин или пароль" });
        }
        if (user.banned_at) {
            return res.status(403).json({ error: user.banned_reason ? `Вы забанены: ${user.banned_reason}` : "Вы забанены" });
        }

        const mobileSession = createMobileSession(user, req);
        run("UPDATE users SET last_seen_at = ? WHERE id = ?", [now(), user.id]);

        res.json({
            user: publicUser(getUserById(user.id)),
            mobileToken: mobileSession.token,
            expiresAt: mobileSession.expiresAt,
        });
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/api/mobile/logout", requireMobileUser, (req, res) => {
    run("UPDATE mobile_sessions SET revoked_at = ? WHERE id = ?", [now(), req.mobileSessionId]);
    res.json({ success: true });
});

app.get("/api/mobile/me", requireMobileUser, (req, res) => {
    res.json(publicUser(req.currentUser));
});

app.get("/api/mobile/chats", requireMobileUser, (req, res) => {
    res.json(listChats(req.currentUser.id));
});

app.get("/api/mobile/chats/:id/messages", requireMobileUser, (req, res) => {
    try {
        res.json(
            listChatMessages(req.params.id, req.currentUser.id, {
                limit: req.query.limit,
                before: req.query.before,
                beforeMessageId: req.query.beforeMessageId,
                beforeCreatedAt: req.query.beforeCreatedAt,
            })
        );
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/api/mobile/chats/:id/read", requireMobileUser, (req, res) => {
    try {
        const result = markChatRead(req.params.id, req.currentUser.id);
        emitChatRead(req.params.id, req.currentUser.id, result);
        res.json({ success: true, ...result });
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/api/mobile/chats/:id/messages", requireMobileUser, (req, res) => {
    try {
        const message = insertMessage(req.currentUser, req.params.id, req.body);
        io.to(`user_${req.currentUser.id}`).emit("newMessage", message);
        notifyChatMembers(req.params.id, req.currentUser.id, message);
        res.status(201).json(message);
    } catch (error) {
        handleError(res, error);
    }
});

app.put("/profile", requireUser, upload.single("avatar"), (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const name = String(req.body.name || "").trim().slice(0, 60);
        const bio = String(req.body.bio || "").trim().slice(0, 500);
        const updates = [];
        const params = [];

        if (name.length >= 2) {
            updates.push("name = ?");
            params.push(name);
        }

        updates.push("bio = ?");
        params.push(bio);

        if (req.file) {
            const file = fileFromUpload(req.file, req.currentUser.id);
            updates.push("avatar_file_id = ?");
            params.push(file.id);
        }

        if (updates.length) {
            updates.push("updated_at = ?");
            params.push(now(), req.currentUser.id);
            run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
        }

        res.json(publicUser(getUserById(req.currentUser.id)));
    } catch (error) {
        handleError(res, error);
    }
});

function profilePostForClient(post) {
    const file = get("SELECT * FROM files WHERE id = ?", [post.image_file_id]);
    const comments = all(
        `SELECT profile_post_comments.*, users.name, users.tag, users.avatar_file_id, users.role, users.bio, users.is_admin, users.created_at AS user_created_at
         FROM profile_post_comments
         JOIN users ON users.id = profile_post_comments.user_id
         WHERE profile_post_comments.post_id = ?
         ORDER BY profile_post_comments.created_at ASC`,
        [post.id]
    ).map((comment) => ({
        id: comment.id,
        parentId: comment.parent_id || null,
        text: comment.text,
        createdAt: comment.created_at,
        user: publicUser({
            id: comment.user_id,
            login: comment.user_id,
            name: comment.name,
            tag: comment.tag,
            avatar_file_id: comment.avatar_file_id,
            role: comment.role,
            bio: comment.bio,
            is_admin: comment.is_admin,
            created_at: comment.user_created_at,
        }),
    }));

    return {
        id: post.id,
        caption: post.caption || "",
        image: publicFile(file),
        comments,
        createdAt: post.created_at,
    };
}

function profileForClient(user) {
    return {
        user: publicUser(user),
        posts: all(
            "SELECT * FROM profile_posts WHERE user_id = ? ORDER BY created_at DESC",
            [user.id]
        ).map(profilePostForClient),
    };
}

app.get("/profiles/:id", requireUser, (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    res.json(profileForClient(user));
});

app.post("/profile/posts", requireUser, upload.single("image"), (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        if (!req.file) return res.status(400).json({ error: "Выберите фотографию" });
        if (!String(req.file.mimetype || "").startsWith("image/")) {
            return res.status(400).json({ error: "В профиль можно добавить только фото" });
        }

        const caption = String(req.body.caption || "").trim().slice(0, 600);
        const post = tx(() => {
            const file = fileFromUpload(req.file, req.currentUser.id);
            const id = makeId("post");
            run(
                `INSERT INTO profile_posts (id, user_id, image_file_id, caption, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [id, req.currentUser.id, file.id, caption, now()]
            );
            return get("SELECT * FROM profile_posts WHERE id = ?", [id]);
        });

        res.status(201).json(profilePostForClient(post));
    } catch (error) {
        handleError(res, error);
    }
});

app.delete("/profile/posts/:id", requireUser, (req, res) => {
    const post = get("SELECT * FROM profile_posts WHERE id = ?", [req.params.id]);
    if (!post) return res.status(404).json({ error: "Пост не найден" });
    if (post.user_id !== req.currentUser.id && !isAdmin(req.currentUser)) {
        return res.status(403).json({ error: "Можно удалять только свои посты" });
    }
    run("DELETE FROM profile_posts WHERE id = ?", [post.id]);
    res.json({ success: true });
});

app.post("/profile/posts/:id/comments", requireUser, (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const post = get("SELECT * FROM profile_posts WHERE id = ?", [req.params.id]);
        if (!post) return res.status(404).json({ error: "Фото не найдено" });

        const text = String(req.body.text || "").trim().slice(0, 800);
        const parentId = req.body.parentId || null;
        if (!text) return res.status(400).json({ error: "Комментарий пустой" });
        if (parentId) {
            const parent = get("SELECT * FROM profile_post_comments WHERE id = ? AND post_id = ?", [parentId, post.id]);
            if (!parent) return res.status(400).json({ error: "Нельзя ответить на этот комментарий" });
        }

        run(
            "INSERT INTO profile_post_comments (id, post_id, parent_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [makeId("pcomment"), post.id, parentId, req.currentUser.id, text, now()]
        );
        res.status(201).json(profilePostForClient(get("SELECT * FROM profile_posts WHERE id = ?", [post.id])));
    } catch (error) {
        handleError(res, error);
    }
});

app.get("/admin/invites", requirePublisher, (req, res) => {
    res.json(
        all(
            `SELECT invite_codes.*, users.name AS creator_name
             FROM invite_codes
             LEFT JOIN users ON users.id = invite_codes.created_by
             ORDER BY invite_codes.created_at DESC`
        )
    );
});

app.post("/admin/invites", requirePublisher, (req, res) => {
    const maxUses = Math.max(1, Math.min(50, Number(req.body.maxUses || 1)));
    const expiresDays = Number(req.body.expiresDays || 0);
    const requestedRole = normalizeRole(String(req.body.role || "user"));
    const role = isAdmin(req.currentUser) ? requestedRole : "user";
    const code = generateCode();
    const expiresAt = expiresDays > 0 ? new Date(Date.now() + expiresDays * 86400 * 1000).toISOString() : null;

    run(
        `INSERT INTO invite_codes (id, code, created_by, max_uses, expires_at, role_on_signup, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [makeId("invite"), code, req.currentUser.id, maxUses, expiresAt, role, now()]
    );

    res.status(201).json({ code, maxUses, expiresAt, role });
});

app.patch("/admin/users/:id/role", requireAdmin, (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    const role = normalizeRole(String(req.body.role || "user"));
    if (user.id === req.currentUser.id && role !== "admin") {
        return res.status(400).json({ error: "Нельзя снять роль админа с самого себя" });
    }

    run(
        "UPDATE users SET role = ?, is_admin = ?, updated_at = ? WHERE id = ?",
        [role, role === "admin" ? 1 : 0, now(), user.id]
    );
    run("DELETE FROM sessions WHERE user_id = ? AND ? = 0", [user.id, role === userRole(user) ? 1 : 0]);
    res.json(publicUser(getUserById(user.id)));
});

app.post("/admin/users/:id/ban", requireAdmin, (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    if (user.id === req.currentUser.id) return res.status(400).json({ error: "Нельзя забанить самого себя" });

    const reason = String(req.body.reason || "").trim().slice(0, 400);
    run(
        "UPDATE users SET banned_at = ?, banned_reason = ?, updated_at = ? WHERE id = ?",
        [now(), reason, now(), user.id]
    );
    io.to(`user_${user.id}`).emit("userBanned", { reason });
    res.json(publicUser(getUserById(user.id)));
});

app.post("/admin/users/:id/unban", requireAdmin, (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    run("UPDATE users SET banned_at = NULL, banned_reason = '', updated_at = ? WHERE id = ?", [now(), user.id]);
    io.to(`user_${user.id}`).emit("userUnbanned");
    res.json(publicUser(getUserById(user.id)));
});

app.post("/admin/users/:id/reset-password", requireAdmin, (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    const password = String(req.body.password || generatePassword());
    if (password.length < 6) return res.status(400).json({ error: "Пароль должен быть минимум 6 символов" });

    run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [hashPassword(password), now(), user.id]);
    run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
    run("UPDATE mobile_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [now(), user.id]);
    res.json({ success: true, temporaryPassword: password });
});

app.post("/files", requireUser, upload.single("file"), (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        if (!req.file) return res.status(400).json({ error: "Файл не выбран" });
        const file = fileFromUpload(req.file, req.currentUser.id);
        res.status(201).json(publicFile(file));
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/api/mobile/files", requireMobileUser, upload.single("file"), (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        if (!req.file) return res.status(400).json({ error: "File was not selected" });
        const file = fileFromUpload(req.file, req.currentUser.id);
        res.status(201).json(publicFile(file));
    } catch (error) {
        handleError(res, error);
    }
});

function streamStoredFile(req, res, file) {
    const absolutePath = path.join(FILE_DIR, file.stored_name);
    if (!absolutePath.startsWith(FILE_DIR) || !fs.existsSync(absolutePath)) {
        return res.status(404).send("Not found");
    }

    const disposition = req.query.download === "1" ? "attachment" : "inline";
    const stat = fs.statSync(absolutePath);
    const range = req.headers.range;
    res.setHeader("Content-Type", file.mime_type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=604800");
    res.setHeader(
        "Content-Disposition",
        `${disposition}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`
    );

    if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match) {
            const start = match[1] ? Number(match[1]) : 0;
            const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
            if (Number.isInteger(start) && Number.isInteger(end) && start <= end && start < stat.size) {
                res.status(206);
                res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
                res.setHeader("Content-Length", end - start + 1);
                fs.createReadStream(absolutePath, { start, end }).pipe(res);
                return;
            }
        }
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
        return res.end();
    }

    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(absolutePath).pipe(res);
}

app.get("/api/mobile/files/:id", requireMobileUser, (req, res) => {
    const file = get("SELECT * FROM files WHERE id = ?", [req.params.id]);
    if (!file || !canAccessFile(req.currentUser.id, file.id)) {
        return res.status(404).send("Not found");
    }

    streamStoredFile(req, res, file);
});

app.get("/files/:id", requireUser, (req, res) => {
    const file = get("SELECT * FROM files WHERE id = ?", [req.params.id]);
    if (!file || !canAccessFile(req.currentUser.id, file.id)) {
        return res.status(404).send("Not found");
    }

    streamStoredFile(req, res, file);
});

function stickerForClient(sticker) {
    const file = get("SELECT * FROM files WHERE id = ?", [sticker.file_id]);
    return {
        id: sticker.id,
        file: publicFile(file),
        createdAt: sticker.created_at,
    };
}

app.get("/stickers", requireUser, (req, res) => {
    res.json(
        all(
            "SELECT * FROM stickers WHERE user_id = ? ORDER BY created_at DESC",
            [req.currentUser.id]
        ).map(stickerForClient)
    );
});

app.post("/stickers", requireUser, (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
    } catch (error) {
        return handleError(res, error);
    }
    const fileId = String(req.body.fileId || "");
    const file = get("SELECT * FROM files WHERE id = ?", [fileId]);
    if (!file || !canAccessFile(req.currentUser.id, file.id)) {
        return res.status(404).json({ error: "Файл не найден" });
    }
    if (!String(file.mime_type || "").startsWith("image/")) {
        return res.status(400).json({ error: "Стикером может быть только картинка" });
    }

    const id = makeId("sticker");
    run(
        `INSERT OR IGNORE INTO stickers (id, user_id, file_id, created_at)
         VALUES (?, ?, ?, ?)`,
        [id, req.currentUser.id, file.id, now()]
    );
    const sticker = get("SELECT * FROM stickers WHERE user_id = ? AND file_id = ?", [req.currentUser.id, file.id]);
    res.status(201).json(stickerForClient(sticker));
});

app.post("/stickers/upload", requireUser, upload.single("image"), (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        if (!req.file) return res.status(400).json({ error: "Р’С‹Р±РµСЂРёС‚Рµ РєР°СЂС‚РёРЅРєСѓ" });
        if (!String(req.file.mimetype || "").startsWith("image/")) {
            return res.status(400).json({ error: "РЎС‚РёРєРµСЂРѕРј РјРѕР¶РµС‚ Р±С‹С‚СЊ С‚РѕР»СЊРєРѕ РєР°СЂС‚РёРЅРєР°" });
        }
        const file = fileFromUpload(req.file, req.currentUser.id);
        const id = makeId("sticker");
        run(
            `INSERT OR IGNORE INTO stickers (id, user_id, file_id, created_at)
             VALUES (?, ?, ?, ?)`,
            [id, req.currentUser.id, file.id, now()]
        );
        const sticker = get("SELECT * FROM stickers WHERE user_id = ? AND file_id = ?", [req.currentUser.id, file.id]);
        res.status(201).json(stickerForClient(sticker));
    } catch (error) {
        handleError(res, error);
    }
});

app.get("/chats", requireUser, (req, res) => {
    res.json(listChats(req.currentUser.id));
});

app.post("/chats/direct", requireUser, (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const chat = ensureDirectChat(req.currentUser.id, req.body.userId);
        res.status(201).json(chat);
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/chats/group", requireUser, (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const title = String(req.body.title || "").trim().slice(0, 80);
        const requestedMemberIds = [...new Set(jsonList(req.body.memberIds).filter((id) => id !== req.currentUser.id))];
        const validMemberIds = requestedMemberIds.filter((id) => Boolean(getUserById(id)));
        const memberIds = [...new Set(validMemberIds.concat(req.currentUser.id))];
        if (title.length < 2) return res.status(400).json({ error: "Введите название группы" });
        if (!validMemberIds.length) return res.status(400).json({ error: "Выберите участников группы" });

        const chat = tx(() => {
            const chatId = makeId("chat");
            const stamp = now();
            run(
                `INSERT INTO chats (id, type, title, owner_id, created_at, updated_at)
                 VALUES (?, 'group', ?, ?, ?, ?)`,
                [chatId, title, req.currentUser.id, stamp, stamp]
            );
            memberIds.forEach((userId) => {
                if (!getUserById(userId)) return;
                run(
                    "INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
                    [chatId, userId, userId === req.currentUser.id ? "owner" : "member", stamp]
                );
            });
            return chatForUser(get("SELECT * FROM chats WHERE id = ?", [chatId]), req.currentUser.id);
        });

        res.status(201).json(chat);
    } catch (error) {
        handleError(res, error);
    }
});

app.get("/chats/:id/wallpaper", requireUser, (req, res) => {
    try {
        requireChatMember(req.params.id, req.currentUser.id);
        res.json(wallpaperForClient(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

app.put("/chats/:id/wallpaper", requireUser, upload.single("image"), (req, res) => {
    try {
        const wallpaper = saveChatWallpaper(req.params.id, req.currentUser, req.body, req.file);
        getChatMembers(req.params.id).forEach((member) => {
            io.to(`user_${member.id}`).emit("chatWallpaperUpdated", {
                chatId: req.params.id,
                wallpaper,
            });
        });
        res.json(wallpaper);
    } catch (error) {
        handleError(res, error);
    }
});

app.get("/chats/:id/profile", requireUser, (req, res) => {
    try {
        const chat = get("SELECT * FROM chats WHERE id = ?", [req.params.id]);
        if (!chat || chat.type !== "group") return res.status(404).json({ error: "Р“СЂСѓРїРїР° РЅРµ РЅР°Р№РґРµРЅР°" });
        requireChatMember(chat.id, req.currentUser.id);
        res.json({
            chat: chatForUser(chat, req.currentUser.id),
            members: getChatMembers(chat.id).map(publicUser),
            media: chatMediaForClient(chat.id, req.currentUser.id),
            canManage: Boolean(canManageChat(chat.id, req.currentUser)),
        });
    } catch (error) {
        handleError(res, error);
    }
});

app.put("/chats/:id/profile", requireUser, upload.single("avatar"), (req, res) => {
    try {
        const chat = get("SELECT * FROM chats WHERE id = ?", [req.params.id]);
        if (!chat || chat.type !== "group") return res.status(404).json({ error: "Р“СЂСѓРїРїР° РЅРµ РЅР°Р№РґРµРЅР°" });
        if (!canManageChat(chat.id, req.currentUser)) return res.status(403).json({ error: "РќРµС‚ РїСЂР°РІ" });
        const title = String(req.body.title || chat.title || "").trim().slice(0, 80);
        let avatarId = chat.avatar_file_id;
        if (req.file) {
            if (!String(req.file.mimetype || "").startsWith("image/")) {
                return res.status(400).json({ error: "РђРІР°С‚Р°СЂРєР° РіСЂСѓРїРїС‹ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РєР°СЂС‚РёРЅРєРѕР№" });
            }
            avatarId = fileFromUpload(req.file, req.currentUser.id).id;
        }
        run("UPDATE chats SET title = ?, avatar_file_id = ?, updated_at = ? WHERE id = ?", [title || chat.title, avatarId, now(), chat.id]);
        const updated = chatForUser(get("SELECT * FROM chats WHERE id = ?", [chat.id]), req.currentUser.id);
        getChatMembers(chat.id).forEach((member) => io.to(`user_${member.id}`).emit("chatUpdated", updated));
        res.json(updated);
    } catch (error) {
        handleError(res, error);
    }
});

app.get("/chats/:id/media", requireUser, (req, res) => {
    try {
        res.json(chatMediaForClient(req.params.id, req.currentUser.id));
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/chats/:id/members", requireUser, (req, res) => {
    try {
        if (!canManageChat(req.params.id, req.currentUser)) return res.status(403).json({ error: "Нет прав" });
        const role = req.body.role === "admin" ? "admin" : "member";
        if (!getUserById(req.body.userId)) return res.status(404).json({ error: "Пользователь не найден" });

        run(
            `INSERT INTO chat_members (chat_id, user_id, role, joined_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(chat_id, user_id) DO UPDATE SET role = excluded.role`,
            [req.params.id, req.body.userId, role, now()]
        );

        res.json(chatForUser(get("SELECT * FROM chats WHERE id = ?", [req.params.id]), req.currentUser.id));
    } catch (error) {
        handleError(res, error);
    }
});

app.delete("/chats/:id/members/:userId", requireUser, (req, res) => {
    try {
        if (!canManageChat(req.params.id, req.currentUser)) return res.status(403).json({ error: "Нет прав" });
        const member = memberRow(req.params.id, req.params.userId);
        if (member?.role === "owner") return res.status(400).json({ error: "Нельзя удалить владельца группы" });
        run("DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?", [req.params.id, req.params.userId]);
        res.json({ success: true });
    } catch (error) {
        handleError(res, error);
    }
});

app.get("/chats/:id/messages", requireUser, (req, res) => {
    try {
        res.json(
            listChatMessages(req.params.id, req.currentUser.id, {
                limit: req.query.limit,
                before: req.query.before,
                beforeMessageId: req.query.beforeMessageId,
                beforeCreatedAt: req.query.beforeCreatedAt,
            })
        );
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/chats/:id/messages", requireUser, (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const message = insertMessage(req.currentUser, req.params.id, req.body);
        io.to(`user_${req.currentUser.id}`).emit("newMessage", message);
        notifyChatMembers(req.params.id, req.currentUser.id, message);
        res.status(201).json(message);
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/chats/:id/read", requireUser, (req, res) => {
    try {
        const result = markChatRead(req.params.id, req.currentUser.id);
        emitChatRead(req.params.id, req.currentUser.id, result);
        res.json({ success: true, ...result });
    } catch (error) {
        handleError(res, error);
    }
});

app.patch("/messages/:id", requireUser, (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const message = get("SELECT * FROM messages WHERE id = ?", [req.params.id]);
        if (!message) return res.status(404).json({ error: "Сообщение не найдено" });
        if (message.sender_id !== req.currentUser.id) return res.status(403).json({ error: "Можно редактировать только свои сообщения" });
        if (message.deleted_for_all) return res.status(400).json({ error: "Сообщение удалено" });

        const text = String(req.body.text || "").trim().slice(0, 4000);
        if (!text) return res.status(400).json({ error: "Сообщение пустое" });

        run("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?", [text, now(), message.id]);
        const rawMessage = get("SELECT * FROM messages WHERE id = ?", [message.id]);
        getChatMembers(message.chat_id).forEach((member) =>
            io.to(`user_${member.id}`).emit("messageUpdated", messageForClient(rawMessage, member.id))
        );
        res.json(messageForClient(rawMessage, req.currentUser.id));
    } catch (error) {
        handleError(res, error);
    }
});

app.delete("/messages/:id", requireUser, (req, res) => {
    try {
        const mode = req.body.mode === "all" ? "all" : "me";
        const message = get("SELECT * FROM messages WHERE id = ?", [req.params.id]);
        if (!message) return res.status(404).json({ error: "Сообщение не найдено" });
        requireChatMember(message.chat_id, req.currentUser.id);

        if (mode === "all") {
            if (message.sender_id !== req.currentUser.id && !canManageChat(message.chat_id, req.currentUser)) {
                return res.status(403).json({ error: "Нет прав удалить у всех" });
            }
            run("UPDATE messages SET deleted_for_all = 1, body = '', edited_at = ? WHERE id = ?", [now(), message.id]);
            getChatMembers(message.chat_id).forEach((member) =>
                io.to(`user_${member.id}`).emit("messageDeleted", { id: message.id, chatId: message.chat_id, mode: "all" })
            );
        } else {
            run(
                "INSERT OR IGNORE INTO message_deletions (message_id, user_id, deleted_at) VALUES (?, ?, ?)",
                [message.id, req.currentUser.id, now()]
            );
        }

        res.json({ success: true });
    } catch (error) {
        handleError(res, error);
    }
});

app.post("/messages/:id/forward", requireUser, (req, res) => {
    try {
        const source = get("SELECT * FROM messages WHERE id = ?", [req.params.id]);
        if (!source) return res.status(404).json({ error: "Сообщение не найдено" });
        requireChatMember(source.chat_id, req.currentUser.id);
        if (source.deleted_for_all) return res.status(400).json({ error: "Нельзя переслать удалённое сообщение" });

        const deletedForMe = get(
            "SELECT 1 FROM message_deletions WHERE message_id = ? AND user_id = ?",
            [source.id, req.currentUser.id]
        );
        if (deletedForMe) return res.status(400).json({ error: "Нельзя переслать удалённое у себя сообщение" });

        let targetChat = null;
        if (req.body.targetUserId) {
            targetChat = ensureDirectChat(req.currentUser.id, req.body.targetUserId);
        } else if (req.body.targetChatId) {
            requireChatMember(req.body.targetChatId, req.currentUser.id);
            targetChat = chatForUser(get("SELECT * FROM chats WHERE id = ?", [req.body.targetChatId]), req.currentUser.id);
        }

        if (!targetChat) return res.status(400).json({ error: "Выберите получателя" });

        const attachment = get("SELECT file_id FROM message_attachments WHERE message_id = ? LIMIT 1", [source.id]);
        const message = insertMessage(
            req.currentUser,
            targetChat.id,
            {
                text: source.body || "",
                fileId: attachment?.file_id || null,
                kind: source.kind === "voice" ? "voice" : attachment ? "file" : "text",
                style: source.style || "",
            },
            { allowAccessibleFile: true }
        );

        io.to(`user_${req.currentUser.id}`).emit("newMessage", message);
        notifyChatMembers(targetChat.id, req.currentUser.id, message);
        res.status(201).json({ chat: chatForUser(get("SELECT * FROM chats WHERE id = ?", [targetChat.id]), req.currentUser.id), message });
    } catch (error) {
        handleError(res, error);
    }
});

app.get("/news", requireUser, (req, res) => {
    const [where, params] = visibleNewsWhere(req.currentUser.id);
    const items = all(`SELECT * FROM news WHERE ${where} ORDER BY created_at DESC`, params).map((item) =>
        newsForClient(item, req.currentUser.id)
    );
    res.json(items);
});

app.post("/news", requirePublisher, upload.single("image"), (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const text = String(req.body.text || "").trim().slice(0, 4000);
        const visibility = req.body.visibility === "selected" ? "selected" : "all";
        const userIds = jsonList(req.body.userIds);
        const chatIds = jsonList(req.body.chatIds);
        if (!text || !req.file) return res.status(400).json({ error: "Нужны текст и картинка новости" });
        if (!String(req.file.mimetype || "").startsWith("image/")) return res.status(400).json({ error: "Для новости нужна картинка" });

        const item = tx(() => {
            const file = fileFromUpload(req.file, req.currentUser.id);
            const id = makeId("news");
            run(
                `INSERT INTO news (id, author_id, text, image_file_id, visibility, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [id, req.currentUser.id, text, file.id, visibility, now()]
            );
            saveNewsAudience(id, visibility, userIds, chatIds);
            return get("SELECT * FROM news WHERE id = ?", [id]);
        });

        const targetUsers =
            visibility === "all"
                ? all("SELECT id FROM users WHERE id != ?", [req.currentUser.id]).map((row) => row.id)
                : [
                      ...userIds,
                      ...chatIds.flatMap((chatId) => getChatMembers(chatId).map((member) => member.id)),
                  ].filter((id) => id !== req.currentUser.id);
        sendPushToUsers(targetUsers, { title: "Новая новость", body: "Откройте ленту", url: "/chat.html?view=feed" });

        res.status(201).json(newsForClient(item, req.currentUser.id));
    } catch (error) {
        handleError(res, error);
    }
});

app.put("/news/:id", requirePublisher, upload.single("image"), (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const item = get("SELECT * FROM news WHERE id = ?", [req.params.id]);
        if (!item) return res.status(404).json({ error: "Новость не найдена" });
        if (!isAdmin(req.currentUser) && item.author_id !== req.currentUser.id) {
            return res.status(403).json({ error: "Можно редактировать только свои новости" });
        }

        const text = String(req.body.text || "").trim().slice(0, 4000);
        const visibility = req.body.visibility === "selected" ? "selected" : "all";
        const userIds = jsonList(req.body.userIds);
        const chatIds = jsonList(req.body.chatIds);

        tx(() => {
            let imageId = item.image_file_id;
            if (req.file) {
                if (!String(req.file.mimetype || "").startsWith("image/")) {
                    const error = new Error("Для новости нужна картинка");
                    error.status = 400;
                    throw error;
                }
                imageId = fileFromUpload(req.file, req.currentUser.id).id;
            }
            run(
                "UPDATE news SET text = ?, image_file_id = ?, visibility = ?, updated_at = ? WHERE id = ?",
                [text || item.text, imageId, visibility, now(), item.id]
            );
            saveNewsAudience(item.id, visibility, userIds, chatIds);
        });

        res.json(newsForClient(get("SELECT * FROM news WHERE id = ?", [item.id]), req.currentUser.id));
    } catch (error) {
        handleError(res, error);
    }
});

app.delete("/news/:id", requirePublisher, (req, res) => {
    const item = get("SELECT * FROM news WHERE id = ?", [req.params.id]);
    if (!item) return res.status(404).json({ error: "Новость не найдена" });
    if (!isAdmin(req.currentUser) && item.author_id !== req.currentUser.id) {
        return res.status(403).json({ error: "Можно удалять только свои новости" });
    }
    run("DELETE FROM news WHERE id = ?", [item.id]);
    res.json({ success: true });
});

app.post("/news/:id/like", requireUser, (req, res) => {
    if (!newsCanSee(req.params.id, req.currentUser.id)) return res.status(404).json({ error: "Новость не найдена" });
    const existing = get("SELECT 1 FROM news_likes WHERE news_id = ? AND user_id = ?", [req.params.id, req.currentUser.id]);
    if (existing) {
        run("DELETE FROM news_likes WHERE news_id = ? AND user_id = ?", [req.params.id, req.currentUser.id]);
    } else {
        run("INSERT INTO news_likes (news_id, user_id, created_at) VALUES (?, ?, ?)", [req.params.id, req.currentUser.id, now()]);
    }
    res.json(newsForClient(get("SELECT * FROM news WHERE id = ?", [req.params.id]), req.currentUser.id));
});

app.post("/news/:id/comments", requireUser, (req, res) => {
    try {
        ensureNotBanned(req.currentUser);
        const text = String(req.body.text || "").trim().slice(0, 800);
        const parentId = req.body.parentId || null;
        if (!text) return res.status(400).json({ error: "Комментарий пустой" });
        if (!newsCanSee(req.params.id, req.currentUser.id)) return res.status(404).json({ error: "Новость не найдена" });
        if (parentId) {
            const parent = get("SELECT * FROM news_comments WHERE id = ? AND news_id = ?", [parentId, req.params.id]);
            if (!parent) return res.status(400).json({ error: "Нельзя ответить на этот комментарий" });
        }
        run(
            "INSERT INTO news_comments (id, news_id, parent_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [makeId("comment"), req.params.id, parentId, req.currentUser.id, text, now()]
        );
        res.status(201).json(newsForClient(get("SELECT * FROM news WHERE id = ?", [req.params.id]), req.currentUser.id));
    } catch (error) {
        handleError(res, error);
    }
});

io.use((socket, next) => {
    const mobileToken = String(socket.handshake.auth?.token || "").trim();
    const user = getUserFromCookie(socket.handshake.headers.cookie) || getUserFromMobileToken(mobileToken);
    if (!user) return next(new Error("unauthorized"));
    socket.user = user;
    next();
});

io.on("connection", (socket) => {
    socket.join(`user_${socket.user.id}`);
    const count = onlineUsers.get(socket.user.id) || 0;
    onlineUsers.set(socket.user.id, count + 1);
    run("UPDATE users SET last_seen_at = ? WHERE id = ?", [now(), socket.user.id]);
    io.emit("presenceChanged", { userId: socket.user.id, isOnline: true, lastSeenAt: null });
    listChats(socket.user.id).forEach((chat) => socket.join(`chat_${chat.id}`));

    socket.on("sendMessage", (data, ack) => {
        try {
            const message = insertMessage(socket.user, data.chatId, data);
            io.to(`user_${socket.user.id}`).emit("newMessage", message);
            notifyChatMembers(data.chatId, socket.user.id, message);
            if (typeof ack === "function") ack({ success: true, message });
        } catch (error) {
            if (typeof ack === "function") ack({ success: false, error: error.message });
            socket.emit("messageError", { message: error.message });
        }
    });

    socket.on("joinChat", (chatId) => {
        if (memberRow(chatId, socket.user.id)) socket.join(`chat_${chatId}`);
    });

    socket.on("markRead", (chatId) => {
        try {
            const result = markChatRead(chatId, socket.user.id);
            if (result.readMessageIds.length) {
                getChatMembers(chatId).forEach((member) =>
                    io.to(`user_${member.id}`).emit("chatRead", {
                        chatId,
                        readerId: socket.user.id,
                        readMessageIds: result.readMessageIds,
                        readAt: result.readAt,
                    })
                );
            }
        } catch {
            // Ignore stale client read pings.
        }
    });

    socket.on("disconnect", () => {
        const current = onlineUsers.get(socket.user.id) || 0;
        if (current <= 1) {
            onlineUsers.delete(socket.user.id);
            const stamp = now();
            run("UPDATE users SET last_seen_at = ? WHERE id = ?", [stamp, socket.user.id]);
            io.emit("presenceChanged", { userId: socket.user.id, isOnline: false, lastSeenAt: stamp });
        } else {
            onlineUsers.set(socket.user.id, current - 1);
        }
    });
});

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: `Файл слишком большой. Лимит ${MAX_UPLOAD_MB} МБ` });
    }
    handleError(res, error);
});

server.listen(PORT, HOST, () => {
    console.log(`Messenger server started on http://${HOST}:${PORT}`);
    console.log(`PORT env: ${process.env.PORT || "(empty)"}; parsed port: ${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    console.log(`Storage directory: ${STORAGE_DIR}`);
});

function shutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
        db.close();
        process.exit(0);
    });

    setTimeout(() => {
        process.exit(0);
    }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
