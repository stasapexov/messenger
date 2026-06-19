const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const nodeCrypto = require("crypto");
const cors = require("cors");
const multer = require("multer");
const { Server } = require("socket.io");
const { encryptMessage, decryptMessage } = require("./crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");

const DEFAULT_USERS = [
    {
        id: "u_admin",
        login: "admin",
        password: "admin123",
        name: "Админ",
        tag: "admin",
        avatar: null,
        isAdmin: true,
    },
    {
        id: "u_demo",
        login: "demo",
        password: "1234",
        name: "Демо пользователь",
        tag: "demo",
        avatar: null,
        isAdmin: false,
    },
];

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        cb(null, `${Date.now()}-${nodeCrypto.randomBytes(6).toString("hex")}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: {
        fileSize: 25 * 1024 * 1024,
    },
});

function ensureStorage() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    if (!fs.existsSync(USERS_FILE)) {
        writeJson(USERS_FILE, DEFAULT_USERS);
    }

    if (!fs.existsSync(MESSAGES_FILE)) {
        writeJson(MESSAGES_FILE, []);
    }

    if (!fs.existsSync(NEWS_FILE)) {
        writeJson(NEWS_FILE, []);
    }

    normalizeUsers();
}

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        const raw = fs.readFileSync(file, "utf8");
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch (error) {
        console.error(`Cannot read ${path.basename(file)}:`, error.message);
        return fallback;
    }
}

function writeJson(file, value) {
    const tmpFile = `${file}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmpFile, file);
}

function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${nodeCrypto.randomBytes(4).toString("hex")}`;
}

function normalizeTag(value) {
    return String(value || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 24);
}

function makeUniqueTag(source, usedTags) {
    const cleanSource = normalizeTag(source) || "user";
    let candidate = cleanSource;
    let counter = 2;

    while (usedTags.has(candidate)) {
        candidate = `${cleanSource}${counter}`;
        counter += 1;
    }

    usedTags.add(candidate);
    return candidate;
}

function normalizeUsers() {
    const users = readJson(USERS_FILE, DEFAULT_USERS);
    const usedTags = new Set();
    let changed = false;

    users.forEach((user, index) => {
        if (!user.id) {
            user.id = makeId("u");
            changed = true;
        }

        if (!user.login) {
            user.login = `user${index + 1}`;
            changed = true;
        }

        if (!user.password) {
            user.password = "1234";
            changed = true;
        }

        if (!user.name) {
            user.name = user.login;
            changed = true;
        }

        const cleanTag = normalizeTag(user.tag || user.login || user.name);
        if (!cleanTag || usedTags.has(cleanTag) || cleanTag !== user.tag) {
            user.tag = makeUniqueTag(cleanTag || user.login || user.name, usedTags);
            changed = true;
        } else {
            usedTags.add(cleanTag);
        }

        if (typeof user.isAdmin !== "boolean") {
            user.isAdmin = false;
            changed = true;
        }

        if (!Object.prototype.hasOwnProperty.call(user, "avatar")) {
            user.avatar = null;
            changed = true;
        }
    });

    if (changed) {
        writeJson(USERS_FILE, users);
    }
}

function loadUsers() {
    return readJson(USERS_FILE, []);
}

function saveUsers(users) {
    writeJson(USERS_FILE, users);
}

function loadMessages() {
    return readJson(MESSAGES_FILE, []);
}

function saveMessages(messages) {
    writeJson(MESSAGES_FILE, messages);
}

function loadNews() {
    return readJson(NEWS_FILE, []);
}

function saveNews(news) {
    writeJson(NEWS_FILE, news);
}

function findUserById(id) {
    return loadUsers().find((user) => String(user.id) === String(id)) || null;
}

function publicUser(user) {
    if (!user) return null;

    return {
        id: user.id,
        name: user.name,
        tag: user.tag,
        avatar: user.avatar || null,
        isAdmin: Boolean(user.isAdmin),
    };
}

function getUserIdFromRequest(req) {
    return (
        req.headers["x-user-id"] ||
        req.body?.userId ||
        req.query?.userId ||
        req.params?.userId ||
        ""
    );
}

function requireUser(req, res, next) {
    const user = findUserById(getUserIdFromRequest(req));

    if (!user) {
        return res.status(401).json({ error: "Нужно войти в аккаунт" });
    }

    req.currentUser = user;
    next();
}

function requireAdmin(req, res, next) {
    const user = findUserById(getUserIdFromRequest(req));

    if (!user) {
        return res.status(401).json({ error: "Нужно войти в аккаунт" });
    }

    if (!user.isAdmin) {
        return res.status(403).json({ error: "Ленту могут редактировать только админы" });
    }

    req.currentUser = user;
    next();
}

function fileToAttachment(file) {
    if (!file) return null;

    return {
        id: makeId("file"),
        originalName: file.originalname || "file",
        fileName: file.filename,
        url: `/uploads/${file.filename}`,
        mimeType: file.mimetype || "application/octet-stream",
        size: file.size || 0,
        type: String(file.mimetype || "").startsWith("image/") ? "image" : "file",
    };
}

function messageForClient(message) {
    const text = decryptMessage(message.text || message.message || "");

    return {
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        sender_id: message.senderId,
        receiver_id: message.receiverId,
        text,
        message: text,
        attachment: message.attachment || null,
        createdAt: message.createdAt,
    };
}

function saveMessage(data) {
    const sender = findUserById(data.sender);
    const receiver = findUserById(data.receiver);
    const text = String(data.text || data.message || "").trim();
    const attachment = data.attachment || null;

    if (!sender || !receiver) {
        throw new Error("Пользователь не найден");
    }

    if (!text && !attachment) {
        throw new Error("Нельзя отправить пустое сообщение");
    }

    const messages = loadMessages();
    const message = {
        id: makeId("msg"),
        senderId: sender.id,
        receiverId: receiver.id,
        text: text ? encryptMessage(text) : "",
        attachment,
        createdAt: new Date().toISOString(),
    };

    messages.push(message);
    saveMessages(messages);

    return messageForClient(message);
}

function newsForClient(item, currentUserId) {
    const users = loadUsers();
    const author = users.find((user) => user.id === item.authorId);

    return {
        id: item.id,
        text: item.text,
        image: item.image || null,
        author: publicUser(author),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt || null,
        likesCount: Array.isArray(item.likes) ? item.likes.length : 0,
        liked: Array.isArray(item.likes) ? item.likes.includes(currentUserId) : false,
        comments: (item.comments || []).map((comment) => ({
            id: comment.id,
            text: comment.text,
            createdAt: comment.createdAt,
            user: publicUser(users.find((user) => user.id === comment.userId)),
        })),
    };
}

app.post("/login", (req, res) => {
    const login = String(req.body.login || "").trim();
    const password = String(req.body.password || "");
    const user = loadUsers().find(
        (candidate) => candidate.login === login && candidate.password === password
    );

    if (!user) {
        return res.json({ success: false });
    }

    res.json({
        success: true,
        user: publicUser(user),
        userId: user.id,
        userName: user.name,
        userTag: user.tag,
        isAdmin: Boolean(user.isAdmin),
    });
});

app.get("/me", requireUser, (req, res) => {
    res.json(publicUser(req.currentUser));
});

app.get("/users/:id", requireUser, (req, res) => {
    const users = loadUsers()
        .filter((user) => String(user.id) !== String(req.currentUser.id))
        .map(publicUser);

    res.json(users);
});

app.get("/search-users", requireUser, (req, res) => {
    const tag = normalizeTag(req.query.tag);

    if (!tag) {
        return res.json([]);
    }

    const users = loadUsers()
        .filter((user) => user.id !== req.currentUser.id)
        .filter((user) => user.tag.includes(tag))
        .slice(0, 12)
        .map(publicUser);

    res.json(users);
});

app.get("/profile/:id", requireUser, (req, res) => {
    const user = findUserById(req.params.id);

    if (!user) {
        return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json(publicUser(user));
});

app.put("/profile/:id", requireUser, upload.single("avatar"), (req, res) => {
    if (req.currentUser.id !== req.params.id && !req.currentUser.isAdmin) {
        return res.status(403).json({ error: "Можно менять только свой профиль" });
    }

    const users = loadUsers();
    const user = users.find((candidate) => candidate.id === req.params.id);

    if (!user) {
        return res.status(404).json({ error: "Пользователь не найден" });
    }

    const name = String(req.body.name || "").trim();
    if (name) {
        user.name = name.slice(0, 40);
    }

    if (req.file) {
        user.avatar = fileToAttachment(req.file).url;
    }

    saveUsers(users);
    res.json(publicUser(user));
});

app.post("/upload", requireUser, upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Файл не выбран" });
    }

    res.json({ attachment: fileToAttachment(req.file) });
});

app.get("/messages/:me/:him", requireUser, (req, res) => {
    if (req.currentUser.id !== req.params.me) {
        return res.status(403).json({ error: "Нет доступа к этим сообщениям" });
    }

    const me = String(req.params.me);
    const him = String(req.params.him);
    const messages = loadMessages()
        .filter(
            (message) =>
                (String(message.senderId) === me && String(message.receiverId) === him) ||
                (String(message.senderId) === him && String(message.receiverId) === me)
        )
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map(messageForClient);

    res.json(messages);
});

app.get("/news", requireUser, (req, res) => {
    const news = loadNews()
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((item) => newsForClient(item, req.currentUser.id));

    res.json(news);
});

app.post("/news", requireAdmin, upload.single("image"), (req, res) => {
    const text = String(req.body.text || "").trim();

    if (!text || !req.file) {
        return res.status(400).json({ error: "Нужны текст и картинка новости" });
    }

    if (!String(req.file.mimetype || "").startsWith("image/")) {
        return res.status(400).json({ error: "Для новости нужна картинка" });
    }

    const news = loadNews();
    const item = {
        id: makeId("news"),
        text: text.slice(0, 2000),
        image: fileToAttachment(req.file),
        authorId: req.currentUser.id,
        likes: [],
        comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: null,
    };

    news.push(item);
    saveNews(news);

    res.status(201).json(newsForClient(item, req.currentUser.id));
});

app.put("/news/:id", requireAdmin, upload.single("image"), (req, res) => {
    const news = loadNews();
    const item = news.find((candidate) => candidate.id === req.params.id);

    if (!item) {
        return res.status(404).json({ error: "Новость не найдена" });
    }

    const text = String(req.body.text || "").trim();
    if (text) {
        item.text = text.slice(0, 2000);
    }

    if (req.file) {
        if (!String(req.file.mimetype || "").startsWith("image/")) {
            return res.status(400).json({ error: "Для новости нужна картинка" });
        }

        item.image = fileToAttachment(req.file);
    }

    item.updatedAt = new Date().toISOString();
    saveNews(news);

    res.json(newsForClient(item, req.currentUser.id));
});

app.delete("/news/:id", requireAdmin, (req, res) => {
    const news = loadNews();
    const nextNews = news.filter((item) => item.id !== req.params.id);

    if (nextNews.length === news.length) {
        return res.status(404).json({ error: "Новость не найдена" });
    }

    saveNews(nextNews);
    res.json({ success: true });
});

app.post("/news/:id/like", requireUser, (req, res) => {
    const news = loadNews();
    const item = news.find((candidate) => candidate.id === req.params.id);

    if (!item) {
        return res.status(404).json({ error: "Новость не найдена" });
    }

    item.likes = Array.isArray(item.likes) ? item.likes : [];

    if (item.likes.includes(req.currentUser.id)) {
        item.likes = item.likes.filter((id) => id !== req.currentUser.id);
    } else {
        item.likes.push(req.currentUser.id);
    }

    saveNews(news);
    res.json(newsForClient(item, req.currentUser.id));
});

app.post("/news/:id/comments", requireUser, (req, res) => {
    const text = String(req.body.text || "").trim();

    if (!text) {
        return res.status(400).json({ error: "Комментарий пустой" });
    }

    const news = loadNews();
    const item = news.find((candidate) => candidate.id === req.params.id);

    if (!item) {
        return res.status(404).json({ error: "Новость не найдена" });
    }

    item.comments = Array.isArray(item.comments) ? item.comments : [];
    item.comments.push({
        id: makeId("comment"),
        userId: req.currentUser.id,
        text: text.slice(0, 600),
        createdAt: new Date().toISOString(),
    });

    saveNews(news);
    res.status(201).json(newsForClient(item, req.currentUser.id));
});

io.on("connection", (socket) => {
    socket.on("join", (userId) => {
        const user = findUserById(userId);

        if (user) {
            socket.userId = user.id;
            socket.join(`user_${user.id}`);
        }
    });

    socket.on("sendMessage", (data) => {
        try {
            if (!socket.userId || String(socket.userId) !== String(data.sender)) {
                throw new Error("Нужно войти в аккаунт");
            }

            const payload = saveMessage(data);

            io.to(`user_${payload.receiverId}`).emit("newMessage", payload);
            io.to(`user_${payload.senderId}`).emit("newMessage", payload);
        } catch (error) {
            socket.emit("messageError", {
                message: error.message || "Не удалось отправить сообщение",
            });
        }
    });
});

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: "Файл слишком большой или поврежден" });
    }

    console.error(error);
    res.status(500).json({ error: "Ошибка сервера" });
});

ensureStorage();

server.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});
