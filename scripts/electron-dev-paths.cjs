const path = require("node:path");

function defaultDevUserDataDir(root) {
  return path.join(root, ".shelf-dev", "user-data");
}

function electronDevEnv(env, root, rendererUrl) {
  return {
    ELECTRON_RENDERER_URL: rendererUrl,
    SHELF_USER_DATA_DIR: env.SHELF_USER_DATA_DIR || env.OPENNOTION_USER_DATA_DIR || defaultDevUserDataDir(root),
  };
}

module.exports = {
  defaultDevUserDataDir,
  electronDevEnv,
};
