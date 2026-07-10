/**
 * Utility condivise per confronto e validazione di versioni semver.
 *
 * Prima esistevano 4 implementazioni quasi identiche (core.js, update-configs.js,
 * scripts/dependencies/updater.js, scripts/dependencies/config-manager.js,
 * scripts/dependencies/generator.js). Questo modulo è l'unica fonte di verità.
 */

// Rimuove prefissi semver (^, ~, >=, <=, >, <) da una stringa di versione.
// Le git URL (git+, bitbucket:, http) vengono restituite invariate.
function cleanVersion(v) {
  if (!v || typeof v !== "string") return "0.0.0";
  if (isUrlLikeVersion(v)) return v;
  return v.replace(/^[\^~>=<]+/, "");
}

function isUrlLikeVersion(v) {
  if (!v || typeof v !== "string") return false;
  return v.includes("git+") || v.includes("bitbucket:") || v.includes("http");
}

function parseVersionParts(v) {
  const parts = v.split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  return parts;
}

/**
 * Confronta due versioni (o git URL). Ritorna 1 / 0 / -1.
 * Se una delle due è una URL non-semver, il confronto è di sola uguaglianza.
 */
function compareVersions(version1, version2) {
  const v1 = cleanVersion(version1);
  const v2 = cleanVersion(version2);

  if (isUrlLikeVersion(v1) || isUrlLikeVersion(v2)) {
    return v1 === v2 ? 0 : 1;
  }

  const v1Parts = parseVersionParts(v1);
  const v2Parts = parseVersionParts(v2);
  const length = Math.max(v1Parts.length, v2Parts.length);

  for (let i = 0; i < length; i++) {
    const a = v1Parts[i] || 0;
    const b = v2Parts[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
}

/**
 * Verifica se `version` (versione attuale, es. presente in package.json)
 * soddisfa `range` (versione target definita nel config, es. "^1.2.3").
 */
function versionSatisfiesRange(version, range) {
  if (!version || !range) return false;
  if (version === range) return true;

  if (isUrlLikeVersion(version) || isUrlLikeVersion(range)) {
    return version === range;
  }

  const cleanV = cleanVersion(version);
  const cleanR = cleanVersion(range);

  if (cleanV === cleanR) return true;

  const vParts = cleanV.split(".").map(Number);
  const rParts = cleanR.split(".").map(Number);

  if (range.startsWith("^")) {
    // ^x.y.z significa >=x.y.z <(x+1).0.0
    if (vParts[0] === rParts[0] && vParts[1] >= rParts[1]) {
      if (vParts[1] > rParts[1]) return true;
      if (vParts[1] === rParts[1] && vParts[2] >= rParts[2]) return true;
    }
    return false;
  }

  if (range.startsWith("~")) {
    // ~x.y.z significa >=x.y.z <x.(y+1).0
    return (
      vParts[0] === rParts[0] &&
      vParts[1] === rParts[1] &&
      vParts[2] >= rParts[2]
    );
  }

  return cleanV === cleanR;
}

module.exports = {
  cleanVersion,
  isUrlLikeVersion,
  compareVersions,
  versionSatisfiesRange,
};
