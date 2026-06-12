const crypto = require("node:crypto");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

console.log("# SHELF_UPDATE_PUBLIC_KEY_PEM");
console.log(publicKey.export({ format: "pem", type: "spki" }).trim());
console.log("");
console.log("# SHELF_UPDATE_PRIVATE_KEY_PEM");
console.log(privateKey.export({ format: "pem", type: "pkcs8" }).trim());
console.log("");
console.log("# Put the public key in electron/update-public-key.pem.");
console.log("# Store the private key as a release secret, never in git.");
