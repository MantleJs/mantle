import type { Id } from "@mantlejs/mantle";

export interface ActivityLog extends Record<string, unknown> {
  id: number;
  entityType: string;
  entityId: Id;
  action: string;
  actorId: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}
