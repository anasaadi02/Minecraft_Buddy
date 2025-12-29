// Helper functions used across the bot

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function goNearPosition(bot, defaultMovements, goals, targetPos, radius = 1.2, timeoutMs = 15000) {
  try { bot.pathfinder.setMovements(defaultMovements); } catch (_) {}
  const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, Math.max(1, Math.floor(radius)));
  bot.pathfinder.setGoal(goal);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = bot.entity.position.distanceTo(targetPos);
    if (d <= radius) return true;
    await sleep(150);
  }
  return false;
}

function resolveItemIdsFromTerm(mcData, term) {
  if (!mcData) return [];
  const normalized = term.replace(/\s+/g, '_');

  // 1) Exact item match
  if (mcData.itemsByName[normalized]) {
    return [mcData.itemsByName[normalized].id];
  }

  // 2) Category/alias handling
  const lower = normalized.toLowerCase();
  const candidates = [];

  // wood => any logs or planks
  if (lower === 'wood' || lower === 'log' || lower === 'logs' || lower === 'planks' || lower === 'wood_planks') {
    for (const name in mcData.itemsByName) {
      if (/(_log|_planks)$/.test(name)) candidates.push(mcData.itemsByName[name].id);
    }
    return candidates;
  }

  // food => common edible items
  if (lower === 'food') {
    const foodNames = ['bread','cooked_beef','cooked_porkchop','cooked_mutton','cooked_chicken','baked_potato','carrot','apple'];
    for (const n of foodNames) if (mcData.itemsByName[n]) candidates.push(mcData.itemsByName[n].id);
    return candidates;
  }

  // fallback: partial name contains
  for (const name in mcData.itemsByName) {
    if (name.includes(lower)) candidates.push(mcData.itemsByName[name].id);
  }
  return candidates;
}

module.exports = {
  sleep,
  goNearPosition,
  resolveItemIdsFromTerm
};

