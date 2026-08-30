import { KnexRepository } from "@mantlejs/knex";
import type { ActivityLog } from "../entities/activity-log.js";

export class ActivityLogRepository extends KnexRepository<ActivityLog> {
  readonly tableName = "activity_log";
}
