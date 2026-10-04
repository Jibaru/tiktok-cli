export type Visibility = "everyone" | "followers" | "friends" | "only-me" | "unknown";

export type Video = {
  id: string;
  description: string;
  createdAt: string;
  visibility: Visibility;
  status: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  durationSec: number | null;
  coverUrl: string | null;
  url: string;
};

export type RawItem = {
  item_id: string;
  desc?: string;
  create_time?: string;
  visibility?: number;
  status?: number;
  play_count?: string;
  like_count?: string;
  comment_count?: string;
  share_count?: string;
  favorite_count?: string;
  duration?: number;
  cover_url?: string[];
};

export type ItemListResponse = {
  item_list?: RawItem[];
  has_more?: boolean;
  cursor?: number;
};

// Observed in recon: read endpoints use 2 = only me, 3 = friends. Other codes are not verified yet.
const READ_VISIBILITY: Record<number, Visibility> = { 2: "only-me", 3: "friends" };

export function readVisibility(code: number | undefined): Visibility {
  return code === undefined ? "unknown" : (READ_VISIBILITY[code] ?? "unknown");
}

export function videoUrl(username: string, id: string): string {
  return `https://www.tiktok.com/@${username}/video/${id}`;
}

const count = (value: string | number | undefined) => Number(value ?? 0) || 0;

export function toVideo(item: RawItem, username: string): Video {
  return {
    id: item.item_id,
    description: item.desc ?? "",
    createdAt: new Date(count(item.create_time) * 1000).toISOString(),
    visibility: readVisibility(item.visibility),
    status: item.status ?? 0,
    views: count(item.play_count),
    likes: count(item.like_count),
    comments: count(item.comment_count),
    shares: count(item.share_count),
    saves: count(item.favorite_count),
    durationSec: item.duration ? item.duration / 1000 : null,
    coverUrl: item.cover_url?.[0] ?? null,
    url: videoUrl(username, item.item_id),
  };
}
