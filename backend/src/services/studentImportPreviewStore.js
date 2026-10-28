const crypto = require("node:crypto");

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PREVIEWS = 3;
const previews = new Map();

function pruneExpiredPreviews(now = Date.now()) {
  for (const [id, entry] of previews) {
    if (entry.expiresAt <= now) {
      previews.delete(id);
    }
  }

  while (previews.size > MAX_PREVIEWS) {
    previews.delete(previews.keys().next().value);
  }
}

function storePreview({ fileHash, importRecords, response }) {
  const now = Date.now();
  pruneExpiredPreviews(now);

  const previewId = crypto.randomUUID();
  const expiresAt = now + PREVIEW_TTL_MS;
  previews.set(previewId, {
    fileHash,
    importRecords,
    response,
    expiresAt,
  });
  pruneExpiredPreviews(now);

  return { previewId, expiresAt: new Date(expiresAt).toISOString() };
}

function getPreview(previewId) {
  pruneExpiredPreviews();
  return previews.get(previewId) || null;
}

function deletePreview(previewId) {
  previews.delete(previewId);
}

module.exports = { deletePreview, getPreview, storePreview };
