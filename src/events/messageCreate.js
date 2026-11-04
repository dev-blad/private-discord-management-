const { UserError } = require("../utils/money");

// Prefix commands (!mg, !syncdatabase, ...). Commands live in src/prefix/.
module.exports = {
    name: "messageCreate",
    once: false,
    async execute(message, client) {
        if (message.author.bot || !message.guild) return;
        const prefix = process.env.PREFIX || "!";
        if (!message.content.startsWith(prefix)) return;

        const [name, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
        const command = client.prefixCommands?.get((name || "").toLowerCase());
        if (!command) return;

        try {
            await command.execute(message, args, client);
        } catch (err) {
            const msg = err instanceof UserError ? `❌ ${err.message}` : "❌ Something went wrong. It has been logged.";
            if (!(err instanceof UserError)) console.error(`[prefix:${name}] error:`, err);
            try { await message.reply(msg); } catch (e) { /* channel gone */ }
        }
    }
};
