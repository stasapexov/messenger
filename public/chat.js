const socket = io({ withCredentials: true });

const state = {
    me: null,
    users: [],
    chats: [],
    selectedChat: null,
    selectedAttachment: null,
    replyToMessage: null,
    actionMessage: null,
    forwardingMessage: null,
    editingNewsId: null,
    voiceStream: null,
    voiceContext: null,
    voiceSource: null,
    voiceProcessor: null,
    voiceGain: null,
    voiceSamples: [],
    voiceSampleRate: 44100,
};

const els = {
    headerAvatar: document.getElementById("headerAvatar"),
    headerName: document.getElementById("headerName"),
    headerTag: document.getElementById("headerTag"),
    logoutButton: document.getElementById("logoutButton"),
    chatLayout: document.querySelector(".chat-layout"),
    chatList: document.getElementById("chatList"),
    refreshChatsButton: document.getElementById("refreshChatsButton"),
    openGroupPanelButton: document.getElementById("openGroupPanelButton"),
    closeGroupPanelButton: document.getElementById("closeGroupPanelButton"),
    cancelGroupButton: document.getElementById("cancelGroupButton"),
    groupScrim: document.getElementById("groupScrim"),
    groupForm: document.getElementById("groupForm"),
    groupMembers: document.getElementById("groupMembers"),
    groupError: document.getElementById("groupError"),
    emptyChat: document.getElementById("emptyChat"),
    chatRoom: document.getElementById("chatRoom"),
    closeChatButton: document.getElementById("closeChatButton"),
    chatAvatar: document.getElementById("chatAvatar"),
    chatTitle: document.getElementById("chatTitle"),
    chatSubtitle: document.getElementById("chatSubtitle"),
    messages: document.getElementById("messages"),
    replyPreview: document.getElementById("replyPreview"),
    replyPreviewText: document.getElementById("replyPreviewText"),
    clearReplyButton: document.getElementById("clearReplyButton"),
    messageForm: document.getElementById("messageForm"),
    messageText: document.getElementById("messageText"),
    messageFile: document.getElementById("messageFile"),
    attachmentPreview: document.getElementById("attachmentPreview"),
    attachmentName: document.getElementById("attachmentName"),
    clearAttachment: document.getElementById("clearAttachment"),
    voiceButton: document.getElementById("voiceButton"),
    newsForm: document.getElementById("newsForm"),
    newsFormTitle: document.getElementById("newsFormTitle"),
    newsText: document.getElementById("newsText"),
    newsImage: document.getElementById("newsImage"),
    newsVisibility: document.getElementById("newsVisibility"),
    newsAudience: document.getElementById("newsAudience"),
    newsUsers: document.getElementById("newsUsers"),
    newsChats: document.getElementById("newsChats"),
    saveNewsButton: document.getElementById("saveNewsButton"),
    cancelNewsEdit: document.getElementById("cancelNewsEdit"),
    newsList: document.getElementById("newsList"),
    peopleSearch: document.getElementById("peopleSearch"),
    peopleSearchButton: document.getElementById("peopleSearchButton"),
    peopleList: document.getElementById("peopleList"),
    inviteForm: document.getElementById("inviteForm"),
    inviteList: document.getElementById("inviteList"),
    adminUsers: document.getElementById("adminUsers"),
    profilePanel: document.getElementById("profilePanel"),
    messageActionScrim: document.getElementById("messageActionScrim"),
    messageActionSheet: document.getElementById("messageActionSheet"),
    messageActionTitle: document.getElementById("messageActionTitle"),
    forwardScrim: document.getElementById("forwardScrim"),
    forwardPanel: document.getElementById("forwardPanel"),
    closeForwardButton: document.getElementById("closeForwardButton"),
    forwardTargets: document.getElementById("forwardTargets"),
};

async function api(path, options = {}) {
    const request = { credentials: "same-origin", ...options };
    request.headers = { ...(options.headers || {}) };

    if (request.body && !(request.body instanceof FormData)) {
        request.headers["Content-Type"] = "application/json";
        request.body = JSON.stringify(request.body);
    }

    const response = await fetch(path, request);
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
        window.location = "index.html";
        throw new Error("Нужно войти");
    }

    if (!response.ok) {
        throw new Error(data.error || "Ошибка запроса");
    }

    return data;
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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

function fileSize(bytes) {
    if (!bytes) return "";
    const units = ["Б", "КБ", "МБ", "ГБ"];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function messageSnippet(message, fallback = "Сообщение") {
    const text = message?.text || message?.attachment?.originalName || "";
    return text ? text.slice(0, 120) : fallback;
}

function avatarContent(item) {
    const avatar = item?.avatar;
    if (avatar) return `<img src="${avatar}" alt="">`;
    const letter = (item?.name || item?.title || item?.tag || "?").slice(0, 1).toUpperCase();
    return `<span>${escapeHtml(letter)}</span>`;
}

function renderHeader() {
    els.headerAvatar.innerHTML = avatarContent(state.me);
    els.headerName.textContent = state.me?.name || "Messenger";
    els.headerTag.textContent = state.me?.tag ? `@${state.me.tag}` : "";
    document.querySelectorAll(".admin-only").forEach((item) => item.classList.toggle("hidden", !state.me?.isAdmin));
    document.getElementById("viewAdmin").classList.toggle("hidden-admin", !state.me?.isAdmin);
    els.newsForm.classList.toggle("hidden", !state.me?.isAdmin);
}

function switchView(viewId) {
    if (viewId === "viewAdmin" && !state.me?.isAdmin) return;

    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));

    if (viewId === "viewFeed") loadNews();
    if (viewId === "viewPeople") renderPeople();
    if (viewId === "viewProfile") renderProfile();
    if (viewId === "viewAdmin") loadAdmin();
}

function checkedValues(container) {
    return Array.from(container.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
}

function renderCheckboxes(container, items, selected = []) {
    const selectedSet = new Set(selected);
    container.innerHTML = "";
    items.forEach((item) => {
        const label = document.createElement("label");
        label.className = "check-row";
        label.innerHTML = `
            <input type="checkbox" value="${escapeHtml(item.id)}" ${selectedSet.has(item.id) ? "checked" : ""}>
            <span>${escapeHtml(item.name || item.title)}${item.tag ? ` <small>@${escapeHtml(item.tag)}</small>` : ""}</span>
        `;
        container.appendChild(label);
    });
}

async function loadMe() {
    state.me = await api("/me");
    renderHeader();
}

async function loadUsers(q = "") {
    state.users = await api(`/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    renderGroupMembers();
    renderNewsAudience();
}

async function loadChats() {
    state.chats = await api("/chats");
    renderChats();
    renderGroupMembers();
    renderNewsAudience();
}

function renderChats() {
    els.chatList.innerHTML = "";

    if (!state.chats.length) {
        els.chatList.innerHTML = `<div class="empty-state">Пока нет чатов. Найдите человека или создайте группу.</div>`;
        return;
    }

    state.chats.forEach((chat) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `chat-row ${state.selectedChat?.id === chat.id ? "active" : ""}`;
        row.innerHTML = `
            <span class="avatar-button small">${avatarContent(chat)}</span>
            <span class="chat-row-main">
                <strong>${escapeHtml(chat.title)}</strong>
                <small>${escapeHtml(chat.latestMessage?.text || chat.latestMessage?.attachment?.originalName || chat.subtitle || "")}</small>
            </span>
        `;
        row.addEventListener("click", () => selectChat(chat.id));
        els.chatList.appendChild(row);
    });
}

function renderGroupMembers() {
    renderCheckboxes(els.groupMembers, state.users);
}

function openGroupForm() {
    els.groupError.textContent = "";
    renderGroupMembers();
    els.groupScrim.classList.remove("hidden");
    els.groupForm.classList.remove("hidden");
    els.groupForm.elements.title.focus();
}

function closeGroupForm({ reset = true } = {}) {
    if (reset) els.groupForm.reset();
    els.groupError.textContent = "";
    els.groupScrim.classList.add("hidden");
    els.groupForm.classList.add("hidden");
}

function setChatOpen(isOpen) {
    els.chatLayout.classList.toggle("chat-open", Boolean(isOpen));
}

async function selectChat(chatId) {
    const chat = state.chats.find((item) => item.id === chatId) || (await api("/chats")).find((item) => item.id === chatId);
    if (!chat) return;

    state.selectedChat = chat;
    clearReplyToMessage();
    setChatOpen(true);
    socket.emit("joinChat", chat.id);
    renderChats();
    els.emptyChat.classList.add("hidden");
    els.chatRoom.classList.remove("hidden");
    els.chatAvatar.innerHTML = avatarContent(chat);
    els.chatTitle.textContent = chat.title;
    els.chatSubtitle.textContent = chat.subtitle || "";
    await loadMessages();
}

async function loadMessages() {
    if (!state.selectedChat) return;
    const messages = await api(`/chats/${state.selectedChat.id}/messages`);
    els.messages.innerHTML = "";
    messages.forEach((message) => addMessage(message));
    scrollMessages();
}

function scrollMessages() {
    els.messages.scrollTop = els.messages.scrollHeight;
}

function addMessage(message) {
    const isMe = message.senderId === state.me.id;
    const item = document.createElement("article");
    item.className = `msg ${isMe ? "me" : "him"}`;
    item.dataset.id = message.id;
    if (!message.deletedForAll) {
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.setAttribute("aria-label", "Действия с сообщением");
    }

    const sender = state.selectedChat?.type === "group" && !isMe ? `<strong class="msg-sender">${escapeHtml(message.sender?.name || "")}</strong>` : "";
    const reply = message.replyTo
        ? `<button class="reply-quote" type="button" data-reply-id="${escapeHtml(message.replyTo.id)}"><strong>${escapeHtml(message.replyTo.sender?.name || "Пользователь")}</strong><span>${escapeHtml(message.replyTo.text)}</span></button>`
        : "";
    const body = message.deletedForAll
        ? `<div class="msg-text muted">Сообщение удалено</div>`
        : `
            ${reply}
            ${message.text ? `<div class="msg-text">${escapeHtml(message.text)}</div>` : ""}
            ${message.attachment ? attachmentHtml(message.attachment, message.kind) : ""}
        `;

    item.innerHTML = `
        ${sender}
        ${body}
        <time>${formatTime(message.createdAt)}${message.editedAt ? " · изм." : ""}</time>
    `;

    item.querySelector(".reply-quote")?.addEventListener("click", (event) => {
        event.stopPropagation();
        scrollToMessage(event.currentTarget.dataset.replyId);
    });

    if (!message.deletedForAll) bindMessageActions(item, message);

    els.messages.appendChild(item);
    setupMediaPlayers(item);
}

function isMessageControl(target) {
    return Boolean(target.closest("a, button, input, audio, video, label"));
}

function bindMessageActions(item, message) {
    let longPress = null;
    let longPressOpened = false;

    item.addEventListener("pointerdown", (event) => {
        if (isMessageControl(event.target)) return;
        longPressOpened = false;
        longPress = window.setTimeout(() => {
            longPressOpened = true;
            openMessageActions(message);
        }, 460);
    });

    ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
        item.addEventListener(eventName, () => {
            if (longPress) window.clearTimeout(longPress);
        });
    });

    item.addEventListener("click", (event) => {
        if (isMessageControl(event.target)) return;
        if (longPressOpened) {
            longPressOpened = false;
            return;
        }
        openMessageActions(message);
    });

    item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openMessageActions(message);
    });

    item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMessageActions(message);
        }
    });
}

function scrollToMessage(messageId) {
    const node = els.messages.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("msg-highlight");
    window.setTimeout(() => node.classList.remove("msg-highlight"), 1200);
}

function openMessageActions(message) {
    state.actionMessage = message;
    els.messageActionTitle.textContent = messageSnippet(message);
    els.messageActionSheet.querySelector('[data-message-action="edit"]').classList.toggle("hidden", !message.canEdit);
    els.messageActionSheet.querySelector('[data-message-action="delete-all"]').classList.toggle("hidden", !message.canDeleteAll);
    els.messageActionScrim.classList.remove("hidden");
    els.messageActionSheet.classList.remove("hidden");
}

function closeMessageActions() {
    state.actionMessage = null;
    els.messageActionScrim.classList.add("hidden");
    els.messageActionSheet.classList.add("hidden");
}

function setReplyToMessage(message) {
    state.replyToMessage = message;
    els.replyPreviewText.textContent = `Ответ на: "${messageSnippet(message)}"`;
    els.replyPreview.classList.remove("hidden");
    els.messageText.focus();
}

function clearReplyToMessage() {
    state.replyToMessage = null;
    els.replyPreview.classList.add("hidden");
    els.replyPreviewText.textContent = "";
}

function closeForwardPanel() {
    state.forwardingMessage = null;
    els.forwardScrim.classList.add("hidden");
    els.forwardPanel.classList.add("hidden");
}

function renderForwardTargets() {
    els.forwardTargets.innerHTML = "";
    if (!state.users.length) {
        els.forwardTargets.innerHTML = `<div class="empty-state compact">Пользователи не найдены</div>`;
        return;
    }

    state.users.forEach((user) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "forward-target";
        button.dataset.userId = user.id;
        button.innerHTML = `
            <span class="avatar-button small">${avatarContent(user)}</span>
            <span>
                <strong>${escapeHtml(user.name)}</strong>
                <small>@${escapeHtml(user.tag)}</small>
            </span>
        `;
        els.forwardTargets.appendChild(button);
    });
}

async function openForwardPanel(message) {
    state.forwardingMessage = message;
    if (!state.users.length) await loadUsers();
    renderForwardTargets();
    els.forwardScrim.classList.remove("hidden");
    els.forwardPanel.classList.remove("hidden");
}

async function forwardMessageToUser(userId) {
    if (!state.forwardingMessage) return;
    const result = await api(`/messages/${state.forwardingMessage.id}/forward`, {
        method: "POST",
        body: { targetUserId: userId },
    });
    closeForwardPanel();
    await loadChats();
    switchView("viewChats");
    if (result.chat?.id) await selectChat(result.chat.id);
}

async function handleMessageAction(action) {
    const message = state.actionMessage;
    if (!message || action === "cancel") {
        closeMessageActions();
        return;
    }

    closeMessageActions();

    if (action === "reply") {
        setReplyToMessage(message);
        return;
    }
    if (action === "forward") {
        openForwardPanel(message);
        return;
    }
    if (action === "edit") {
        await editMessage(message);
        return;
    }
    if (action === "delete-me") {
        await deleteMessage(message.id, "me");
        return;
    }
    if (action === "delete-all") {
        await deleteMessage(message.id, "all");
    }
}

function attachmentHtml(attachment, kind) {
    if (attachment.type === "image") {
        return `<a class="attachment image" href="${attachment.url}" target="_blank" rel="noreferrer"><img src="${attachment.url}" alt=""><span>${escapeHtml(attachment.originalName)}</span></a>`;
    }
    if (attachment.type === "video") {
        return `<div class="attachment media-attachment"><div class="media-player video-player"><video src="${attachment.url}" controls preload="metadata" playsinline></video></div><a class="attachment-link" href="${attachment.url}?download=1">${escapeHtml(attachment.originalName)} - ${fileSize(attachment.size)}</a></div>`;
    }
    if (attachment.type === "audio" || kind === "voice") {
        const title = kind === "voice" ? "Голосовое" : escapeHtml(attachment.originalName);
        return `<div class="attachment media-attachment"><div class="media-player audio-player"><audio class="media-native" src="${attachment.url}" controls preload="metadata" playsinline></audio></div><a class="attachment-link" href="${attachment.url}?download=1">${title}${attachment.size ? ` - ${fileSize(attachment.size)}` : ""}</a></div>`;
    }
    return `<a class="attachment file" href="${attachment.url}?download=1"><span>${escapeHtml(attachment.originalName)} · ${fileSize(attachment.size)}</span></a>`;
}

function pauseOtherMedia(currentMedia) {
    document.querySelectorAll(".media-player audio, .media-player video").forEach((media) => {
        if (media !== currentMedia && !media.paused) media.pause();
    });
}

function setupMediaPlayers(root = document) {
    root.querySelectorAll(".media-player audio:not([data-ready]), .media-player video:not([data-ready])").forEach((media) => {
        media.dataset.ready = "1";
        media.addEventListener("play", () => pauseOtherMedia(media));
    });
}

async function uploadSelectedAttachment() {
    if (!state.selectedAttachment) return null;

    const formData = new FormData();
    formData.append("file", state.selectedAttachment.file);
    return api("/files", { method: "POST", body: formData });
}

function setAttachment(file, kind = "file") {
    state.selectedAttachment = file ? { file, kind } : null;
    els.attachmentPreview.classList.toggle("hidden", !file);
    els.attachmentName.textContent = file ? `${kind === "voice" ? "Голосовое" : file.name} · ${fileSize(file.size)}` : "";
}

async function sendMessage(event) {
    event.preventDefault();
    if (!state.selectedChat) return;

    const text = els.messageText.value.trim();
    if (!text && !state.selectedAttachment) return;

    try {
        const uploaded = await uploadSelectedAttachment();
        const payload = {
            chatId: state.selectedChat.id,
            text,
            fileId: uploaded?.id || null,
            kind: state.selectedAttachment?.kind || (uploaded ? "file" : "text"),
            replyToMessageId: state.replyToMessage?.id || null,
        };

        socket.emit("sendMessage", payload, (response) => {
            if (!response?.success) alert(response?.error || "Не удалось отправить сообщение");
        });

        els.messageText.value = "";
        els.messageFile.value = "";
        setAttachment(null);
        clearReplyToMessage();
    } catch (error) {
        alert(error.message);
    }
}

async function editMessage(message) {
    const nextText = prompt("Новый текст сообщения", message.text || "");
    if (nextText === null) return;
    await api(`/messages/${message.id}`, { method: "PATCH", body: { text: nextText } });
}

async function deleteMessage(messageId, mode) {
    const text = mode === "all" ? "Удалить сообщение у всех?" : "Удалить сообщение только у себя?";
    if (!confirm(text)) return;
    await api(`/messages/${messageId}`, { method: "DELETE", body: { mode } });
    if (mode === "me") {
        const node = els.messages.querySelector(`[data-id="${messageId}"]`);
        node?.remove();
    }
}

async function createGroup(event) {
    event.preventDefault();
    const submitButton = els.groupForm.querySelector("button[type='submit']");
    const title = String(new FormData(els.groupForm).get("title") || "").trim();
    const memberIds = checkedValues(els.groupMembers);

    if (title.length < 2) {
        els.groupError.textContent = "Введите название группы";
        els.groupForm.elements.title.focus();
        return;
    }

    if (!memberIds.length) {
        els.groupError.textContent = "Выберите хотя бы одного участника";
        return;
    }

    try {
        submitButton.disabled = true;
        els.groupError.textContent = "";
        const chat = await api("/chats/group", { method: "POST", body: { title, memberIds } });
        closeGroupForm();
        await loadChats();
        await selectChat(chat.id);
    } catch (error) {
        els.groupError.textContent = error.message;
    } finally {
        submitButton.disabled = false;
    }
}

function renderPeople() {
    els.peopleList.innerHTML = "";
    if (!state.users.length) {
        els.peopleList.innerHTML = `<div class="empty-state">Пользователи не найдены</div>`;
        return;
    }

    state.users.forEach((user) => els.peopleList.appendChild(userCard(user)));
}

function userCard(user, adminMode = false) {
    const row = document.createElement("div");
    row.className = "person-row";
    row.innerHTML = `
        <div class="avatar-button small">${avatarContent(user)}</div>
        <div class="person-main">
            <strong>${escapeHtml(user.name)}</strong>
            <span>@${escapeHtml(user.tag)}</span>
        </div>
        <button type="button">${adminMode ? "Сброс" : "Написать"}</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
        if (adminMode) {
            const password = prompt("Новый пароль. Оставьте пустым, чтобы сервер сгенерировал временный пароль", "");
            const body = password ? { password } : {};
            const result = await api(`/admin/users/${user.id}/reset-password`, { method: "POST", body });
            alert(`Временный пароль: ${result.temporaryPassword}`);
            return;
        }

        const chat = await api("/chats/direct", { method: "POST", body: { userId: user.id } });
        await loadChats();
        switchView("viewChats");
        await selectChat(chat.id);
    });
    return row;
}

async function loadNews() {
    const news = await api("/news");
    renderNews(news);
}

function renderNewsAudience(selected = { userIds: [], chatIds: [] }) {
    renderCheckboxes(els.newsUsers, state.users, selected.userIds || []);
    renderCheckboxes(
        els.newsChats,
        state.chats.filter((chat) => chat.type === "group"),
        selected.chatIds || []
    );
}

function renderNews(news) {
    els.newsList.innerHTML = "";
    if (!news.length) {
        els.newsList.innerHTML = `<div class="empty-state">Лента пока пустая</div>`;
        return;
    }

    news.forEach((item) => {
        const card = document.createElement("article");
        card.className = "news-card";
        card.innerHTML = `
            <img class="news-image" src="${item.image.url}" alt="">
            <div class="news-body">
                <div class="news-meta">
                    <span>${escapeHtml(item.author?.name || "Админ")}</span>
                    <time>${formatTime(item.createdAt)}</time>
                </div>
                <p>${escapeHtml(item.text)}</p>
                <div class="news-actions">
                    <button type="button" data-action="like">${item.liked ? "Нравится" : "Лайк"} · ${item.likesCount}</button>
                    ${state.me.isAdmin ? '<button type="button" data-action="edit">Изм.</button><button type="button" data-action="delete">Удалить</button>' : ""}
                </div>
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
            row.innerHTML = `<strong>${escapeHtml(comment.user?.name || "Пользователь")}</strong><span>${escapeHtml(comment.text)}</span>`;
            comments.appendChild(row);
        });

        card.querySelector('[data-action="like"]').addEventListener("click", async () => {
            await api(`/news/${item.id}/like`, { method: "POST", body: {} });
            await loadNews();
        });
        card.querySelector('[data-action="edit"]')?.addEventListener("click", () => startNewsEdit(item));
        card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
            if (!confirm("Удалить новость?")) return;
            await api(`/news/${item.id}`, { method: "DELETE" });
            await loadNews();
        });
        card.querySelector(".comment-form").addEventListener("submit", async (event) => {
            event.preventDefault();
            const input = event.currentTarget.querySelector("input");
            await api(`/news/${item.id}/comments`, { method: "POST", body: { text: input.value } });
            input.value = "";
            await loadNews();
        });

        els.newsList.appendChild(card);
    });
}

function startNewsEdit(item) {
    state.editingNewsId = item.id;
    els.newsText.value = item.text;
    els.newsVisibility.value = item.visibility;
    els.newsAudience.classList.toggle("hidden", item.visibility !== "selected");
    renderNewsAudience(item.audience);
    els.newsFormTitle.textContent = "Редактирование новости";
    els.saveNewsButton.textContent = "Сохранить";
    els.newsForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetNewsForm() {
    state.editingNewsId = null;
    els.newsForm.reset();
    els.newsFormTitle.textContent = "Новая новость";
    els.saveNewsButton.textContent = "Опубликовать";
    els.newsAudience.classList.add("hidden");
    renderNewsAudience();
}

async function saveNews(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append("text", els.newsText.value);
    formData.append("visibility", els.newsVisibility.value);
    formData.append("userIds", JSON.stringify(checkedValues(els.newsUsers)));
    formData.append("chatIds", JSON.stringify(checkedValues(els.newsChats)));
    if (els.newsImage.files[0]) formData.append("image", els.newsImage.files[0]);

    const path = state.editingNewsId ? `/news/${state.editingNewsId}` : "/news";
    await api(path, { method: state.editingNewsId ? "PUT" : "POST", body: formData });
    resetNewsForm();
    await loadNews();
}

async function loadAdmin() {
    if (!state.me.isAdmin) return;
    const invites = await api("/admin/invites");
    els.inviteList.innerHTML = invites.length
        ? invites.map((invite) => `<div class="invite-row"><strong>${escapeHtml(invite.code)}</strong><span>${invite.used_count}/${invite.max_uses}</span></div>`).join("")
        : `<div class="empty-state compact">Инвайтов пока нет</div>`;

    els.adminUsers.innerHTML = "";
    state.users.forEach((user) => els.adminUsers.appendChild(userCard(user, true)));
}

async function createInvite(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(els.inviteForm).entries());
    const invite = await api("/admin/invites", { method: "POST", body });
    alert(`Инвайт: ${invite.code}`);
    els.inviteForm.reset();
    await loadAdmin();
}

function renderProfile() {
    els.profilePanel.innerHTML = `
        <div class="profile-hero">
            <div class="profile-avatar">${avatarContent(state.me)}</div>
            <h2>${escapeHtml(state.me.name)}</h2>
            <p>@${escapeHtml(state.me.tag)}</p>
            ${state.me.isAdmin ? '<span class="role-badge">Админ</span>' : ""}
        </div>
        <form class="profile-form" id="profileForm">
            <input type="text" name="name" value="${escapeHtml(state.me.name)}" maxlength="60" required>
            <input type="file" name="avatar" accept="image/*">
            <button type="submit">Сохранить профиль</button>
        </form>
        <button type="button" id="enablePushButton">Включить уведомления</button>
    `;

    document.getElementById("profileForm").addEventListener("submit", saveProfile);
    document.getElementById("enablePushButton").addEventListener("click", enablePush);
}

async function saveProfile(event) {
    event.preventDefault();
    const updated = await api("/profile", { method: "PUT", body: new FormData(event.currentTarget) });
    state.me = updated;
    renderHeader();
    renderProfile();
}

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("Браузер не поддерживает push-уведомления");
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const registration = await navigator.serviceWorker.register("/sw.js");
    const key = await api("/push/key");
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey),
    });

    await api("/push/subscribe", { method: "POST", body: { subscription } });
    alert("Уведомления включены");
}

function mergeVoiceSamples(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Float32Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
        result.set(chunk, offset);
        offset += chunk.length;
    });
    return result;
}

function writeAscii(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
    }
}

function encodeWav(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let index = 0; index < samples.length; index += 1, offset += 2) {
        const sample = Math.max(-1, Math.min(1, samples[index]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return new Blob([view], { type: "audio/wav" });
}

async function stopVoiceRecording() {
    const samples = mergeVoiceSamples(state.voiceSamples);
    const sampleRate = state.voiceSampleRate;

    state.voiceProcessor?.disconnect();
    state.voiceSource?.disconnect();
    state.voiceGain?.disconnect();
    state.voiceStream?.getTracks().forEach((track) => track.stop());
    await state.voiceContext?.close().catch(() => {});

    state.voiceStream = null;
    state.voiceContext = null;
    state.voiceSource = null;
    state.voiceProcessor = null;
    state.voiceGain = null;
    state.voiceSamples = [];
    els.voiceButton.classList.remove("recording");

    if (!samples.length) return;

    const blob = encodeWav(samples, sampleRate);
    const file = new File([blob], `voice-${Date.now()}.wav`, { type: "audio/wav" });
    setAttachment(file, "voice");
}

async function startVoiceRecording() {
    if (state.voiceContext) {
        await stopVoiceRecording();
        return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
        throw new Error("Браузер не поддерживает запись голоса");
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const gain = context.createGain();
    gain.gain.value = 0;

    state.voiceStream = stream;
    state.voiceContext = context;
    state.voiceSource = source;
    state.voiceProcessor = processor;
    state.voiceGain = gain;
    state.voiceSamples = [];
    state.voiceSampleRate = context.sampleRate;

    processor.onaudioprocess = (event) => {
        state.voiceSamples.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };

    source.connect(processor);
    processor.connect(gain);
    gain.connect(context.destination);
    await context.resume();

    els.voiceButton.classList.add("recording");
}

async function logout() {
    await api("/logout", { method: "POST", body: {} }).catch(() => {});
    window.location = "index.html";
}

document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
els.headerAvatar.addEventListener("click", () => switchView("viewProfile"));
els.logoutButton.addEventListener("click", logout);
els.refreshChatsButton.addEventListener("click", loadChats);
els.openGroupPanelButton.addEventListener("click", openGroupForm);
els.closeGroupPanelButton.addEventListener("click", () => closeGroupForm());
els.cancelGroupButton.addEventListener("click", () => closeGroupForm());
els.groupScrim.addEventListener("click", () => closeGroupForm());
els.groupForm.addEventListener("submit", createGroup);
els.messageActionScrim.addEventListener("click", closeMessageActions);
els.messageActionSheet.addEventListener("click", (event) => {
    const button = event.target.closest("[data-message-action]");
    if (!button) return;
    handleMessageAction(button.dataset.messageAction).catch((error) => alert(error.message));
});
els.clearReplyButton.addEventListener("click", clearReplyToMessage);
els.forwardScrim.addEventListener("click", closeForwardPanel);
els.closeForwardButton.addEventListener("click", closeForwardPanel);
els.forwardTargets.addEventListener("click", (event) => {
    const target = event.target.closest("[data-user-id]");
    if (!target) return;
    forwardMessageToUser(target.dataset.userId).catch((error) => alert(error.message));
});
els.closeChatButton.addEventListener("click", () => {
    state.selectedChat = null;
    clearReplyToMessage();
    setChatOpen(false);
    els.chatRoom.classList.add("hidden");
    els.emptyChat.classList.remove("hidden");
    renderChats();
});
els.messageForm.addEventListener("submit", sendMessage);
els.messageFile.addEventListener("change", () => setAttachment(els.messageFile.files[0] || null, "file"));
els.clearAttachment.addEventListener("click", () => {
    els.messageFile.value = "";
    setAttachment(null);
});
els.voiceButton.addEventListener("click", () => startVoiceRecording().catch((error) => alert(error.message)));
els.peopleSearchButton.addEventListener("click", async () => {
    await loadUsers(els.peopleSearch.value);
    renderPeople();
});
els.peopleSearch.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        await loadUsers(els.peopleSearch.value);
        renderPeople();
    }
});
els.newsVisibility.addEventListener("change", () => els.newsAudience.classList.toggle("hidden", els.newsVisibility.value !== "selected"));
els.newsForm.addEventListener("submit", saveNews);
els.cancelNewsEdit.addEventListener("click", resetNewsForm);
els.inviteForm.addEventListener("submit", createInvite);
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.groupForm.classList.contains("hidden")) closeGroupForm();
    if (event.key === "Escape" && !els.messageActionSheet.classList.contains("hidden")) closeMessageActions();
    if (event.key === "Escape" && !els.forwardPanel.classList.contains("hidden")) closeForwardPanel();
});

socket.on("connect_error", () => {
    console.warn("Socket connection failed; keeping the current session open.");
});

socket.on("newMessage", async (message) => {
    if (state.selectedChat?.id === message.chatId) {
        addMessage(message);
        scrollMessages();
    }
    await loadChats();
});

socket.on("messageUpdated", async (message) => {
    if (state.selectedChat?.id === message.chatId) {
        await loadMessages();
    }
});

socket.on("messageDeleted", async ({ id, mode }) => {
    const node = els.messages.querySelector(`[data-id="${id}"]`);
    if (!node) return;
    if (mode === "all") {
        await loadMessages();
    }
});

(async function init() {
    try {
        if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
        await loadMe();
        await loadUsers();
        await loadChats();
        await loadNews();

        const params = new URLSearchParams(location.search);
        if (params.get("view") === "feed") switchView("viewFeed");
        if (params.get("chat")) selectChat(params.get("chat"));
    } catch (error) {
        if (error.message === "Нужно войти") return;
        alert(error.message || "Не удалось загрузить приложение");
    }
})();
