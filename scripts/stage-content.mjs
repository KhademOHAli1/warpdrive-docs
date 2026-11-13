import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const renderer = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const guideRoot = "docs-site/docs";
const imageRoot = "docs-site/public/img";
const stageRoots = ["docs", "public/img"];
const receiptFile = ".staged-content.json";
const maxBytes = 32 * 1024 * 1024;
const maxFiles = 2_000;

function require(condition, message) {
  if (!condition) throw new Error(message);
}

function git(checkout, args, maxBuffer = 1024 * 1024) {
  return execFileSync("git", ["--no-replace-objects", "-C", checkout, ...args], {
    maxBuffer,
    timeout: 20_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicEntry(path) {
  if (path.startsWith(guideRoot + "/")) {
    const name = path.slice(guideRoot.length + 1);
    require(/^(?:[a-z0-9-]+\/)*(?:[a-z0-9-]+\.mdx?|meta\.json)$/.test(name),
      `Unexpected guide entry: ${path}`);
    return `docs/${name}`;
  }
  require(path.startsWith(imageRoot + "/"), `Unexpected source path: ${path}`);
  const name = path.slice(imageRoot.length + 1);
  if (name === "screenshots/.gitkeep") return null;
  require(/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:ico|jpg|jpeg|png|webp)$/.test(name),
    `Unexpected public image: ${path}`);
  return `public/img/${name}`;
}

function checkImage(path, bytes) {
  if (!path.startsWith("public/img/")) return;
  const format = path.split(".").at(-1);
  const valid =
    (format === "png" && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) ||
    (["jpg", "jpeg"].includes(format) && bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) ||
    (format === "ico" && bytes.subarray(0, 4).equals(Buffer.from("00000100", "hex"))) ||
    (format === "webp" && bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP");
  require(valid, `Public image content does not match its extension: ${path}`);
}

function parseMeta(path, bytes) {
  const value = JSON.parse(bytes.toString("utf8"));
  require(value && Array.isArray(value.pages) && value.pages.length > 0 &&
    value.pages.every((item) => typeof item === "string" && /^[a-z0-9-]+$/.test(item)) &&
    new Set(value.pages).size === value.pages.length, `Invalid sidebar metadata: ${path}`);
  return value.pages;
}

function checkSidebar(files, pages) {
  const docs = new Set([...files.keys()].filter((path) => path.startsWith("docs/")));
  const seen = new Set();
  function walk(dir) {
    const meta = `${dir}/meta.json`;
    require(pages.has(meta), `Missing sidebar metadata: ${meta}`);
    seen.add(meta);
    for (const child of pages.get(meta)) {
      const name = `${dir}/${child}`;
      const entries = [name + ".md", name + ".mdx", name + "/meta.json"].filter((p) => docs.has(p));
      require(entries.length === 1, `Missing or ambiguous sidebar entry: ${name}`);
      if (entries[0].endsWith("/meta.json")) walk(name);
      else seen.add(entries[0]);
    }
  }
  walk("docs");
  for (const path of docs) require(seen.has(path), `Guide is outside the sidebar allowlist: ${path}`);
}

async function existing(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function listStageTree(root, directory) {
  const info = await existing(join(root, directory));
  if (!info) return [];
  require(info.isDirectory() && !info.isSymbolicLink(), `Unsafe staged directory: ${directory}`);
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    require(entry.isDirectory() || entry.isFile(), `Unsafe staged entry: ${path}`);
    if (entry.isDirectory()) files.push(...await listStageTree(root, path));
    else files.push(path);
  }
  return files;
}

async function verifyPreviousStage() {
  const parent = await existing(join(renderer, "public"));
  require(!parent || (parent.isDirectory() && !parent.isSymbolicLink()), "Unsafe public directory");
  const stamp = await existing(join(renderer, receiptFile));
  require(!stamp || (stamp.isFile() && !stamp.isSymbolicLink()), "Unsafe staged content receipt");
  const receipt = stamp ? JSON.parse(await readFile(join(renderer, receiptFile), "utf8")) : null;
  const files = (await Promise.all(stageRoots.map((path) => listStageTree(renderer, path)))).flat();
  require(files.length === Object.keys(receipt?.files ?? {}).length,
    "Staged trees contain files outside the last staging receipt");
  for (const path of files) {
    const expected = receipt?.files?.[path];
    require(typeof expected === "string" && sha256(await readFile(join(renderer, path))) === expected,
      `Staged file changed locally: ${path}`);
  }
}

async function replaceStagedTrees(temp) {
  await mkdir(join(renderer, "public"), { recursive: true });
  const previous = join(temp, "previous");
  await mkdir(join(previous, "public"), { recursive: true });
  const movedOld = [];
  const movedNew = [];
  try {
    for (const path of [...stageRoots, receiptFile]) {
      const target = join(renderer, path);
      if (await existing(target)) {
        await rename(target, join(previous, path));
        movedOld.push(path);
      }
      await rename(join(temp, path), target);
      movedNew.push(path);
    }
  } catch (error) {
    try {
      for (const path of movedNew.reverse()) await rename(join(renderer, path), join(temp, path));
      for (const path of movedOld.reverse()) await rename(join(previous, path), join(renderer, path));
    } catch (rollbackError) {
      throw new Error(`Staging rollback failed. Previous files are under ${previous}.`, {
        cause: rollbackError,
      });
    }
    throw error;
  }
}

async function stage(checkout) {
  require(isAbsolute(checkout), "Provide the absolute Warpdrive checkout path");
  checkout = resolve(checkout);
  require(await realpath(checkout) === checkout, "The checkout path must not traverse symlinks");
  require(git(checkout, ["rev-parse", "--show-toplevel"]).toString("utf8").trim() === checkout,
    "Provide the root of the Warpdrive checkout");
  require(renderer !== checkout, "Renderer and content checkouts must be distinct");
  const revision = git(checkout, ["rev-parse", "--verify", "HEAD^{commit}"]).toString("ascii").trim();
  require(/^[0-9a-f]{40}$/.test(revision), "A full Warpdrive Git commit is required");
  const listing = git(checkout, ["ls-tree", "-rlz", revision, "--", guideRoot, imageRoot])
    .toString("utf8").split("\0").filter(Boolean);
  require(listing.length > 0 && listing.length <= maxFiles, "Unexpected public tree size");

  const entries = new Map();
  let totalBytes = 0;
  for (const item of listing) {
    const match = /^(100644) blob ([0-9a-f]{40}) +([0-9]+)\t([^\r\n]+)$/.exec(item);
    require(match, "Public content must be ordinary tracked Git files");
    const [, , blob, rawSize, source] = match;
    const path = publicEntry(source);
    if (path === null) continue;
    const size = Number(rawSize);
    totalBytes += size;
    require(size > 0 && totalBytes <= maxBytes && !entries.has(path), `Invalid public entry: ${source}`);
    entries.set(path, { blob, size });
  }
  require(entries.has("public/img/favicon.ico") && entries.has("public/img/logo.png"), "Missing site branding");

  const lock = join(renderer, ".stage-content.lock");
  await mkdir(lock);
  let temp;
  try {
    await verifyPreviousStage();
    temp = await mkdtemp(join(renderer, ".stage-content-"));
    const pages = new Map();
    const hashes = {};
    for (const [path, { blob, size }] of entries) {
      const bytes = git(checkout, ["cat-file", "blob", blob], size + 1);
      require(bytes.length === size, `Unexpected Git blob size: ${path}`);
      checkImage(path, bytes);
      if (path.endsWith("/meta.json")) pages.set(path, parseMeta(path, bytes));
      const target = join(temp, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
      hashes[path] = sha256(bytes);
    }
    checkSidebar(entries, pages);
    await writeFile(join(temp, receiptFile), JSON.stringify({ revision, files: hashes }, null, 2) + "\n", {
      flag: "wx",
    });
    await replaceStagedTrees(temp);
    console.log(`Staged ${entries.size} public content files from Warpdrive ${revision}.`);
  } catch (error) {
    if (error.cause) temp = undefined;
    throw error;
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

try {
  require(process.argv.length === 3, "Usage: bun scripts/stage-content.mjs <absolute Warpdrive checkout>");
  await stage(process.argv[2]);
} catch (error) {
  console.error(`Content staging failed: ${error.message}`);
  process.exitCode = 1;
}
