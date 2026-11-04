const { google } = require("googleapis");

// Railway pastes often add quotes, turn \n into real newlines or into spaces, or drop the end.
function cleanKey(raw) {
    let k = String(raw || "").trim().replace(/^["']+|["',]+$/g, "").replace(/\\n/g, "\n").replace(/\r/g, "");
    const m = k.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
    if (!m) throw new Error("GOOGLE_PRIVATE_KEY must start with -----BEGIN PRIVATE KEY----- and end with -----END PRIVATE KEY-----. Paste the whole value from the JSON file.");
    const body = m[1].replace(/\s+/g, "");
    if (body.length < 1000) throw new Error(`GOOGLE_PRIVATE_KEY looks cut off (${body.length} characters, expected about 1600). Copy the whole value.`);
    return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

async function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            type: "service_account",
            project_id: process.env.GOOGLE_PROJECT_ID,
            private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
            private_key: cleanKey(process.env.GOOGLE_PRIVATE_KEY),
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            client_id: process.env.GOOGLE_CLIENT_ID,
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
}

module.exports = { getSheetsClient };
