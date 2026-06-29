import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import type { MantleApplication, MantlePlugin } from "@mantlejs/mantle";

export interface DynamoDbConfig {
  /** AWS region (e.g. "us-east-1"). Falls back to AWS_REGION env var when omitted. */
  region?: string;
  /** Full DynamoDB client config — endpoint, credentials, etc. Takes precedence over `region`. */
  clientConfig?: DynamoDBClientConfig;
}

/**
 * Mantle plugin that creates a DynamoDB client and stores it on the application.
 *
 * @example
 * ```ts
 * const app = mantle().configure(dynamodb({ region: "us-east-1" }));
 * ```
 */
export function dynamodb(config: DynamoDbConfig = {}): MantlePlugin {
  return (app: MantleApplication): void => {
    const client = new DynamoDBClient({
      ...(config.region ? { region: config.region } : {}),
      ...config.clientConfig,
    });
    app.set("dynamodb", client);

    const originalTeardown = (app as unknown as Record<string, unknown>)["teardown"] as () => Promise<void>;
    (app as unknown as Record<string, unknown>)["teardown"] = async () => {
      await originalTeardown.call(app);
      client.destroy();
    };
  };
}
