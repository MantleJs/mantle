import type { MantleApplication, Paginated } from "@mantlejs/core";
import type { OAuthProfile } from "./types.js";

type UserLike = Record<string, unknown>;

export async function findOrCreateUser(
  app: MantleApplication,
  entity: string,
  entityIdField: string,
  profile: OAuthProfile,
): Promise<UserLike> {
  const service = app.service<UserLike>(entity);

  const result = await service.find({ query: { [entityIdField]: profile.id } });
  const rows = Array.isArray(result) ? result : (result as Paginated<UserLike>).data;

  if (rows.length > 0) return rows[0] as UserLike;

  return service.create({
    [entityIdField]: profile.id,
    ...(profile.email !== undefined ? { email: profile.email } : {}),
    ...(profile.name !== undefined ? { name: profile.name } : {}),
  }) as Promise<UserLike>;
}
