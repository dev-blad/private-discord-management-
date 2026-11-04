const crypto = require("crypto");
const { UserError } = require("./money");

// Account login details are encrypted at rest with ACCOUNT_ENC_KEY (any long random string).
function key() {
    const k = process.env.ACCOUNT_ENC_KEY;
    if (!k || k.length < 16) throw new UserError("Account details can't be stored yet: set `ACCOUNT_ENC_KEY` (a long random string) on Railway first.");
    return crypto.createHash("sha256").update(k).digest();
}

function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
    const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), enc].map(b => b.toString("base64")).join(".");
}

function decrypt(blob) {
    const [iv, tag, enc] = blob.split(".").map(s => Buffer.from(s, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
