import { randomUUID } from "node:crypto";
import { getDb } from "./db";

export type StoryPrivacy = "PUBLIC" | "FOLLOWERS_ONLY" | "CLOSE_FRIENDS";
export type StoryMediaType = "IMAGE" | "VIDEO";

export type StoryMedia = {
  id: string;
  story_id: string;
  media_type: StoryMediaType;
  url: string;
  thumbnail_url: string | null;
  position: number;
  created_at: string;
};

export type StoryInteraction = {
  id: string;
  story_id: string;
  user_id: string;
  reaction?: string;
  message?: string;
  created_at: string;
  username?: string;
  display_name?: string;
};

export type StoryAnalytics = {
  totalViews: number;
  uniqueViewers: number;
  uniqueViewerIds: string[];
  completionRate: number;
  reactions: StoryInteraction[];
  replies: StoryInteraction[];
  viewers: Array<{ user_id: string; username: string; display_name: string; viewed_at: string }>;
  viewTimeline: Array<{ label: string; count: number }>;
  archived: boolean;
  expiresAt: string;
};

export function createStory(input: {
  ownerId: string;
  privacy: StoryPrivacy;
  media: Array<{ url: string; mediaType: StoryMediaType; thumbnailUrl?: string; position?: number }>;
  highlightTitle?: string;
}) {
  const db = getDb();
  const storyId = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

  db.transaction(() => {
    db.prepare(`INSERT INTO stories (id, owner_id, privacy, expires_at, highlight_title) VALUES (?, ?, ?, ?, ?)`).run(
      storyId,
      input.ownerId,
      input.privacy,
      expiresAt,
      input.highlightTitle ?? null,
    );

    const mediaStmt = db.prepare(`INSERT INTO story_media (id, story_id, media_type, url, thumbnail_url, position) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const [index, item] of input.media.entries()) {
      mediaStmt.run(randomUUID(), storyId, item.mediaType, item.url, item.thumbnailUrl ?? null, item.position ?? index);
    }
  })();

  return { storyId, expiresAt };
}

export function getActiveStories() {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, u.username, u.display_name
    FROM stories s
    JOIN users u ON u.id = s.owner_id
    WHERE s.is_deleted = 0 AND s.archived = 0 AND s.expires_at > ?
    ORDER BY s.created_at DESC
  `).all(new Date().toISOString()) as Array<{ id: string; owner_id: string; privacy: StoryPrivacy; created_at: string; expires_at: string; username: string; display_name: string; highlight_title: string | null }>;
}

export function getStoryById(storyId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, u.username AS owner_username, u.display_name AS owner_display_name
    FROM stories s
    JOIN users u ON u.id = s.owner_id
    WHERE s.id = ?
  `).get(storyId) as { id: string; owner_id: string; privacy: StoryPrivacy; created_at: string; expires_at: string; is_deleted: number; archived: number; highlight_title: string | null; owner_username: string; owner_display_name: string } | undefined;
}

export function getStoryMedia(storyId: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM story_media WHERE story_id = ? ORDER BY position ASC`).all(storyId) as StoryMedia[];
}

export function recordStoryView({ storyId, viewerId }: { storyId: string; viewerId: string }) {
  const db = getDb();
  const now = new Date().toISOString();
  const story = db.prepare(`SELECT * FROM stories WHERE id = ? AND is_deleted = 0 AND expires_at > ?`).get(storyId, now) as { id: string } | undefined;
  if (!story) return { inserted: false, reason: "expired_or_missing" };

  try {
    db.prepare(`INSERT INTO story_views (id, story_id, viewer_id, viewed_at) VALUES (?, ?, ?, ?)`).run(randomUUID(), storyId, viewerId, now);
    return { inserted: true };
  } catch {
    return { inserted: false, reason: "duplicate" };
  }
}

export function createReaction({ storyId, userId, reaction }: { storyId: string; userId: string; reaction: string }) {
  const db = getDb();
  const now = new Date().toISOString();
  try {
    const id = randomUUID();
    db.prepare(`INSERT INTO story_reactions (id, story_id, user_id, reaction, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, storyId, userId, reaction, now);
    return { success: true };
  } catch {
    db.prepare(`UPDATE story_reactions SET reaction = ?, created_at = ? WHERE story_id = ? AND user_id = ?`).run(reaction, now, storyId, userId);
    return { success: true, updated: true };
  }
}

export function createReply({ storyId, userId, message }: { storyId: string; userId: string; message: string }) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`INSERT INTO story_replies (id, story_id, user_id, message, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, storyId, userId, message, new Date().toISOString());
  return { success: true };
}

export function createHighlight({ ownerId, storyId, title }: { ownerId: string; storyId: string; title: string }) {
  const db = getDb();
  db.prepare(`INSERT INTO highlights (id, owner_id, title, story_id) VALUES (?, ?, ?, ?)`).run(randomUUID(), ownerId, title, storyId);
  return { success: true };
}

export function deleteOwnStory({ storyId, ownerId }: { storyId: string; ownerId: string }) {
  const db = getDb();
  const result = db.prepare(`UPDATE stories SET is_deleted = 1 WHERE id = ? AND owner_id = ?`).run(storyId, ownerId);
  return { deleted: result.changes > 0 };
}

export function archiveExpiredStory() {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT id FROM stories WHERE expires_at <= ? AND is_deleted = 0 AND archived = 0`).all(now) as { id: string }[];
  if (!rows.length) return { archived: 0 };

  const stmt = db.prepare(`UPDATE stories SET archived = 1 WHERE id = ?`);
  for (const row of rows) stmt.run(row.id);
  return { archived: rows.length };
}

export function getStoryAnalytics(storyId: string): StoryAnalytics {
  const db = getDb();
  const story = db.prepare(`SELECT * FROM stories WHERE id = ?`).get(storyId) as { id: string; expires_at: string; archived: number } | undefined;
  const totalViews = db.prepare(`SELECT COUNT(*) AS count FROM story_views WHERE story_id = ?`).get(storyId) as unknown as { count: number };
  const uniqueViewers = db.prepare(`SELECT COUNT(DISTINCT viewer_id) AS count FROM story_views WHERE story_id = ?`).get(storyId) as unknown as { count: number };
  const viewerRows = db.prepare(`
    SELECT sv.viewer_id AS user_id, u.username, u.display_name, sv.viewed_at
    FROM story_views sv
    JOIN users u ON u.id = sv.viewer_id
    WHERE sv.story_id = ?
    ORDER BY sv.viewed_at DESC
    LIMIT 25
  `).all(storyId) as Array<{ user_id: string; username: string; display_name: string; viewed_at: string }>;
  const reactions = db.prepare(`
    SELECT sr.id, sr.story_id, sr.user_id, sr.reaction, sr.created_at, u.username, u.display_name
    FROM story_reactions sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.story_id = ?
    ORDER BY sr.created_at DESC
  `).all(storyId) as StoryInteraction[];
  const replies = db.prepare(`
    SELECT sr.id, sr.story_id, sr.user_id, sr.message, sr.created_at, u.username, u.display_name
    FROM story_replies sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.story_id = ?
    ORDER BY sr.created_at DESC
  `).all(storyId) as StoryInteraction[];

  const timeline = db.prepare(`
    SELECT strftime('%H:%M', viewed_at) AS label, COUNT(*) AS count
    FROM story_views
    WHERE story_id = ?
    GROUP BY strftime('%H', viewed_at), strftime('%M', viewed_at)
    ORDER BY viewed_at ASC
    LIMIT 12
  `).all(storyId) as Array<{ label: string; count: number }>;

  const completionRate = totalViews.count > 0 ? Math.min(100, Math.round((uniqueViewers.count / Math.max(1, totalViews.count)) * 100)) : 0;

  return {
    totalViews: totalViews.count,
    uniqueViewers: uniqueViewers.count,
    uniqueViewerIds: (db.prepare(`SELECT DISTINCT viewer_id FROM story_views WHERE story_id = ? ORDER BY viewer_id`).all(storyId) as Array<{ viewer_id: string }>).map((row) => row.viewer_id),
    completionRate,
    reactions,
    replies,
    viewers: viewerRows,
    viewTimeline: timeline.length > 0 ? timeline : [{ label: "No views yet", count: 0 }],
    archived: Boolean(story?.archived),
    expiresAt: story?.expires_at ?? new Date().toISOString(),
  };
}

export function getHighlights(ownerId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT h.id, h.title, h.story_id, s.expires_at, s.archived, s.owner_id, s.privacy
    FROM highlights h
    JOIN stories s ON s.id = h.story_id
    WHERE h.owner_id = ?
    ORDER BY h.created_at DESC
  `).all(ownerId) as Array<{ id: string; title: string; story_id: string; expires_at: string; archived: number; owner_id: string; privacy: StoryPrivacy }>;
}

export function getAllStoriesForDashboard() {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, u.username, u.display_name,
      (SELECT COUNT(*) FROM story_views WHERE story_id = s.id) AS total_views,
      (SELECT COUNT(DISTINCT viewer_id) FROM story_views WHERE story_id = s.id) AS unique_views
    FROM stories s
    JOIN users u ON u.id = s.owner_id
    WHERE s.is_deleted = 0
    ORDER BY s.created_at DESC
  `).all() as Array<{ id: string; owner_id: string; privacy: StoryPrivacy; created_at: string; expires_at: string; archived: number; is_deleted: number; username: string; display_name: string; total_views: number; unique_views: number }>;
}
