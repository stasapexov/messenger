const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY = process.env.CHAT_ENCRYPTION_KEY || '';

function getKey() {
    if (!KEY) return null;
    return crypto.createHash('sha256').update(KEY).digest();
}

function encryptMessage(message) {
    const key = getKey();
    if (!key) return message;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(String(message), 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptMessage(storedMessage) {
    const key = getKey();
    if (!key || typeof storedMessage !== 'string') return storedMessage;

    if (!storedMessage.startsWith('enc:')) {
        return storedMessage;
    }

    const parts = storedMessage.split(':');
    if (parts.length !== 4) {
        return storedMessage;
    }

    try {
        const [, ivB64, tagB64, encryptedB64] = parts;
        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            key,
            Buffer.from(ivB64, 'base64')
        );

        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encryptedB64, 'base64')),
            decipher.final(),
        ]);

        return decrypted.toString('utf8');
    } catch (error) {
        console.error('Decrypt error:', error.message);
        return storedMessage;
    }
}

module.exports = {
    encryptMessage,
    decryptMessage,
};