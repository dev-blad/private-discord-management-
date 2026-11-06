require("dotenv").config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

// MessageContent is a privileged intent: switch it on in the Discord developer
// portal (Bot page) or the bot will fail to log in.
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
client.commands = new Collection();

// Prefix commands (!mg, !syncdatabase, ...)
client.prefixCommands = new Collection();
const prefixPath = path.join(__dirname, "prefix");
for (const file of fs.readdirSync(prefixPath).filter(f => f.endsWith(".js"))) {
    const cmd = require(path.join(prefixPath, file));
    client.prefixCommands.set(cmd.name, cmd);
    for (const alias of cmd.aliases || []) client.prefixCommands.set(alias, cmd);
}

// Load command files
const commands = [];
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));


for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
}

// Register commands with Discord API
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function start() {
    await require("./db/migrate").migrate();
    require("./services/bossroster").syncRoster().catch(e => console.error("[bossroster]", e.message));
    try {
        console.log("🔄 Refreshing slash commands...");
        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,  // your app ID
                process.env.GUILD_ID
            ),
            { body: commands }
        );
        console.log("✅ Slash commands registered.");
    } catch (error) {
        console.error(error);
    }
}

// Load events
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(".js"));

for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

start()
    .then(() => client.login(process.env.DISCORD_TOKEN))
    .catch(err => { console.error("Startup failed:", err); process.exit(1); });
