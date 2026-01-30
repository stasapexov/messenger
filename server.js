const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const db = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

//// 🔐 ВХОД
app.post("/login", (req, res) => {
    const { login, password } = req.body;

    const sql = "SELECT id, name FROM users WHERE login=? AND password=?";
    db.query(sql, [login, password], (err, result) => {
        if (err) {
            console.error("Login error:", err);
            return res.status(500).json({ success: false, error: "Database error" });
        }
        if (result.length > 0) {
            res.json({
                success: true,
                userId: result[0].id,
                userName: result[0].name
            });
        } else {
            res.json({ success: false });
        }
    });
});

//// 👥 СПИСОК ПОЛЬЗОВАТЕЛЕЙ
app.get("/users/:id", (req, res) => {
    db.query("SELECT id, name FROM users WHERE id != ?", [req.params.id], (err, result) => {
        if (err) {
            console.error("Users fetch error:", err);
            return res.status(500).json({ error: "Database error" });
        }
        res.json(result);
    });
});

//// 💬 ЗАГРУЗКА СООБЩЕНИЙ
app.get("/messages/:me/:him", (req, res) => {
    const { me, him } = req.params;
    const sql = `SELECT sender_id, message FROM messages
                 WHERE (sender_id=? AND receiver_id=?)
                    OR (sender_id=? AND receiver_id=?)
                 ORDER BY created_at`;
    db.query(sql, [me, him, him, me], (err, result) => {
        if (err) {
            console.error("Messages fetch error:", err);
            return res.status(500).json({ error: "Database error" });
        }
        res.json(result);
    });
});

//// ⚡ РЕАЛТАЙМ ЧАТ
io.on("connection", (socket) => {

    socket.on("join", (userId) => {
        socket.join("user_" + userId);
    });

    socket.on("sendMessage", (data) => {
        const { sender, receiver, message } = data;

        db.query(
            "INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)",
            [sender, receiver, message],
            (err) => {
                if (err) {
                    console.error("Message save error:", err);
                    return;
                }
                io.to("user_" + receiver).emit("newMessage", data);
                io.to("user_" + sender).emit("newMessage", data);
            }
        );
    });
});

server.listen(3000, () => console.log("Server started on port 3000"));
