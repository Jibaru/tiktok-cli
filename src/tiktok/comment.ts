export type Comment = {
  id: string;
  text: string;
  createdAt: string;
  likes: number;
  replies: number;
  creatorLiked: boolean;
  author: { id: string; username: string; nickname: string };
  video: { id: string; description: string };
};

export type RawComment = {
  commentId: string;
  text?: string;
  createTime?: number;
  likeCount?: number;
  replyCount?: number;
  hasCreatorLiked?: boolean;
  user?: { uid?: string; uniqueId?: string; nickname?: string };
  item?: { itemId?: string; desc?: string };
};

export type CommentsResponse = {
  comments?: RawComment[];
  hasMore?: boolean;
  cursor?: string;
};

export type ReplyResponse = {
  comment?: { cid?: string; reply_id?: string; aweme_id?: string; text?: string };
};

export const COMMENTS_PATH = "/tiktokstudio/api/web/commentsV2";
export const COMMENT_PUBLISH_PATH = "/api/comment/publish/";
export const MAX_COMMENT_LENGTH = 150;

export function toComment(raw: RawComment): Comment {
  return {
    id: raw.commentId,
    text: raw.text ?? "",
    createdAt: new Date((raw.createTime ?? 0) * 1000).toISOString(),
    likes: raw.likeCount ?? 0,
    replies: raw.replyCount ?? 0,
    creatorLiked: raw.hasCreatorLiked ?? false,
    author: { id: raw.user?.uid ?? "", username: raw.user?.uniqueId ?? "", nickname: raw.user?.nickname ?? "" },
    video: { id: raw.item?.itemId ?? "", description: raw.item?.desc ?? "" },
  };
}

export function isUnansweredQuery(postData: string | null): boolean {
  return Boolean(postData?.includes('"creator_replied"'));
}
