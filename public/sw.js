self.addEventListener("push", (event) => {
    let payload = {
        title: "Messenger",
        body: "Новое уведомление",
        url: "/chat.html",
    };

    if (event.data) {
        try {
            payload = { ...payload, ...event.data.json() };
        } catch {
            payload.body = event.data.text();
        }
    }

    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: "/icon.svg",
            badge: "/icon.svg",
            data: { url: payload.url || "/chat.html" },
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = event.notification.data?.url || "/chat.html";

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
            const existing = clients.find((client) => client.url.includes("/chat.html"));
            if (existing) {
                existing.focus();
                existing.navigate(url);
                return;
            }
            return self.clients.openWindow(url);
        })
    );
});
