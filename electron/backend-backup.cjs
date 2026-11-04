const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  BACKUP_MAX_BYTES,
  BACKUP_MAX_ID_LENGTH,
  BACKUP_MAX_TITLE_LENGTH,
  PROFILE_TEXT_MAX_LENGTH,
  PROFILE_METADATA_KEYS,
  STUDIO_DOCUMENT_COLUMNS,
  STUDIO_DOCUMENT_PAGE_LINK_COLUMNS,
  STUDIO_PROJECT_COLUMNS,
  allowedCoverExtension,
  allowedEditorVideoExtension,
  coverExtensionFromMagic,
  isIsoBaseMediaVideo,
  isWebmVideo,
  decodeAppAssetPath,
  encodeAppAssetPath,
  ensurePrivateDirectory,
  isPathInside,
  parseImportedBackup,
  prepareImportedBackupPages,
  readImportedBackup,
  studioProjectIdFromPageId,
  studioProjectPageId,
  validateManagedAssetPath,
  validateBackupExportDestination,
} = require("./backend-helpers.cjs");
const {
  PORTABLE_ASSET_PREFIX,
  PORTABLE_BACKUP_FORMAT,
  PORTABLE_BACKUP_VERSION,
  checksumForManifest,
  createPortableArchive,
  extractPortableArchive,
  normalizeExtension,
  portableAssetId,
  portableAssetRef,
  removePortableArchiveStaging,
  sha256File,
} = require("./portable-backup-archive.cjs");

const APP_ASSET_URL_PREFIX = "opennotion-app://asset/";
const PORTABLE_STORAGE_KINDS = [
  "covers",
  "editor-images",
  "editor-videos",
  "avatars",
  "studio-documents",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPortableBackupPath(filePath) {
  return typeof filePath === "string" && path.extname(filePath).toLowerCase() === ".shelf";
}

function portableBackupPath(filePath) {
  if (!isPortableBackupPath(filePath)) throw new Error("portable backup must use a .shelf extension");
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error("backup destination parent must be a directory");
  }
}

function storedAssetKind(appConfigDir, canonicalPath) {
  for (const kind of PORTABLE_STORAGE_KINDS) {
    const root = path.join(appConfigDir, kind);
    if (!fs.existsSync(root)) continue;
    const canonicalRoot = fs.realpathSync(root);
    if (isPathInside(canonicalRoot, canonicalPath)) return kind;
  }
  throw new Error("backup asset is outside app-managed storage");
}

function appAssetPathFromUrl(value) {
  if (typeof value !== "string" || !value.startsWith(APP_ASSET_URL_PREFIX)) return null;
  const token = value.slice(APP_ASSET_URL_PREFIX.length);
  if (!token || token.includes("/") || token.includes("?")) {
    throw new Error("backup contains an invalid managed asset URL");
  }
  return decodeAppAssetPath(token);
}

function transformValue(value, transformString, transformRecord) {
  if (typeof value === "string") return transformString(value);
  if (Array.isArray(value)) return value.map((item) => transformValue(item, transformString, transformRecord));
  if (!isRecord(value)) return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = transformValue(item, transformString, transformRecord);
  }
  return transformRecord ? transformRecord(next) : next;
}

function transformSerializedContent(content, transformString, transformRecord) {
  if (typeof content !== "string" || content.trim() === "") return content;
  try {
    return JSON.stringify(transformValue(JSON.parse(content), transformString, transformRecord));
  } catch {
    return content;
  }
}

function createPortableAssetCollector(context) {
  const assets = [];
  const assetSources = new Map();
  const idsByCanonicalPath = new Map();

  function addPath(filePath, expectedKind = null) {
    const canonicalPath = validateManagedAssetPath(filePath, context.appConfigDir);
    const stats = fs.statSync(canonicalPath);
    if (!stats.isFile()) throw new Error("backup asset must be a file");
    const kind = storedAssetKind(context.appConfigDir, canonicalPath);
    if (expectedKind && kind !== expectedKind) {
      throw new Error("backup asset is stored in an unexpected directory");
    }
    const existingId = idsByCanonicalPath.get(canonicalPath);
    if (existingId) return portableAssetRef(existingId);

    const id = `asset-${String(assets.length + 1).padStart(6, "0")}`;
    idsByCanonicalPath.set(canonicalPath, id);
    assetSources.set(id, canonicalPath);
    assets.push({
      id,
      archive_path: `assets/${id}`,
      kind,
      extension: normalizeExtension(canonicalPath),
      size: stats.size,
      sha256: null,
    });
    return portableAssetRef(id);
  }

  function transformString(value) {
    if (typeof value !== "string") return value;
    const assetPath = appAssetPathFromUrl(value);
    if (assetPath) return addPath(assetPath);
    if (path.isAbsolute(value)) return addPath(value);
    return value;
  }

  async function descriptors() {
    const completed = [];
    for (const asset of assets) {
      completed.push({
        ...asset,
        sha256: await sha256File(assetSources.get(asset.id)),
      });
    }
    return completed;
  }

  return { addPath, assetSources, descriptors, transformString };
}

function sourceLinkRecord(link) {
  return {
    id: link.id,
    document_id: link.document_id,
    page_id: link.page_id,
    pdf_page: link.pdf_page,
    label: link.label,
    sort_order: link.sort_order,
    created_at: link.created_at,
    updated_at: link.updated_at,
  };
}

function validatePortableProfile(profile) {
  if (!isRecord(profile)) throw new Error("portable backup profile is invalid");
  if (typeof profile.name !== "string" || profile.name.length > PROFILE_TEXT_MAX_LENGTH) {
    throw new Error("portable backup profile name is invalid");
  }
  if (typeof profile.workspaceName !== "string" || profile.workspaceName.length > PROFILE_TEXT_MAX_LENGTH) {
    throw new Error("portable backup profile workspace name is invalid");
  }
  if (profile.avatar_path !== null && portableAssetId(profile.avatar_path) === null) {
    throw new Error("portable backup profile avatar is invalid");
  }
}

function assertString(value, name, maxLength = BACKUP_MAX_ID_LENGTH) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`portable backup ${name} is invalid`);
  }
}

function assertNullableString(value, name, maxLength = BACKUP_MAX_TITLE_LENGTH) {
  if (value !== null && (typeof value !== "string" || value.length > maxLength)) {
    throw new Error(`portable backup ${name} is invalid`);
  }
}

function validatePortableStudioPayload(payload, assetsById) {
  if (!Array.isArray(payload.studio_projects) || !Array.isArray(payload.studio_documents) || !Array.isArray(payload.studio_document_page_links)) {
    throw new Error("portable backup Studio data is invalid");
  }

  const projectIds = new Set();
  for (const project of payload.studio_projects) {
    if (!isRecord(project)) throw new Error("portable backup project is invalid");
    assertString(project.id, "project id");
    assertString(project.name, "project name", BACKUP_MAX_TITLE_LENGTH);
    if (project.parent_id !== null) assertString(project.parent_id, "project parent id");
    if (!Number.isInteger(project.sort_order)) throw new Error("portable backup project order is invalid");
    assertString(project.created_at, "project created timestamp", BACKUP_MAX_TITLE_LENGTH);
    assertString(project.updated_at, "project updated timestamp", BACKUP_MAX_TITLE_LENGTH);
    if (projectIds.has(project.id)) throw new Error("portable backup has duplicate projects");
    projectIds.add(project.id);
  }
  for (const project of payload.studio_projects) {
    if (project.parent_id && !projectIds.has(project.parent_id)) {
      throw new Error("portable backup project parent is missing");
    }
  }

  const documentIds = new Set();
  const documentAssetIds = new Set();
  for (const document of payload.studio_documents) {
    if (!isRecord(document)) throw new Error("portable backup document is invalid");
    assertString(document.id, "document id");
    assertString(document.title, "document title", BACKUP_MAX_TITLE_LENGTH);
    assertString(document.original_filename, "document filename", BACKUP_MAX_TITLE_LENGTH);
    assertString(document.note_page_id, "document note page id");
    if (document.project_id !== null) assertString(document.project_id, "document project id");
    assertString(document.last_opened_at, "document opened timestamp", BACKUP_MAX_TITLE_LENGTH);
    assertString(document.created_at, "document created timestamp", BACKUP_MAX_TITLE_LENGTH);
    assertString(document.updated_at, "document updated timestamp", BACKUP_MAX_TITLE_LENGTH);
    if (!Number.isInteger(document.viewer_zoom) || !Number.isInteger(document.viewer_page)) {
      throw new Error("portable backup document viewer state is invalid");
    }
    if (!["pdf-left", "note-left"].includes(document.panel_layout)) {
      throw new Error("portable backup document panel layout is invalid");
    }
    const assetId = portableAssetId(document.stored_file_path);
    if (!assetId || assetsById.get(assetId)?.kind !== "studio-documents") {
      throw new Error("portable backup document PDF is invalid");
    }
    if (documentIds.has(document.id) || documentAssetIds.has(assetId)) {
      throw new Error("portable backup has duplicate documents or document PDFs");
    }
    documentIds.add(document.id);
    documentAssetIds.add(assetId);
    if (document.project_id && !projectIds.has(document.project_id)) {
      throw new Error("portable backup document project is missing");
    }
  }

  const linkIds = new Set();
  const linkedPairs = new Set();
  for (const link of payload.studio_document_page_links) {
    if (!isRecord(link)) throw new Error("portable backup document link is invalid");
    assertString(link.id, "document link id");
    assertString(link.document_id, "document link document id");
    assertString(link.page_id, "document link page id");
    assertNullableString(link.label, "document link label");
    assertString(link.created_at, "document link created timestamp", BACKUP_MAX_TITLE_LENGTH);
    assertString(link.updated_at, "document link updated timestamp", BACKUP_MAX_TITLE_LENGTH);
    if (link.pdf_page !== null && (!Number.isInteger(link.pdf_page) || link.pdf_page < 1)) {
      throw new Error("portable backup document link page is invalid");
    }
    if (!Number.isInteger(link.sort_order) || !documentIds.has(link.document_id)) {
      throw new Error("portable backup document link is invalid");
    }
    const pair = `${link.document_id}\u0000${link.page_id}`;
    if (linkIds.has(link.id) || linkedPairs.has(pair)) {
      throw new Error("portable backup has duplicate document links");
    }
    linkIds.add(link.id);
    linkedPairs.add(pair);
  }
}

function validatePortablePayload(payload, assetsById) {
  if (!isRecord(payload)) throw new Error("portable backup payload is invalid");
  validatePortableProfile(payload.profile);
  const avatarAssetId = portableAssetId(payload.profile.avatar_path);
  if (avatarAssetId && assetsById.get(avatarAssetId)?.kind !== "avatars") {
    throw new Error("portable backup profile avatar is invalid");
  }
  const backup = parseImportedBackup(JSON.stringify({
    version: 1,
    exported_at: payload.exported_at,
    pages: payload.pages,
  }));
  validatePortableStudioPayload(payload, assetsById);
  const pageIds = new Set(backup.pages.map((page) => page.id));
  for (const document of payload.studio_documents) {
    if (!pageIds.has(document.note_page_id)) {
      throw new Error("portable backup document note is missing");
    }
  }
  for (const link of payload.studio_document_page_links) {
    if (!pageIds.has(link.page_id)) throw new Error("portable backup linked page is missing");
  }
  return backup.pages;
}

function orderedProjects(projects) {
  const remaining = [...projects];
  const ordered = [];
  const known = new Set();
  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((project) => !project.parent_id || known.has(project.parent_id));
    if (nextIndex === -1) throw new Error("portable backup project hierarchy contains a cycle");
    const [project] = remaining.splice(nextIndex, 1);
    ordered.push(project);
    known.add(project.id);
  }
  return ordered;
}

function importBatchId() {
  return `portable-${crypto.randomUUID()}`;
}

function buildPortableImportPlan(context, manifest, extractedAssets, importedAt) {
  const assetsById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const sourcePages = validatePortablePayload(manifest.payload, assetsById);
  const payload = manifest.payload;
  const projectIdMap = new Map(payload.studio_projects.map((project) => [project.id, crypto.randomUUID()]));
  const pageIdMap = new Map();

  for (const page of sourcePages) {
    const projectId = studioProjectIdFromPageId(page.id);
    pageIdMap.set(
      page.id,
      projectId && projectIdMap.has(projectId)
        ? studioProjectPageId(projectIdMap.get(projectId))
        : crypto.randomUUID(),
    );
  }

  const documentIdMap = new Map();
  for (const document of payload.studio_documents) {
    documentIdMap.set(
      document.id,
      document.id === document.note_page_id
        ? pageIdMap.get(document.note_page_id)
        : crypto.randomUUID(),
    );
  }

  const batchId = importBatchId();
  const targetPaths = new Map();
  const documentAssetIds = new Map();
  for (const document of payload.studio_documents) {
    const assetId = portableAssetId(document.stored_file_path);
    documentAssetIds.set(assetId, documentIdMap.get(document.id));
  }
  for (const asset of manifest.assets) {
    let targetPath;
    if (asset.kind === "studio-documents") {
      const documentId = documentAssetIds.get(asset.id);
      if (!documentId) throw new Error("portable backup has an unreferenced Studio PDF");
      targetPath = path.join(context.appConfigDir, asset.kind, batchId, documentId, "source.pdf");
    } else {
      targetPath = path.join(context.appConfigDir, asset.kind, batchId, `${asset.id}${asset.extension}`);
    }
    targetPaths.set(asset.id, targetPath);
  }

  const pageLinkTransform = (record) => {
    if (
      record.type === "pageLink" &&
      isRecord(record.props) &&
      typeof record.props.pageId === "string" &&
      pageIdMap.has(record.props.pageId)
    ) {
      return { ...record, props: { ...record.props, pageId: pageIdMap.get(record.props.pageId) } };
    }
    return record;
  };
  const importAssetUrl = (value) => {
    const assetId = portableAssetId(value);
    if (!assetId) {
      if (typeof value === "string" && value.startsWith(PORTABLE_ASSET_PREFIX)) {
        throw new Error("portable backup references an unknown asset");
      }
      return value;
    }
    const targetPath = targetPaths.get(assetId);
    if (!targetPath) throw new Error("portable backup asset target is missing");
    return `${APP_ASSET_URL_PREFIX}${encodeAppAssetPath(targetPath)}`;
  };
  const importCover = (value) => {
    const assetId = portableAssetId(value);
    if (!assetId) return value;
    const targetPath = targetPaths.get(assetId);
    if (!targetPath) throw new Error("portable backup cover asset is missing");
    return targetPath;
  };

  const mirroredProjectPageIds = new Set(
    payload.studio_projects.map((project) => studioProjectPageId(project.id)),
  );
  const pages = sourcePages
    .filter((page) => !mirroredProjectPageIds.has(page.id))
    .map((page) => ({
      ...page,
      id: pageIdMap.get(page.id),
      parent_id: page.parent_id ? (pageIdMap.get(page.parent_id) ?? null) : null,
      content: transformSerializedContent(page.content, importAssetUrl, pageLinkTransform),
      cover_url: importCover(page.cover_url),
      is_deleted: 0,
      created_at: importedAt,
      updated_at: importedAt,
    }));

  const projects = orderedProjects(payload.studio_projects).map((project) => ({
    id: projectIdMap.get(project.id),
    name: project.name,
    parent_id: project.parent_id ? projectIdMap.get(project.parent_id) : null,
    sort_order: project.sort_order,
    created_at: importedAt,
    updated_at: importedAt,
  }));
  const documents = payload.studio_documents.map((document) => ({
    id: documentIdMap.get(document.id),
    title: document.title,
    original_filename: path.basename(document.original_filename),
    stored_file_path: targetPaths.get(portableAssetId(document.stored_file_path)),
    note_page_id: pageIdMap.get(document.note_page_id),
    project_id: document.project_id ? projectIdMap.get(document.project_id) : null,
    last_opened_at: document.last_opened_at,
    viewer_zoom: document.viewer_zoom,
    viewer_page: document.viewer_page,
    panel_layout: document.panel_layout,
    created_at: importedAt,
    updated_at: importedAt,
  }));
  const links = payload.studio_document_page_links.map((link) => ({
    id: crypto.randomUUID(),
    document_id: documentIdMap.get(link.document_id),
    page_id: pageIdMap.get(link.page_id),
    pdf_page: link.pdf_page,
    label: link.label,
    sort_order: link.sort_order,
    created_at: importedAt,
    updated_at: importedAt,
  }));

  const avatarAssetId = portableAssetId(payload.profile.avatar_path);
  const profile = {
    name: payload.profile.name,
    workspaceName: payload.profile.workspaceName,
    avatarPath: avatarAssetId ? targetPaths.get(avatarAssetId) : null,
  };

  return {
    assetsById,
    batchId,
    documents,
    links,
    pages,
    profile,
    projects,
    targetPaths,
    extractedAssets,
  };
}

function readFileHeader(filePath, length) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, header, 0, length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

// Imported archives are untrusted: apply the same extension allowlists and
// magic-byte checks as the regular import paths, so a crafted backup cannot
// plant HTML/SVG/script files in managed asset storage.
function validatePortableAssetContent(asset, sourcePath) {
  const header = readFileHeader(sourcePath, 64);
  const fileName = `asset${asset.extension}`;
  if (asset.kind === "studio-documents") {
    if (!header.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("portable backup Studio document is not a PDF");
    }
    return;
  }
  if (asset.kind === "editor-videos") {
    const extension = allowedEditorVideoExtension(fileName);
    const valid =
      extension === "webm" ? isWebmVideo(header) : extension ? isIsoBaseMediaVideo(header) : false;
    if (!valid) throw new Error("portable backup video asset is not a supported video");
    return;
  }
  // covers, editor-images, avatars
  const extension = allowedCoverExtension(fileName);
  if (!extension || coverExtensionFromMagic(header) !== extension) {
    throw new Error("portable backup image asset is not a supported image");
  }
}

function stagePortableAssets(context, plan, stageDir) {
  for (const asset of plan.assetsById.values()) {
    const sourcePath = plan.extractedAssets.get(asset.id);
    const targetPath = plan.targetPaths.get(asset.id);
    if (!sourcePath || !targetPath) throw new Error("portable backup asset is missing during import");
    validatePortableAssetContent(asset, sourcePath);
    const relativeTarget = path.relative(context.appConfigDir, targetPath);
    if (!relativeTarget || relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      throw new Error("portable backup asset target is invalid");
    }
    const stagedPath = path.join(stageDir, "managed", relativeTarget);
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
    fs.copyFileSync(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
  }
}

function moveStagedAssetDirectories(context, batchId, stageDir) {
  const movedDirectories = [];
  try {
    for (const kind of PORTABLE_STORAGE_KINDS) {
      const source = path.join(stageDir, "managed", kind, batchId);
      if (!fs.existsSync(source)) continue;
      const destinationParent = path.join(context.appConfigDir, kind);
      const destination = path.join(destinationParent, batchId);
      ensurePrivateDirectory(destinationParent);
      fs.renameSync(source, destination);
      if (process.platform !== "win32") fs.chmodSync(destination, 0o700);
      movedDirectories.push(destination);
    }
    return movedDirectories;
  } catch (error) {
    for (const directory of movedDirectories) fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function removeMovedAssetDirectories(directories) {
  for (const directory of directories) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // The database transaction already rolled back. Leave a harmless orphan
      // only if the operating system refuses a cleanup attempt.
    }
  }
}

function importPortableData(context, plan) {
  let importedPageCount = 0;
  context.withTransaction(() => {
    for (const project of plan.projects) {
      context.db
        .prepare(
          `INSERT INTO studio_projects (${STUDIO_PROJECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project.id,
          project.name,
          project.parent_id,
          project.sort_order,
          project.created_at,
          project.updated_at,
        );
      if (context.isStudioPageUnified()) context.mirrorStudioProjectPage(project, project.updated_at);
    }

    importedPageCount = context.importPageRecords(plan.pages, { inTransaction: true });
    for (const document of plan.documents) {
      context.db
        .prepare(
          `INSERT INTO studio_documents (${STUDIO_DOCUMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          document.id,
          document.title,
          document.original_filename,
          document.stored_file_path,
          document.note_page_id,
          document.project_id,
          document.last_opened_at,
          document.viewer_zoom,
          document.viewer_page,
          document.panel_layout,
          document.created_at,
          document.updated_at,
        );
    }
    for (const link of plan.links) {
      context.db
        .prepare(
          `INSERT INTO studio_document_page_links (${STUDIO_DOCUMENT_PAGE_LINK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          link.id,
          link.document_id,
          link.page_id,
          link.pdf_page,
          link.label,
          link.sort_order,
          link.created_at,
          link.updated_at,
        );
    }

    const currentProfile = context.getWorkspaceProfile();
    if (currentProfile.name === "" && currentProfile.workspaceName === "Shelf") {
      context.writeMetadataValue(PROFILE_METADATA_KEYS.name, plan.profile.name);
      context.writeMetadataValue(PROFILE_METADATA_KEYS.workspaceName, plan.profile.workspaceName);
      if (plan.profile.avatarPath) {
        context.writeMetadataValue(PROFILE_METADATA_KEYS.avatarPath, plan.profile.avatarPath);
      }
    }
  });
  return importedPageCount;
}

async function exportPortableBackup(context, filePath, exportedAt) {
  portableBackupPath(filePath);
  const collector = createPortableAssetCollector(context);
  const profile = context.getWorkspaceProfile();
  const payload = {
    exported_at: exportedAt,
    profile: {
      name: profile.name,
      workspaceName: profile.workspaceName,
      avatar_path: profile.avatarPath ? collector.addPath(profile.avatarPath, "avatars") : null,
    },
    pages: context.listAllPages().map((page) => ({
      ...page,
      content: transformSerializedContent(page.content, collector.transformString),
      cover_url: collector.transformString(page.cover_url),
    })),
    studio_projects: context.listStudioProjects(),
    studio_documents: context.listStudioDocuments().map((document) => ({
      ...document,
      stored_file_path: collector.addPath(document.stored_file_path, "studio-documents"),
    })),
    studio_document_page_links: context.listAllStudioDocumentPageLinks().map(sourceLinkRecord),
  };
  const assets = await collector.descriptors();
  const manifest = {
    format: PORTABLE_BACKUP_FORMAT,
    version: PORTABLE_BACKUP_VERSION,
    exported_at: exportedAt,
    payload,
    assets,
  };
  manifest.checksum = checksumForManifest(manifest);
  await createPortableArchive({
    destinationPath: filePath,
    manifest,
    assetSources: collector.assetSources,
  });
  return payload.pages.length;
}

async function importPortableBackup(context, filePath, importedAt) {
  const { manifest, stageDir, assetsById } = await extractPortableArchive({
    sourcePath: filePath,
    stagingRoot: context.appConfigDir,
  });
  try {
    const plan = buildPortableImportPlan(context, manifest, assetsById, importedAt);
    stagePortableAssets(context, plan, stageDir);
    const movedDirectories = moveStagedAssetDirectories(context, plan.batchId, stageDir);
    try {
      return importPortableData(context, plan);
    } catch (error) {
      removeMovedAssetDirectories(movedDirectories);
      throw error;
    }
  } finally {
    removePortableArchiveStaging(stageDir);
  }
}

function createBackupBackend(context) {
  const backupBackend = {
    exportBackup({ path: filePath, exportedAt, exported_at }) {
      const exported = exportedAt ?? exported_at ?? new Date().toISOString();
      if (isPortableBackupPath(filePath)) {
        return exportPortableBackup(context, filePath, exported);
      }
      validateBackupExportDestination(filePath);
      const pages = context.listAllPages();
      const profile = (() => {
        const p = context.getWorkspaceProfile();
        return { name: p.name, workspaceName: p.workspaceName };
      })();
      const raw = JSON.stringify(
        { version: 1, exported_at: exported, profile, pages },
        null,
        2,
      );
      if (Buffer.byteLength(raw, "utf8") > BACKUP_MAX_BYTES)
        throw new Error("Backup export is too large");
      const tempPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.tmp`,
      );
      try {
        fs.writeFileSync(tempPath, raw);
        fs.renameSync(tempPath, filePath);
      } catch (error) {
        fs.rmSync(tempPath, { force: true });
        throw error;
      }
      return pages.length;
    },

    importBackup({ path: filePath, importedAt, imported_at }) {
      const imported = importedAt ?? imported_at ?? new Date().toISOString();
      if (isPortableBackupPath(filePath)) {
        return importPortableBackup(context, filePath, imported);
      }
      const backup = readImportedBackup(filePath);
      return backupBackend.importBackupData(backup, imported);
    },

    importBackupContent({ content, importedAt, imported_at }) {
      const imported = importedAt ?? imported_at ?? new Date().toISOString();
      if (typeof content !== "string")
        throw new Error("backup content is required");
      return backupBackend.importBackupData(parseImportedBackup(content), imported);
    },

    backupProfilePatch(backup) {
      if (
        !backup.profile ||
        typeof backup.profile !== "object" ||
        Array.isArray(backup.profile)
      )
        return null;
      const patch = {};
      const { name, workspaceName } = backup.profile;
      if (name !== undefined) {
        if (typeof name !== "string" || name.length > PROFILE_TEXT_MAX_LENGTH) {
          throw new Error("backup profile name too long or invalid");
        }
        patch.name = name;
      }
      if (workspaceName !== undefined) {
        if (
          typeof workspaceName !== "string" ||
          workspaceName.length > PROFILE_TEXT_MAX_LENGTH
        ) {
          throw new Error("backup workspace name too long or invalid");
        }
        patch.workspaceName = workspaceName;
      }
      return patch;
    },

    importBackupData(backup, imported) {
      const profilePatch = backupBackend.backupProfilePatch(backup);
      const importedPages = prepareImportedBackupPages(backup.pages, imported);
      let importedCount = 0;
      context.withTransaction(() => {
        importedCount = context.importPageRecords(importedPages, {
          inTransaction: true,
        });
        if (profilePatch) {
          const current = context.getWorkspaceProfile();
          if (current.name === "" && current.workspaceName === "Shelf") {
            if (profilePatch.name !== undefined) {
              context.writeMetadataValue(
                PROFILE_METADATA_KEYS.name,
                profilePatch.name,
              );
            }
            if (profilePatch.workspaceName !== undefined) {
              context.writeMetadataValue(
                PROFILE_METADATA_KEYS.workspaceName,
                profilePatch.workspaceName,
              );
            }
          }
        }
      });
      return importedCount;
    },
  };

  return backupBackend;
}

module.exports = { createBackupBackend };
