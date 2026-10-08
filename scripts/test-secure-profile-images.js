const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

async function load(relativePath, mocks) {
  const filename = path.resolve(__dirname, "..", relativePath);
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, Buffer, __dirname: path.dirname(filename),
    require: (name) => mocks[name] || localRequire(name) };
  vm.runInNewContext(await fs.readFile(filename, "utf8"), context, { filename });
  return context.module.exports;
}

async function main() {
  const { storageService } = require("../src/shared/storage/storage-service");
  const before = Math.floor(Date.now() / 1000);
  const signed = storageService.signProfileImage({ publicId: "test/private-avatar", format: "png" });
  const url = new URL(signed.url);
  assert.equal(url.searchParams.get("type"), "authenticated");
  assert.equal(url.searchParams.get("attachment"), "false");
  assert.ok(Number(url.searchParams.get("expires_at")) >= before + 300);
  assert.ok(Number(url.searchParams.get("expires_at")) <= before + 301);
  assert.ok(url.searchParams.get("signature"));

  const env = { cloudinary: { enabled: true }, upload: { localStorageEnabled: true } };
  let uploadedOptions;
  const { fileUploadService } = await load("src/shared/upload/file-upload.service.js", {
    "../../config/env": { env },
    "../storage/storage-service": { storageService: {
      upload: async (file, options) => {
        uploadedOptions = options;
        return { public_id: "secure-avatar", format: "png", secure_url: "https://unsafe.example/permanent" };
      },
      signProfileImage: () => ({ url: "https://signed.example/temporary", expiresAt: before + 300 }),
    } },
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "secure-avatar-test-"));
  const filename = path.join(directory, "avatar.png");
  const file = { path: filename, mimetype: "image/png", originalname: "avatar.png", size: 8 };
  const write = () => fs.writeFile(filename, Buffer.from([137,80,78,71,13,10,26,10]));
  try {
    await write();
    const image = await fileUploadService.uploadImage(file, { moduleName: "customer-profiles", req: { protocol: "http", get: () => "localhost:4000", auth: { role: "buyer", sub: "owner" } } });
    assert.equal(uploadedOptions.type, "authenticated");
    assert.equal(image.url, "http://localhost:4000/api/v1/users/me/profile-image");
    assert.ok(!JSON.stringify(image).includes("unsafe.example"));
    assert.equal(image.deliveryType, "authenticated");
    assert.equal(image.protected, true);
    assert.equal(image.expiresAt, undefined);
    await assert.rejects(fs.access(filename));
    await write();
    await assert.rejects(fileUploadService.uploadImage(file, { moduleName: "customer-profiles", req: { auth: { role: "seller" } } }), /customer account/);
    env.cloudinary.enabled = false;
    await write();
    await assert.rejects(fileUploadService.uploadImage(file, { moduleName: "customer-profiles", req: { auth: { role: "buyer" } } }), /require configured Cloudinary/);
    await assert.rejects(fs.access(filename));
    console.log("PASS: authenticated upload, 300-second internal signed URL, only protected backend URL returned, customer access required, no public/local fallback, temporary files cleaned up.");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
