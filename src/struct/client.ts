import { StructClient } from "@structbuild/sdk";

export function createStructClient(apiKey: string): StructClient {
  return new StructClient({ apiKey });
}
