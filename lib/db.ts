export type StoryPrivacy = "PUBLIC" | "FOLLOWERS_ONLY" | "CLOSE_FRIENDS";
export type StoryMediaType = "IMAGE" | "VIDEO";

export type StoryRow = {
  id: string;
  owner_id: string;
  privacy: StoryPrivacy;
  created_at: string;
  expires_at: string;
  is_deleted: number;
  archived: number;
  highlight_title: string | null;
};

export function getDb() {
  return {
    pragma: (..._args: any[]) => undefined,
    exec: (..._args: any[]) => undefined,
    prepare: (..._args: any[]) => ({
      run: (..._runArgs: any[]) => ({ changes: 0 }),
      all: (..._allArgs: any[]) => [],
      get: (..._getArgs: any[]) => undefined,
    }),
    transaction: (fn: (..._args: any[]) => any) => (..._txArgs: any[]) => fn(..._txArgs),
  };
}

export function seedDefaultData() {
  return true;
}
