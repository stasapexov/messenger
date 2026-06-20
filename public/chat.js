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
    profileUserId: null,
    stickers: [],
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
    themeButton: document.getElementById("themeButton"),
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
    stickerButton: document.getElementById("stickerButton"),
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
    adminUsersCard: document.getElementById("adminUsersCard"),
    adminUsers: document.getElementById("adminUsers"),
    profilePanel: document.getElementById("profilePanel"),
    messageActionScrim: document.getElementById("messageActionScrim"),
    messageActionSheet: document.getElementById("messageActionSheet"),
    messageActionTitle: document.getElementById("messageActionTitle"),
    forwardScrim: document.getElementById("forwardScrim"),
    forwardPanel: document.getElementById("forwardPanel"),
    closeForwardButton: document.getElementById("closeForwardButton"),
    forwardTargets: document.getElementById("forwardTargets"),
    stickerScrim: document.getElementById("stickerScrim"),
    stickerPanel: document.getElementById("stickerPanel"),
    closeStickerButton: document.getElementById("closeStickerButton"),
    stickerList: document.getElementById("stickerList"),
};

function icon(name) {
    const icons = {
        paperclip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.6l-8.2 8.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.7 8.7a2 2 0 0 1-2.8-2.8l8-8"/></svg>',
        mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>',
        send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/></svg>',
        sticker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a4 4 0 0 1 4 4v7l-7 7H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z"/><path d="M14 21v-4a3 3 0 0 1 3-3h4"/><path d="M8 9h.01M16 9h.01M8.5 14a5 5 0 0 0 7 0"/></svg>',
        moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5Z"/></svg>',
        sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
        heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
        download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    };
    return icons[name] || "";
}

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

function canPublish() {
    return Boolean(state.me?.canPublish || state.me?.isAdmin || state.me?.isSubadmin);
}

function roleLabel(role) {
    return { admin: "Админ", subadmin: "Под-админ", user: "Пользователь" }[role] || "Пользователь";
}

function applyTheme(theme = localStorage.getItem("messengerTheme") || "light") {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("messengerTheme", nextTheme);
    if (els.themeButton) els.themeButton.innerHTML = icon(nextTheme === "dark" ? "sun" : "moon");
}

function setupStaticIcons() {
    const fileLabel = document.querySelector('label[for="messageFile"]');
    if (fileLabel) fileLabel.innerHTML = icon("paperclip");
    if (els.voiceButton) els.voiceButton.innerHTML = icon("mic");
    if (els.stickerButton) els.stickerButton.innerHTML = icon("sticker");
    const sendButton = document.querySelector(".send-button");
    if (sendButton) sendButton.innerHTML = icon("send");
    applyTheme();
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
    els.headerTag.textContent = state.me?.tag ? `@${state.me.tag} · ${roleLabel(state.me.role)}` : "";
    document.querySelectorAll(".admin-only").forEach((item) => item.classList.toggle("hidden", !canPublish()));
    document.getElementById("viewAdmin").classList.toggle("hidden-admin", !canPublish());
    els.newsForm.classList.toggle("hidden", !canPublish());
    els.inviteForm.elements.role.disabled = !state.me?.isAdmin;
}

function switchView(viewId) {
    if (viewId === "viewAdmin" && !canPublish()) return;

    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));

    if (viewId === "viewFeed") loadNews();
    if (viewId === "viewPeople") renderPeople();
    if (viewId === "viewProfile") loadProfile(state.profileUserId || state.me?.id).catch((error) => alert(error.message));
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

function chatProfileUser(chat) {
    if (!chat || chat.type !== "direct") return null;
    return chat.members?.find((member) => member.id !== state.me?.id) || null;
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
    const profileUser = chatProfileUser(chat);
    els.chatAvatar.dataset.userId = profileUser?.id || "";
    els.chatAvatar.classList.toggle("clickable", Boolean(profileUser));
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
    let startX = 0;
    let startY = 0;
    let swipeHandled = false;

    item.addEventListener("pointerdown", (event) => {
        if (isMessageControl(event.target)) return;
        longPressOpened = false;
        swipeHandled = false;
        startX = event.clientX;
        startY = event.clientY;
        longPress = window.setTimeout(() => {
            longPressOpened = true;
            openMessageActions(message);
        }, 460);
    });

    item.addEventListener("pointermove", (event) => {
        if (isMessageControl(event.target) || !startX) return;
        const dx = event.clientX - startX;
        const dy = Math.abs(event.clientY - startY);
        if (Math.abs(dx) > 10 && longPress) window.clearTimeout(longPress);
        if (dx > 0 && dy < 42) {
            const offset = Math.min(dx, 72);
            item.style.transform = `translateX(${offset}px)`;
            item.classList.toggle("swipe-ready", offset > 56);
        }
    });

    ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
        item.addEventListener(eventName, (event) => {
            if (longPress) window.clearTimeout(longPress);
            if (!startX) return;
            const dx = event.clientX - startX;
            const dy = Math.abs(event.clientY - startY);
            item.style.transform = "";
            item.classList.remove("swipe-ready");
            if (eventName === "pointerup" && dx > 58 && dy < 42 && !longPressOpened) {
                swipeHandled = true;
                setReplyToMessage(message);
            }
            startX = 0;
            startY = 0;
        });
    });

    item.addEventListener("click", (event) => {
        if (isMessageControl(event.target)) return;
        if (swipeHandled) {
            swipeHandled = false;
            return;
        }
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
    els.messageActionSheet
        .querySelector('[data-message-action="create-sticker"]')
        .classList.toggle("hidden", message.attachment?.type !== "image");
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

async function loadStickers() {
    state.stickers = await api("/stickers");
}

function renderStickers() {
    els.stickerList.innerHTML = "";
    if (!state.stickers.length) {
        els.stickerList.innerHTML = `<div class="empty-state compact">Зажмите картинку в чате и создайте первый стикер</div>`;
        return;
    }

    state.stickers.forEach((sticker) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sticker-item";
        button.dataset.fileId = sticker.file.id;
        button.innerHTML = `<img src="${sticker.file.url}" alt="">`;
        els.stickerList.appendChild(button);
    });
}

async function openStickerPanel() {
    if (!state.selectedChat) return;
    await loadStickers();
    renderStickers();
    els.stickerScrim.classList.remove("hidden");
    els.stickerPanel.classList.remove("hidden");
}

function closeStickerPanel() {
    els.stickerScrim.classList.add("hidden");
    els.stickerPanel.classList.add("hidden");
}

async function sendSticker(fileId) {
    if (!state.selectedChat || !fileId) return;
    const payload = {
        chatId: state.selectedChat.id,
        text: "",
        fileId,
        kind: "file",
        replyToMessageId: state.replyToMessage?.id || null,
    };
    socket.emit("sendMessage", payload, (response) => {
        if (!response?.success) alert(response?.error || "Не удалось отправить стикер");
    });
    clearReplyToMessage();
    closeStickerPanel();
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
        return;
    }
    if (action === "create-sticker") {
        await api("/stickers", { method: "POST", body: { fileId: message.attachment?.id } });
        await loadStickers();
        alert("Стикер сохранён");
    }
}

function attachmentHtml(attachment, kind) {
    if (attachment.type === "image") {
        return `<a class="attachment image" href="${attachment.url}" target="_blank" rel="noreferrer" data-file-id="${escapeHtml(attachment.id)}"><img src="${attachment.url}" alt=""><span>${escapeHtml(attachment.originalName)}</span></a>`;
    }
    if (attachment.type === "video") {
        return `<div class="attachment media-attachment"><div class="media-player video-player"><video src="${attachment.url}" controls preload="metadata" playsinline webkit-playsinline data-cache-url="${attachment.url}"></video></div><div class="attachment-tools"><a class="attachment-link" href="${attachment.url}?download=1">${escapeHtml(attachment.originalName)} - ${fileSize(attachment.size)}</a><button class="cache-button" type="button" data-cache-url="${attachment.url}" aria-label="Сохранить локально">${icon("download")}</button></div></div>`;
    }
    if (attachment.type === "audio" || kind === "voice") {
        const title = kind === "voice" ? "Голосовое" : escapeHtml(attachment.originalName);
        return `<div class="attachment media-attachment"><div class="media-player audio-player"><audio class="media-native" src="${attachment.url}" controls preload="metadata" playsinline data-cache-url="${attachment.url}"></audio></div><div class="attachment-tools"><a class="attachment-link" href="${attachment.url}?download=1">${title}${attachment.size ? ` - ${fileSize(attachment.size)}` : ""}</a><button class="cache-button" type="button" data-cache-url="${attachment.url}" aria-label="Сохранить локально">${icon("download")}</button></div></div>`;
    }
    return `<div class="attachment file"><a class="attachment-link" href="${attachment.url}?download=1"><span>${escapeHtml(attachment.originalName)} · ${fileSize(attachment.size)}</span></a><button class="cache-button" type="button" data-cache-url="${attachment.url}" aria-label="Сохранить локально">${icon("download")}</button></div>`;
}

function pauseOtherMedia(currentMedia) {
    document.querySelectorAll(".media-player audio, .media-player video").forEach((media) => {
        if (media !== currentMedia && !media.paused) media.pause();
    });
}

async function cachedBlobUrl(url) {
    if (!("caches" in window) || !url) return null;
    const cache = await caches.open("messenger-media-v1");
    const cached = await cache.match(url);
    if (!cached) return null;
    return URL.createObjectURL(await cached.blob());
}

async function cacheMediaUrl(url, button) {
    if (!("caches" in window)) throw new Error("Браузер не поддерживает локальный кэш");
    const cache = await caches.open("messenger-media-v1");
    button?.classList.add("is-loading");
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Не удалось сохранить файл");
    await cache.put(url, response.clone());
    button?.classList.remove("is-loading");
    button?.classList.add("is-cached");
}

function setupMediaPlayers(root = document) {
    root.querySelectorAll(".media-player audio:not([data-ready]), .media-player video:not([data-ready])").forEach((media) => {
        media.dataset.ready = "1";
        media.addEventListener("play", () => pauseOtherMedia(media));
        cachedBlobUrl(media.dataset.cacheUrl)
            .then((localUrl) => {
                if (localUrl && !media.dataset.localReady && media.paused) {
                    media.dataset.localReady = "1";
                    media.src = localUrl;
                    media.load();
                }
            })
            .catch(() => {});
    });
    root.querySelectorAll(".cache-button:not([data-ready])").forEach((button) => {
        button.dataset.ready = "1";
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
                await cacheMediaUrl(button.dataset.cacheUrl, button);
            } catch (error) {
                button.classList.remove("is-loading");
                alert(error.message);
            }
        });
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
    const roleControl = adminMode && state.me?.isAdmin
        ? `<select class="role-select" data-role>
                <option value="user" ${user.role === "user" ? "selected" : ""}>Пользователь</option>
                <option value="subadmin" ${user.role === "subadmin" ? "selected" : ""}>Под-админ</option>
                <option value="admin" ${user.role === "admin" ? "selected" : ""}>Админ</option>
           </select>`
        : `<small>${roleLabel(user.role)}</small>`;
    row.innerHTML = `
        <button class="avatar-button small profile-link" type="button" data-profile="${escapeHtml(user.id)}">${avatarContent(user)}</button>
        <div class="person-main">
            <strong>${escapeHtml(user.name)}</strong>
            <span>@${escapeHtml(user.tag)} · ${roleLabel(user.role)}</span>
            ${adminMode ? roleControl : ""}
        </div>
        <button type="button" data-user-action>${adminMode ? "Сброс" : "Написать"}</button>
    `;
    row.querySelector("[data-profile]").addEventListener("click", () => openUserProfile(user.id));
    row.querySelector("[data-role]")?.addEventListener("change", async (event) => {
        const updated = await api(`/admin/users/${user.id}/role`, {
            method: "PATCH",
            body: { role: event.currentTarget.value },
        });
        Object.assign(user, updated);
        await loadUsers();
        await loadAdmin();
    });
    row.querySelector("[data-user-action]").addEventListener("click", async () => {
        if (adminMode) {
            if (!state.me?.isAdmin) return;
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
                    <button class="heart-button ${item.liked ? "active" : ""}" type="button" data-action="like" aria-label="Сердце">${icon("heart")}<span>${item.likesCount}</span></button>
                    ${item.canManage ? '<button type="button" data-action="edit">Изм.</button><button type="button" data-action="delete">Удалить</button>' : ""}
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
    if (!canPublish()) return;
    const invites = await api("/admin/invites");
    els.inviteList.innerHTML = invites.length
        ? invites.map((invite) => `<div class="invite-row"><strong>${escapeHtml(invite.code)}</strong><span>${roleLabel(invite.role_on_signup)} · ${invite.used_count}/${invite.max_uses}</span></div>`).join("")
        : `<div class="empty-state compact">Инвайтов пока нет</div>`;

    els.adminUsersCard.classList.toggle("hidden", !state.me?.isAdmin);
    if (state.me?.isAdmin) {
        els.adminUsers.innerHTML = "";
        state.users.forEach((user) => els.adminUsers.appendChild(userCard(user, true)));
    }
}

async function createInvite(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(els.inviteForm).entries());
    const invite = await api("/admin/invites", { method: "POST", body });
    alert(`Инвайт: ${invite.code}`);
    els.inviteForm.reset();
    els.inviteForm.elements.role.value = "user";
    await loadAdmin();
}

async function loadProfile(userId = state.me?.id) {
    if (!userId) return;
    state.profileUserId = userId;
    const profile = await api(`/profiles/${encodeURIComponent(userId)}`);
    renderProfile(profile);
}

function openUserProfile(userId = state.me?.id) {
    state.profileUserId = userId;
    switchView("viewProfile");
}

function profilePostsHtml(profile, canManage) {
    if (!profile.posts?.length) return `<div class="empty-state compact">Фотографий пока нет</div>`;
    return profile.posts
        .map((post) => `
            <article class="profile-post" data-post-id="${escapeHtml(post.id)}">
                <img src="${post.image.url}" alt="">
                ${post.caption ? `<p>${escapeHtml(post.caption)}</p>` : ""}
                ${canManage ? '<button class="ghost-button" type="button" data-delete-post>Удалить</button>' : ""}
            </article>
        `)
        .join("");
}

function renderProfile(profile = { user: state.me, posts: [] }) {
    const user = profile.user || state.me;
    const isSelf = user.id === state.me?.id;
    const canManagePosts = isSelf || state.me?.isAdmin;
    els.profilePanel.innerHTML = `
        <div class="profile-hero">
            <div class="profile-avatar">${avatarContent(user)}</div>
            <h2>${escapeHtml(user.name)}</h2>
            <p>@${escapeHtml(user.tag)}</p>
            ${user.bio ? `<p class="profile-bio">${escapeHtml(user.bio)}</p>` : ""}
            <span class="role-badge">${roleLabel(user.role)}</span>
        </div>
        ${
            isSelf
                ? `<form class="profile-form" id="profileForm">
                    <input type="text" name="name" value="${escapeHtml(state.me.name)}" maxlength="60" required>
                    <textarea name="bio" rows="3" maxlength="500" placeholder="Описание профиля">${escapeHtml(state.me.bio || "")}</textarea>
                    <input type="file" name="avatar" accept="image/*">
                    <button type="submit">Сохранить профиль</button>
                </form>
                <form class="profile-form" id="profilePostForm">
                    <input type="file" name="image" accept="image/*" required>
                    <input type="text" name="caption" maxlength="600" placeholder="Подпись к фото">
                    <button type="submit">Опубликовать фото</button>
                </form>
                <button type="button" id="enablePushButton">Включить уведомления</button>`
                : `<button type="button" id="messageProfileButton">Написать</button>`
        }
        <section class="profile-posts">
            <div class="section-title">Фотографии</div>
            ${profilePostsHtml(profile, canManagePosts)}
        </section>
    `;

    document.getElementById("profileForm")?.addEventListener("submit", saveProfile);
    document.getElementById("profilePostForm")?.addEventListener("submit", uploadProfilePost);
    document.getElementById("enablePushButton")?.addEventListener("click", enablePush);
    document.getElementById("messageProfileButton")?.addEventListener("click", async () => {
        const chat = await api("/chats/direct", { method: "POST", body: { userId: user.id } });
        await loadChats();
        switchView("viewChats");
        await selectChat(chat.id);
    });
    els.profilePanel.querySelectorAll("[data-delete-post]").forEach((button) => {
        button.addEventListener("click", async () => {
            const post = button.closest("[data-post-id]");
            if (!post || !confirm("Удалить фото из профиля?")) return;
            await api(`/profile/posts/${post.dataset.postId}`, { method: "DELETE" });
            await loadProfile(user.id);
        });
    });
}

async function saveProfile(event) {
    event.preventDefault();
    const updated = await api("/profile", { method: "PUT", body: new FormData(event.currentTarget) });
    state.me = updated;
    renderHeader();
    await loadProfile(state.me.id);
}

async function uploadProfilePost(event) {
    event.preventDefault();
    await api("/profile/posts", { method: "POST", body: new FormData(event.currentTarget) });
    event.currentTarget.reset();
    await loadProfile(state.me.id);
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

document.querySelectorAll(".nav-button").forEach((button) =>
    button.addEventListener("click", () => {
        if (button.dataset.view === "viewProfile") state.profileUserId = state.me?.id;
        switchView(button.dataset.view);
    })
);
els.headerAvatar.addEventListener("click", () => openUserProfile(state.me?.id));
els.chatAvatar.addEventListener("click", () => {
    if (els.chatAvatar.dataset.userId) openUserProfile(els.chatAvatar.dataset.userId);
});
els.themeButton.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
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
els.stickerButton.addEventListener("click", () => openStickerPanel().catch((error) => alert(error.message)));
els.stickerScrim.addEventListener("click", closeStickerPanel);
els.closeStickerButton.addEventListener("click", closeStickerPanel);
els.stickerList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-file-id]");
    if (!target) return;
    sendSticker(target.dataset.fileId).catch((error) => alert(error.message));
});
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
        setupStaticIcons();
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
