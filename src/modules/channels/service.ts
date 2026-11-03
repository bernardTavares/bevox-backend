import { listChannelConnections } from "./repository.js";

export async function listConnections(orgId: string) {
  return { items: await listChannelConnections(orgId) };
}
