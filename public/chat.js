const socket = io();

const myId = localStorage.getItem("userId");
if (!myId) window.location = "index.html";

const state = {
    me: {
        id: myId,
        name: localStorage.getItem("userName") || "",
        tag: localStorage.getItem("userTag") || "",
        avatar: localStorage.getItem("avatar") || "",
        isAdmin: localStorage.getItem("isAdmin") === "true",
    },
    users: [],
    selectedUser: null,
    selectedFile: null,
    editingNewsId: null,
};

socket.emit("join", myId);

const els = {
    headerAvatar: document.getElementById("headerAvatar"),
    headerName: document.getElementById("headerName"),
    headerTag: document.getElementById("headerTag"),
    logoutButton: document.getElementById("logoutButton"),
    users: document.getElementById("users"),
    searchInput: document.getElementById("tagSearch"),
    searchButton: document.getElementById("tagSearchButton"),
    searchResults: document.getElementById("searchResults"),
    emptyChat: document.getElementById("emptyChat"),
    chatContent: document.getElementById("chatContent"),
    chatAvatar: document.getElementById("chatAvatar"),
    chatName: document.getElementById("chatName"),
    chatTag: document.getElementById("chatTag"),
    closeChatButton: document.getElementById("closeChatButton"),
    messages: document.getElementById("messages"),
    messageForm: document.getElementById("messageForm"),
    messageFile: document.getElementById("messageFile"),
    text: document.getElementById("text"),
    attachmentPreview: document.getElementById("attachmentPreview"),
    attachmentName: document.getElementById("attachmentName"),
    clearAttachment: document.getElementById("clearAttachment"),
    newsForm: document.getElementById("newsForm"),
    newsFormTitle: document.getElementById("newsFormTitle"),
    newsText: document.getElementById("newsText"),
    newsImage: document.getElementById("newsImage"),
    saveNewsButton: document.getElementById("saveNewsButton"),
    cancelNewsEdit: document.getElementById("cancelNewsEdit"),
    newsList: document.getElementById("newsList"),
    profilePanel: document.getElementById("profilePanel"),
};

function authHeaders() {
    return { "x-user-id": myId };
}

async function api(path, options = {}) {
    const headers = {
        ...authHeaders(),
        ...(options.headers || {}),
    };

    if (options.body && !(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Ошибка запроса");
    }

    return data;
}

function avatarContent(user) {
    if (user?.avatar) {
        return `<img src="${user.avatar}" alt="">`;
    }

    const name = user?.name || user?.tag || "?";
    return `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatTag(user) {
    return user?.tag ? `@${user.tag}` : "";
}

function formatTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function syncHeader() {
    els.headerAvatar.innerHTML = avatarContent(state.me);
    els.headerName.textContent = state.me.name;
    els.headerTag.textContent = formatTag(state.me);
}

function switchView(viewId, options = {}) {
    document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.id === viewId);
    });
    document.querySelectorAll(".nav-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.view === viewId);
    });

    if (viewId === "viewFeed") loadNews();
    if (viewId === "viewProfile" && !options.skipProfileLoad) showProfile(state.me.id);
}

async function loadMe() {
    const me = await api("/me");
    state.me = me;
    localStorage.setItem("userName", me.name);
    localStorage.setItem("userTag", me.tag);
    localStorage.setItem("isAdmin", String(me.isAdmin));
    localStorage.setItem("avatar", me.avatar || "");
    syncHeader();

    els.newsForm.classList.toggle("hidden", !me.isAdmin);
}

async function loadUsers() {
    state.users = await api(`/users/${myId}`);
    renderUsers();
}

function renderUsers() {
    els.users.innerHTML = "";

    if (!state.users.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Пока нет контактов";
        els.users.appendChild(empty);
        return;
    }

    state.users.forEach((user) => {
        els.users.appendChild(userRow(user));
    });
}

function userRow(user) {
    const row = document.createElement("div");
    row.className = "user-row";
    if (state.selectedUser?.id === user.id) row.classList.add("active");

    row.innerHTML = `
        <button class="avatar-button small" type="button">${avatarContent(user)}</button>
        <button class="user-main" type="button">
            <strong>${escapeHtml(user.name)}</strong>
            <span>${escapeHtml(formatTag(user))}</span>
        </button>
        <button class="mini-button" type="button">Профиль</button>
    `;

    row.querySelector(".avatar-button").addEventListener("click", () => showProfile(user.id));
    row.querySelector(".user-main").addEventListener("click", () => selectUser(user));
    row.querySelector(".mini-button").addEventListener("click", () => showProfile(user.id));

    return row;
}

async function searchUsers() {
    const tag = els.searchInput.value.trim().replace(/^@+/, "");

    if (!tag) {
        els.searchResults.innerHTML = "";
        return;
    }

    const users = await api(`/search-users?tag=${encodeURIComponent(tag)}`);
    els.searchResults.innerHTML = "";

    if (!users.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state compact";
        empty.textContent = "Никого не найдено";
        els.searchResults.appendChild(empty);
        return;
    }

    users.forEach((user) => {
        const row = userRow(user);
        row.classList.add("search-item");
        els.searchResults.appendChild(row);
    });
}

async function selectUser(user) {
    state.selectedUser = user;
    renderUsers();
    els.emptyChat.classList.add("hidden");
    els.chatContent.classList.remove("hidden");
    els.chatAvatar.innerHTML = avatarContent(user);
    els.chatName.textContent = user.name;
    els.chatTag.textContent = formatTag(user);
    await loadMessages();
}

async function loadMessages() {
    if (!state.selectedUser) return;

    const messages = await api(`/messages/${myId}/${state.selectedUser.id}`);
    els.messages.innerHTML = "";
    messages.forEach((message) => addMessage(message, message.senderId === myId));
    scrollMessages();
}

function scrollMessages() {
    els.messages.scrollTop = els.messages.scrollHeight;
}

function addMessage(message, isMe) {
    const msg = document.createElement("div");
    msg.className = `msg ${isMe ? "me" : "him"}`;

    if (message.text) {
        const text = document.createElement("div");
        text.className = "msg-text";
        text.textContent = message.text;
        msg.appendChild(text);
    }

    if (message.attachment) {
        msg.appendChild(attachmentElement(message.attachment));
    }

    const time = document.createElement("time");
    time.textContent = formatTime(message.createdAt);
    msg.appendChild(time);

    els.messages.appendChild(msg);
}

function attachmentElement(attachment) {
    const wrap = document.createElement("a");
    wrap.className = `attachment ${attachment.type === "image" ? "image" : "file"}`;
    wrap.href = attachment.url;
    wrap.target = "_blank";
    wrap.rel = "noreferrer";

    if (attachment.type === "image") {
        const img = document.createElement("img");
        img.src = attachment.url;
        img.alt = attachment.originalName || "image";
        wrap.appendChild(img);
    }

    const label = document.createElement("span");
    label.textContent = attachment.originalName || "Файл";
    wrap.appendChild(label);

    return wrap;
}

function updateAttachmentPreview() {
    const file = state.selectedFile;
    els.attachmentPreview.classList.toggle("hidden", !file);
    els.attachmentName.textContent = file ? file.name : "";
}

async function uploadSelectedFile() {
    if (!state.selectedFile) return null;

    const formData = new FormData();
    formData.append("file", state.selectedFile);
    const data = await api("/upload", {
        method: "POST",
        body: formData,
    });

    return data.attachment;
}

async function sendMessage(event) {
    event.preventDefault();

    if (!state.selectedUser) return;

    const text = els.text.value.trim();
    if (!text && !state.selectedFile) return;

    const attachment = await uploadSelectedFile();

    socket.emit("sendMessage", {
        sender: myId,
        receiver: state.selectedUser.id,
        text,
        attachment,
    });

    els.text.value = "";
    els.messageFile.value = "";
    state.selectedFile = null;
    updateAttachmentPreview();
}

async function loadNews() {
    const news = await api("/news");
    renderNews(news);
}

function renderNews(news) {
    els.newsList.innerHTML = "";

    if (!news.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Лента пока пустая";
        els.newsList.appendChild(empty);
        return;
    }

    news.forEach((item) => els.newsList.appendChild(newsCard(item)));
}

function newsCard(item) {
    const card = document.createElement("article");
    card.className = "news-card";

    const adminActions = state.me.isAdmin
        ? `<div class="news-admin">
            <button type="button" data-action="edit">Изменить</button>
            <button type="button" data-action="delete">Удалить</button>
        </div>`
        : "";

    card.innerHTML = `
        ${item.image ? `<img class="news-image" src="${item.image.url}" alt="">` : ""}
        <div class="news-body">
            <div class="news-meta">
                <span>${escapeHtml(item.author?.name || "Админ")}</span>
                <time>${escapeHtml(formatTime(item.createdAt))}</time>
            </div>
            <p>${escapeHtml(item.text)}</p>
            <div class="news-actions">
                <button type="button" data-action="like">${item.liked ? "Нравится" : "Лайк"} · ${item.likesCount}</button>
            </div>
            ${adminActions}
            <div class="comments"></div>
            <form class="comment-form">
                <input type="text" placeholder="Комментарий" required>
                <button type="submit">↑</button>
            </form>
        </div>
    `;

    const comments = card.querySelector(".comments");
    item.comments.forEach((comment) => {
        const row = document.createElement("div");
        row.className = "comment";
        row.innerHTML = `
            <strong>${escapeHtml(comment.user?.name || "Пользователь")}</strong>
            <span>${escapeHtml(comment.text)}</span>
        `;
        comments.appendChild(row);
    });

    card.querySelector('[data-action="like"]').addEventListener("click", async () => {
        await api(`/news/${item.id}/like`, { method: "POST", body: {} });
        await loadNews();
    });

    const editButton = card.querySelector('[data-action="edit"]');
    if (editButton) {
        editButton.addEventListener("click", () => startNewsEdit(item));
    }

    const deleteButton = card.querySelector('[data-action="delete"]');
    if (deleteButton) {
        deleteButton.addEventListener("click", async () => {
            if (!confirm("Удалить новость?")) return;
            await api(`/news/${item.id}`, { method: "DELETE" });
            await loadNews();
        });
    }

    card.querySelector(".comment-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = event.currentTarget.querySelector("input");
        await api(`/news/${item.id}/comments`, {
            method: "POST",
            body: { text: input.value },
        });
        input.value = "";
        await loadNews();
    });

    return card;
}

function startNewsEdit(item) {
    state.editingNewsId = item.id;
    els.newsText.value = item.text;
    els.newsImage.value = "";
    els.newsFormTitle.textContent = "Редактирование";
    els.saveNewsButton.textContent = "Сохранить";
    els.newsForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetNewsForm() {
    state.editingNewsId = null;
    els.newsText.value = "";
    els.newsImage.value = "";
    els.newsFormTitle.textContent = "Новая новость";
    els.saveNewsButton.textContent = "Опубликовать";
}

async function saveNews(event) {
    event.preventDefault();

    const formData = new FormData();
    formData.append("text", els.newsText.value);

    if (els.newsImage.files[0]) {
        formData.append("image", els.newsImage.files[0]);
    }

    const path = state.editingNewsId ? `/news/${state.editingNewsId}` : "/news";
    const method = state.editingNewsId ? "PUT" : "POST";

    await api(path, {
        method,
        body: formData,
    });

    resetNewsForm();
    await loadNews();
}

async function showProfile(userId) {
    const profile = await api(`/profile/${userId}`);
    const isMe = profile.id === state.me.id;

    switchView("viewProfile", { skipProfileLoad: true });

    els.profilePanel.innerHTML = `
        <div class="profile-hero">
            <div class="profile-avatar">${avatarContent(profile)}</div>
            <h2>${escapeHtml(profile.name)}</h2>
            <p>${escapeHtml(formatTag(profile))}</p>
            ${profile.isAdmin ? '<span class="role-badge">Админ</span>' : ""}
        </div>
        <div class="profile-actions"></div>
    `;

    const actions = els.profilePanel.querySelector(".profile-actions");

    if (isMe) {
        const form = document.createElement("form");
        form.className = "profile-form";
        form.innerHTML = `
            <input type="text" name="name" value="${escapeHtml(profile.name)}" maxlength="40" required>
            <input type="file" name="avatar" accept="image/*">
            <button type="submit">Сохранить</button>
        `;
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const updated = await api(`/profile/${state.me.id}`, {
                method: "PUT",
                body: formData,
            });
            state.me = updated;
            localStorage.setItem("userName", updated.name);
            localStorage.setItem("userTag", updated.tag);
            localStorage.setItem("avatar", updated.avatar || "");
            syncHeader();
            await showProfile(updated.id);
            await loadUsers();
        });
        actions.appendChild(form);
    } else {
        const writeButton = document.createElement("button");
        writeButton.type = "button";
        writeButton.textContent = "Написать";
        writeButton.addEventListener("click", async () => {
            await selectUser(profile);
            switchView("viewChats");
        });
        actions.appendChild(writeButton);
    }
}

function logout() {
    localStorage.removeItem("userId");
    localStorage.removeItem("userName");
    localStorage.removeItem("userTag");
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("avatar");
    window.location = "index.html";
}

document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
});

els.headerAvatar.addEventListener("click", () => showProfile(state.me.id));
els.logoutButton.addEventListener("click", logout);
els.searchButton.addEventListener("click", searchUsers);
els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchUsers();
});
els.closeChatButton.addEventListener("click", () => {
    state.selectedUser = null;
    els.chatContent.classList.add("hidden");
    els.emptyChat.classList.remove("hidden");
    renderUsers();
});
els.chatAvatar.addEventListener("click", () => {
    if (state.selectedUser) showProfile(state.selectedUser.id);
});
els.messageForm.addEventListener("submit", sendMessage);
els.messageFile.addEventListener("change", () => {
    state.selectedFile = els.messageFile.files[0] || null;
    updateAttachmentPreview();
});
els.clearAttachment.addEventListener("click", () => {
    state.selectedFile = null;
    els.messageFile.value = "";
    updateAttachmentPreview();
});
els.newsForm.addEventListener("submit", saveNews);
els.cancelNewsEdit.addEventListener("click", resetNewsForm);

socket.on("newMessage", (message) => {
    const fromSelected = state.selectedUser && (
        message.senderId === state.selectedUser.id ||
        message.receiverId === state.selectedUser.id
    );

    if (fromSelected) {
        addMessage(message, message.senderId === myId);
        scrollMessages();
    }
});

socket.on("messageError", (error) => {
    alert(error.message || "Ошибка при отправке сообщения");
});

(async function init() {
    try {
        syncHeader();
        await loadMe();
        await loadUsers();
        await loadNews();
    } catch (error) {
        alert(error.message || "Не удалось загрузить приложение");
    }
})();
