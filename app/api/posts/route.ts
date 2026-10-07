import { getAuthenticatedUserId, hasTrustedMutationOrigin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createPostWithSubscription } from "@/lib/subscriptions";
import type { StoryMediaType, StoryPrivacy } from "@/lib/db";

export const runtime = "nodejs";

const allowedPrivacy = new Set<StoryPrivacy>(["PUBLIC", "FOLLOWERS_ONLY", "CLOSE_FRIENDS"]);
const allowedMediaTypes = new Set<StoryMediaType>(["IMAGE", "VIDEO"]);

export async function POST(request: Request) {
  if (!hasTrustedMutationOrigin(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  let userId: string | null;
  try {
    userId = getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  }

  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  try {
    const user = getDb().prepare("SELECT id FROM users WHERE id = ?").get(userId) as { id: string } | undefined;
    if (!user) return Response.json({ error: "Authenticated account was not found." }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;
    const privacy = body.privacy;
    const media = body.media;
    const highlightTitle = body.highlightTitle;

    if (!allowedPrivacy.has(privacy as StoryPrivacy)) {
      return Response.json({ error: "Choose a valid post privacy setting." }, { status: 400 });
    }
    if (!Array.isArray(media) || media.length < 1 || media.length > 10) {
      return Response.json({ error: "A post must contain between 1 and 10 media items." }, { status: 400 });
    }

    const validatedMedia: Array<{ url: string; mediaType: StoryMediaType; thumbnailUrl?: string }> = [];
    for (const item of media) {
      if (!item || typeof item !== "object") return Response.json({ error: "Invalid media item." }, { status: 400 });
      const value = item as Record<string, unknown>;
      if (typeof value.url !== "string" || typeof value.mediaType !== "string" || !allowedMediaTypes.has(value.mediaType as StoryMediaType)) {
        return Response.json({ error: "Each media item needs a valid URL and media type." }, { status: 400 });
      }
      let mediaUrl: URL;
      try {
        mediaUrl = new URL(value.url);
      } catch {
        return Response.json({ error: "Each media item needs a valid URL." }, { status: 400 });
      }
      if (mediaUrl.protocol !== "https:") {
        return Response.json({ error: "Media URLs must use HTTPS." }, { status: 400 });
      }
      if (value.thumbnailUrl !== undefined && typeof value.thumbnailUrl !== "string") {
        return Response.json({ error: "Media thumbnail URL must be a string." }, { status: 400 });
      }
      validatedMedia.push({
        url: mediaUrl.toString(),
        mediaType: value.mediaType as StoryMediaType,
        ...(typeof value.thumbnailUrl === "string" ? { thumbnailUrl: value.thumbnailUrl } : {}),
      });
    }

    if (highlightTitle !== undefined && (typeof highlightTitle !== "string" || highlightTitle.length > 80)) {
      return Response.json({ error: "Highlight title must be 80 characters or fewer." }, { status: 400 });
    }

    const result = createPostWithSubscription({
      ownerId: userId,
      privacy: privacy as StoryPrivacy,
      media: validatedMedia,
      ...(typeof highlightTitle === "string" ? { highlightTitle } : {}),
    });

    if (!result.ok) {
      if (result.reason === "active_subscription_required") {
        return Response.json({ error: "An active subscription is required to create posts." }, { status: 402 });
      }
      return Response.json({
        error: "Monthly post limit reached.",
        limit: result.limit,
        postCount: result.postCount,
      }, { status: 429 });
    }

    return Response.json({
      postId: result.storyId,
      expiresAt: result.expiresAt,
      monthlyPostCount: result.monthlyPostCount,
      monthlyPostLimit: result.monthlyPostLimit,
    }, { status: 201 });
  } catch {
    return Response.json({ error: "Unable to create post." }, { status: 400 });
  }
}