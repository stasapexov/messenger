# Messenger

Приватный веб-мессенджер для небольшой команды. Проект рассчитан на запуск на VPS, например Timeweb Cloud: один Node.js процесс, SQLite-файл на сервере, защищённые файлы, личные и групповые чаты, новости с аудиториями и push-уведомления.

## Что есть

- регистрация только по инвайт-коду;
- вход по логину и паролю;
- защищённая `HttpOnly` cookie-сессия;
- пароли хранятся через `scrypt`, админ может сбросить пароль;
- SQLite без отдельного сервера БД;
- личные и групповые чаты;
- отправка текста, фото, видео, документов и голосовых;
- редактирование сообщений;
- удаление у себя, удаление у всех, удаление админом/владельцем группы;
- приватная выдача файлов только участникам нужного чата или аудитории новости;
- новости с картинкой, лайками и комментариями;
- аудитория новости: все, выбранные пользователи или группы;
- Web Push уведомления через PWA.

## Требования

- Node.js `22.5+` или новее, потому что используется встроенный `node:sqlite`;
- HTTPS на продакшене для cookie `Secure`, микрофона и push-уведомлений;
- Nginx или другой reverse proxy на VPS.

## Быстрый запуск

```bash
npm install
npm start
```

Откройте `http://localhost:3000`.

При первом запуске сервер создаст:

- админа `admin / admin123`;
- первый инвайт-код в консоли;
- SQLite-файл `data/messenger.sqlite`;
- VAPID-ключи для push-уведомлений в SQLite.

После входа сразу смените пароль админа через админскую функцию сброса или задайте его через переменные окружения.

## Переменные окружения

```bash
PORT=3000
ADMIN_LOGIN=admin
ADMIN_PASSWORD=strong-password
ADMIN_NAME=Admin
INITIAL_INVITE_CODE=MSG-FIRST-CODE
SESSION_DAYS=30
MAX_UPLOAD_MB=250
COOKIE_SECURE=true
WEB_PUSH_SUBJECT=mailto:you@example.com
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

Если `VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY` не заданы, сервер создаст и сохранит их сам.

## Данные сервера

Рабочие данные не коммитятся:

- `data/messenger.sqlite`;
- `data/messenger.sqlite-wal`;
- `data/messenger.sqlite-shm`;
- `storage/files/*`.

Для бэкапа достаточно сохранять папки `data/` и `storage/`.

## Timeweb Cloud

1. Установите Node.js 22+.
2. Склонируйте репозиторий на VPS.
3. Выполните `npm install`.
4. Создайте `.env` или systemd environment с сильным `ADMIN_PASSWORD`.
5. Запустите `npm start` через `pm2` или `systemd`.
6. Настройте Nginx на домен и проксирование к `127.0.0.1:3000`.
7. Включите HTTPS.

Пример Nginx:

```nginx
server {
    server_name chat.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## API

Основные маршруты:

- `POST /register`;
- `POST /login`;
- `POST /logout`;
- `GET /me`;
- `GET /users`;
- `GET /chats`;
- `POST /chats/direct`;
- `POST /chats/group`;
- `GET /chats/:id/messages`;
- `POST /chats/:id/messages`;
- `PATCH /messages/:id`;
- `DELETE /messages/:id`;
- `POST /files`;
- `GET /files/:id`;
- `GET /news`;
- `POST /news`;
- `PUT /news/:id`;
- `DELETE /news/:id`;
- `POST /news/:id/like`;
- `POST /news/:id/comments`;
- `POST /admin/invites`;
- `POST /admin/users/:id/reset-password`;
- `POST /push/subscribe`.
