// Skill icon + cape thumbnails from the OSRS wiki. Built from the wiki's naming
// pattern so every skill is covered; add an override below if one is wrong.
const WIKI = "https://oldschool.runescape.wiki/images/";

const OVERRIDES = {
    slayer: {
        icon: WIKI + "Slayer_icon_%28detail%29.png",
        cape: WIKI + "Slayer_cape%28t%29_detail.png"
    }
};

// sheet name -> wiki page name where they differ
const WIKI_NAME = { runecrafting: "Runecraft" };

function skillIcons(skill) {
    const key = String(skill || "").toLowerCase().trim();
    if (OVERRIDES[key]) return OVERRIDES[key];
    if (!key) return {};
    const page = WIKI_NAME[key] || key.charAt(0).toUpperCase() + key.slice(1);
    return { icon: `${WIKI}${page}_icon.png`, cape: `${WIKI}${page}_cape.png` };
}

module.exports = { skillIcons };
