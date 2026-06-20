function bind(backend, methodName) {
  return (args) => backend[methodName](args || {});
}

function createPageCommands(backend) {
  return {
    list_pages: bind(backend, "listPages"),
    list_all_pages: bind(backend, "listAllPages"),
    search_pages: bind(backend, "searchPages"),
    get_page: bind(backend, "getPage"),
    create_page: bind(backend, "createPage"),
    create_project: bind(backend, "createProject"),
    update_page: bind(backend, "updatePage"),
    delete_page: bind(backend, "deletePage"),
    delete_project: bind(backend, "deleteProject"),
    move_page: bind(backend, "movePage"),
    reorder_pages: bind(backend, "reorderPages"),
    import_pages: bind(backend, "importPages"),
    toggle_favorite: bind(backend, "toggleFavorite"),
    toggle_template: bind(backend, "toggleTemplate"),
    create_page_from_template: bind(backend, "createPageFromTemplate"),
    duplicate_page: bind(backend, "duplicatePage"),
  };
}

function createBackupCommands(backend) {
  return {
    export_backup: bind(backend, "exportBackup"),
    import_backup: bind(backend, "importBackup"),
    import_backup_content: bind(backend, "importBackupContent"),
  };
}

function createStudioCommands(backend) {
  return {
    list_studio_documents: bind(backend, "listStudioDocuments"),
    list_studio_projects: bind(backend, "listStudioProjects"),
    preview_studio_page_unification: bind(
      backend,
      "previewStudioPageUnification",
    ),
    migrate_studio_page_unification: bind(
      backend,
      "migrateStudioPageUnification",
    ),
    create_studio_project: bind(backend, "createStudioProject"),
    rename_studio_project: bind(backend, "renameStudioProject"),
    update_studio_project_parent: bind(backend, "updateStudioProjectParent"),
    delete_studio_project: bind(backend, "deleteStudioProject"),
    update_studio_document_project: bind(
      backend,
      "updateStudioDocumentProject",
    ),
    list_all_studio_document_page_links: bind(
      backend,
      "listAllStudioDocumentPageLinks",
    ),
    list_studio_document_page_links: bind(
      backend,
      "listStudioDocumentPageLinks",
    ),
    link_studio_document_page: bind(backend, "linkStudioDocumentPage"),
    update_studio_document_page_link: bind(
      backend,
      "updateStudioDocumentPageLink",
    ),
    unlink_studio_document_page: bind(backend, "unlinkStudioDocumentPage"),
    import_studio_document: bind(backend, "importStudioDocument"),
    replace_studio_document_file: bind(backend, "replaceStudioDocumentFile"),
    update_studio_document_viewer_state: bind(
      backend,
      "updateStudioDocumentViewerState",
    ),
    rename_studio_document: bind(backend, "renameStudioDocument"),
    open_studio_document_file: bind(backend, "openStudioDocumentFile"),
    reveal_studio_document_file: bind(backend, "revealStudioDocumentFile"),
    delete_studio_document: bind(backend, "deleteStudioDocument"),
  };
}

function createAssetCommands(backend) {
  return {
    import_cover_image: bind(backend, "importCoverImage"),
    import_editor_image: bind(backend, "importEditorImage"),
    import_editor_video: bind(backend, "importEditorVideo"),
    import_profile_avatar: bind(backend, "importProfileAvatar"),
  };
}

function createUpdateCommands(backend) {
  return {
    open_external_url: bind(backend, "openExternalUrl"),
    fetch_update_manifest: bind(backend, "fetchUpdateManifest"),
    download_update_artifact: bind(backend, "downloadUpdateArtifact"),
    cancel_update_download: bind(backend, "cancelUpdateDownload"),
  };
}

function createProfileCommands(backend) {
  return {
    get_workspace_profile: bind(backend, "getWorkspaceProfile"),
    update_workspace_profile: bind(backend, "updateWorkspaceProfile"),
  };
}

function createBackendCommandRegistry(backend) {
  return {
    ...createPageCommands(backend),
    ...createBackupCommands(backend),
    ...createStudioCommands(backend),
    ...createAssetCommands(backend),
    ...createUpdateCommands(backend),
    ...createProfileCommands(backend),
    show_character_palette: () => null,
  };
}

module.exports = {
  createBackendCommandRegistry,
};
