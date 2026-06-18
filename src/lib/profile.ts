import { importProfileAvatarWithDialog, invoke } from "./desktop";

export interface WorkspaceProfile {
  name: string;
  workspaceName: string;
  avatarPath: string | null;
}

export async function getWorkspaceProfile(): Promise<WorkspaceProfile> {
  return await invoke("get_workspace_profile");
}

export async function updateWorkspaceProfile(
  patch: Partial<Pick<WorkspaceProfile, "name" | "workspaceName">> & { avatarPath?: null },
): Promise<WorkspaceProfile> {
  return await invoke("update_workspace_profile", patch);
}

export async function importProfileAvatarFromDialog(): Promise<string | null> {
  return await importProfileAvatarWithDialog();
}
