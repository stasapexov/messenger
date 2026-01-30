const socket = io();

const myId = localStorage.getItem("userId");
if (!myId) window.location = "index.html";

let selectedUser = null;
socket.emit("join", myId);

const usersDiv = document.getElementById("users");
const messages = document.getElementById("messages");
const text = document.getElementById("text");

fetch(`/users/${myId}`)
    .then(res => res.json())
    .then(users => {
        users.forEach(u => {
            const el = document.createElement("div");
            el.innerText = u.name;
            el.onclick = () => selectUser(u.id);
            usersDiv.appendChild(el);
        });
    });

function selectUser(id) {
    selectedUser = id;
    loadMessages();
}

function loadMessages() {
    fetch(`/messages/${myId}/${selectedUser}`)
        .then(res => res.json())
        .then(msgs => {
            messages.innerHTML = "";
            msgs.forEach(m => addMessage(m.message, m.sender_id == myId));
        });
}

function send() {
    if (!text.value || !selectedUser) return;
    socket.emit("sendMessage", { sender: myId, receiver: selectedUser, message: text.value });
    text.value = "";
}

socket.on("newMessage", (data) => {
    if (data.sender == selectedUser || data.receiver == selectedUser)
        addMessage(data.message, data.sender == myId);
});

function addMessage(textMsg, isMe) {
    const msg = document.createElement("div");
    msg.className = "msg " + (isMe ? "me" : "him");
    msg.innerText = textMsg;
    messages.appendChild(msg);
}
