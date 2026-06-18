const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase } = require("./backend-helpers.cjs");

test("profile backend reads and updates workspace profile metadata", () => {
  const { createProfileBackend } = require("./backend-profile.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-profile-"));
  const db = openDatabase(dataDir, "0.0.1-test");
  const profile = createProfileBackend({ db, appConfigDir: dataDir });

  try {
    assert.deepEqual(profile.getWorkspaceProfile(), {
      name: "",
      workspaceName: "Shelf",
      avatarPath: null,
    });

    assert.deepEqual(
      profile.updateWorkspaceProfile({ name: "Marco", workspaceName: "Lab" }),
      {
        name: "Marco",
        workspaceName: "Lab",
        avatarPath: null,
      },
    );
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
