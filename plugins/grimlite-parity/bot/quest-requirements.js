// Quests.as:GetQuestTree answers a quest's requirements as RequiredItems (sName, ItemID, bTemp,
// iQty). A row read through an older surface, or carried in a saved file, may still hold the raw
// turnin list or the legacy reqd one; this picks whichever list the row actually has.
function requirementsOf(row) {
    if (!row) return [];
    const lists = [row.RequiredItems, row.turnin, row.reqd];
    for (let i = 0; i < lists.length; i++) {
        if (Array.isArray(lists[i])) return lists[i];
    }
    return [];
}

module.exports = {
    requirementsOf: requirementsOf
};
