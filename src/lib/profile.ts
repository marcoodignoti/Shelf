import { invoke } from "./desktop";

export interface WorkspaceProfile {
  name: string;
  workspaceName: string;
  avatarPath: string | null;
}

export async function getWorkspaceProfile(): Promise<WorkspaceProfile> {
  return await invoke<WorkspaceProfile>("get_workspace_profile");
}

export async function updateWorkspaceProfile(
  patch: Partial<Pick<WorkspaceProfile, "name" | "workspaceName">> & { avatarPath?: null },
): Promise<WorkspaceProfile> {
  return await invoke<WorkspaceProfile>("update_workspace_profile", patch);
}

export async function importProfileAvatar(sourcePath: string): Promise<string> {
  return await invoke<string>("import_profile_avatar", { sourcePath });
}
