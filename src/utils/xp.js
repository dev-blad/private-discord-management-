// OSRS experience table. xpTable[L] = total XP required to reach level L (1..99).
const xpTable = Array(100).fill(0);
{
    let points = 0;
    for (let lvl = 2; lvl <= 99; lvl++) {
        points += Math.floor((lvl - 1) + 300 * Math.pow(2, (lvl - 1) / 7));
        xpTable[lvl] = Math.floor(points / 4);
    }
}

/** XP needed to go from level `start` to level `end` (1 <= start < end <= 99). */
function getXpRequired(start, end) {
    return xpTable[end] - xpTable[start];
}

module.exports = { xpTable, getXpRequired };
