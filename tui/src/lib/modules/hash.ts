import { readFileSync, lstatSync, realpathSync, readdirSync, createReadStream } from "fs";
import { createHash } from "crypto";
import { join } from "path";

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function hashFile(path: string): string {
  const data = readFileSync(path);
  return hashBuffer(data);
}

export async function hashFileAsync(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hasher = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hasher.update(chunk));
    stream.on("error", (err) => reject(err));
    stream.on("end", () => resolve(hasher.digest("hex")));
  });
}

export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashPath(path: string): { hash: string; isDirectory: boolean } {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    const resolved = realpathSync(path);
    return hashPath(resolved);
  }
  if (stat.isDirectory()) {
    return { hash: hashDirectory(path), isDirectory: true };
  }
  return { hash: hashFile(path), isDirectory: false };
}

export function hashDirectory(dir: string): string {
  const entries: string[] = [];

  const walk = (current: string, prefix: string) => {
    const children = readdirSync(current);
    children.sort();
    for (const child of children) {
      const fullPath = join(current, child);
      const relPath = prefix ? `${prefix}/${child}` : child;
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        const resolved = realpathSync(fullPath);
        const resolvedStat = lstatSync(resolved);
        if (resolvedStat.isDirectory()) {
          walk(resolved, relPath);
        } else if (resolvedStat.isFile()) {
          entries.push(relPath);
        }
      } else if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (stat.isFile()) {
        entries.push(relPath);
      }
    }
  };

  walk(dir, "");
  entries.sort();

  const hasher = createHash("sha256");
  for (const entry of entries) {
    const filePath = join(dir, entry);
    const fileHash = hashFile(filePath);
    hasher.update(entry);
    hasher.update("\0");
    hasher.update(fileHash);
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

export async function hashDirectoryAsync(dir: string): Promise<string> {
  const entries: string[] = [];

  const walk = async (current: string, prefix: string): Promise<void> => {
    const children = readdirSync(current);
    children.sort();
    for (const child of children) {
      const fullPath = join(current, child);
      const relPath = prefix ? `${prefix}/${child}` : child;
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        const resolved = realpathSync(fullPath);
        const resolvedStat = lstatSync(resolved);
        if (resolvedStat.isDirectory()) {
          await walk(resolved, relPath);
        } else if (resolvedStat.isFile()) {
          entries.push(relPath);
        }
      } else if (stat.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (stat.isFile()) {
        entries.push(relPath);
      }

      // Yield to keep the UI responsive on large directories.
      await new Promise<void>((r) => setImmediate(r));
    }
  };

  await walk(dir, "");
  entries.sort();

  const hasher = createHash("sha256");
  for (const entry of entries) {
    const filePath = join(dir, entry);
    const fileHash = await hashFileAsync(filePath);
    hasher.update(entry);
    hasher.update("\0");
    hasher.update(fileHash);
    hasher.update("\0");

    // Yield between file hashes as well.
    await new Promise<void>((r) => setImmediate(r));
  }

  return hasher.digest("hex");
}
