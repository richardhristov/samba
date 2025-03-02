#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net --allow-ffi
import { generateObject } from "npm:ai@4.1.47";
import { openrouter } from "npm:@openrouter/ai-sdk-provider@0.4.2";
import { CronJob } from "npm:cron@4.1.0";
import * as path from "jsr:@std/path";
import { existsSync } from "jsr:@std/fs/exists";
import { Database } from "jsr:@db/sqlite@0.12.0";
import { z } from "npm:zod@3.24.2";

// Get and validate environment variables
const REAL_RUN = Deno.env.get("REAL_RUN") === "true";
const SOURCE_DIR = Deno.env.get("SOURCE_DIR")!;
if (!SOURCE_DIR || !existsSync(SOURCE_DIR, { isFile: false })) {
  console.error("SOURCE_DIR is not set or does not exist");
  Deno.exit(1);
}
const TARGET_DIR = Deno.env.get("TARGET_DIR")!;
if (!TARGET_DIR || !existsSync(TARGET_DIR, { isFile: false })) {
  console.error("TARGET_DIR is not set or does not exist");
  Deno.exit(1);
}
const dataDir = path.join(TARGET_DIR, ".organizer");
if (!existsSync(dataDir, { isFile: false })) {
  console.log(`Creating data directory ${dataDir}`);
  Deno.mkdirSync(dataDir);
}
const dbPath = path.join(dataDir, "organizer.db");
const MODEL = Deno.env.get("MODEL")!;
if (!MODEL) {
  console.error("MODEL is not set");
  Deno.exit(1);
}

// Initialize SQLite database and define db functions
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS processed_items (
    path TEXT PRIMARY KEY
  );
`);
function isProcessed(p: string) {
  const [count] = db.prepare(
    "SELECT count(*) FROM processed_items WHERE path = ?",
  ).value<
    [
      number,
    ]
  >(p)!;
  return count > 0;
}
function markProcessed(p: string) {
  db.prepare("INSERT OR REPLACE INTO processed_items (path) VALUES (?)").run(
    p,
  );
}

// Define filesystem
async function listItems(root: string) {
  const items = [];
  for await (const entry of Deno.readDir(root)) {
    items.push(
      {
        name: entry.name,
        type: entry.isFile ? "file" : "folder",
      } as const,
    );
  }
  return items;
}
async function createSymlink(args: {
  sourcePath: string;
  targetBase: string;
  target: string;
  allowedFolders: string[];
}) {
  if (!REAL_RUN) {
    console.log(
      `Skipping symlink creation ${args.sourcePath} -> ${args.target} because REAL_RUN is false`,
    );
    return;
  }
  if (
    !args.allowedFolders.some((folder) => args.target.startsWith(`${folder}/`))
  ) {
    console.log(
      `Skipping ${args.target} because it's not in the allowed folders`,
    );
    return;
  }
  // Create parent directories if they don't exist
  const targetPath = path.join(args.targetBase, args.target);
  const targetDir = path.dirname(targetPath);
  await Deno.mkdir(targetDir, { recursive: true });
  // Check if target already exists
  try {
    const targetStat = await Deno.lstat(targetPath);
    if (targetStat.isSymlink) {
      const currentTarget = await Deno.readLink(targetPath);
      if (currentTarget === args.sourcePath) {
        // Link already points to correct target
        return;
      }
      // Remove existing link with different target
      await Deno.remove(targetPath);
    } else {
      // Target exists but is not a symlink, don't overwrite
      console.log(
        `Cannot create symlink: ${targetPath} already exists and is not a symlink`,
      );
      return;
    }
  } catch {
    // Target doesn't exist, which is fine
  }
  // Create the symlink
  try {
    await Deno.symlink(args.sourcePath, targetPath);
    console.log(`Created symlink: ${targetPath} -> ${args.sourcePath}`);
  } catch (err) {
    console.error(
      `Error creating symlink ${targetPath} -> ${args.sourcePath}:`,
      err,
    );
  }
}
async function clean(root: string) {
  console.log(`Cleaning up ${root}...`);

  // Step 1: Find and delete all symlinks
  const foundDirs: string[] = [];

  // Walk the directory tree recursively
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;

    if (entry.isSymlink) {
      // Delete symlink
      try {
        await Deno.remove(path);
        console.log(`Removed symlink: ${path}`);
      } catch (err) {
        console.error(`Error removing symlink ${path}:`, err);
      }
    } else if (entry.isDirectory) {
      // Track directory for potential deletion later
      foundDirs.push(path);
      // Recursively clean subdirectories
      await clean(path);
    }
  }

  // Step 2: Delete empty directories (except the root itself)
  try {
    // Check if directory is empty
    const dirEntries = [];
    for await (const entry of Deno.readDir(root)) {
      dirEntries.push(entry);
    }
    if (dirEntries.length === 0) {
      await Deno.remove(root);
      console.log(`Removed empty directory: ${root}`);
    }
  } catch (err) {
    console.error(`Error checking/removing directory ${root}:`, err);
  }
}

// Define AI functions
const allowedFolders = [
  "Anime",
  "Movies",
  "TV Shows",
  "Manga",
  "Music",
  "Software",
  "Other",
];
const prompt = `
You are an AI assistant that categorizes files and folders. Your task is to suggest appropriate locations 
for organizing content.

Given a list of files and folders, categorize them into a logical directory structure. 
The categorization should be based on:
1. File/folder name patterns
2. Potential media type
3. Any identifiable genres, artists, or series

Important guidance:
- Keep folder structures as simple as possible
- DO NOT create extra subfolders (like "Season 1") unless necessary to avoid duplicate paths
- Only create subfolders for seasons, movies, specials, etc. when there are multiple items of the same series that need to be distinguished (e.g., both a TV show and a movie of the same title)
- For standalone content with no duplicates, use the simplest path possible (e.g., "TV Shows/Sasaki and Peeps" instead of "TV Shows/Sasaki and Peeps/Season 1")
- Process all the items without skipping any.

Organize only into the following root folders:
${JSON.stringify(allowedFolders)}

Anime contains both anime series and anime movies.

For files, the target path does not include the name of the file.
`;

// Function to send items to AI for categorization
async function categorizeItems(
  { prompt, items, model }: {
    prompt: string;
    items: { name: string; type: "file" | "folder" }[];
    model: string;
  },
) {
  const { object } = await generateObject({
    model: openrouter.chat(model),
    output: "array",
    schema: z.object({
      source: z.object({
        name: z.string().describe("The original source path, i.e. 'Nichijou'"),
        type: z.enum(["file", "folder"]).describe(
          "The type of the source item, i.e. 'file' or 'folder'",
        ),
      }),
      targets: z.array(z.string()).describe(
        "The target paths where the source item should be linked to, e.g. 'Movies/Titanic' or 'Anime/Nichijou'. For files, the target path does not include the name of the file.",
      ),
    }),
    messages: [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: `Data: ${JSON.stringify(items)}`,
      },
    ],
  });
  console.log(object);
  return object;
}

// Main functions
async function processFiles() {
  console.log("Starting file organization process...");

  // Get root items
  const allItems = await listItems(SOURCE_DIR);

  // Filter out already processed items
  const unprocessedItems = allItems.filter((item) => !isProcessed(item.name));
  if (unprocessedItems.length === 0) {
    console.log("No new items to process.");
    return;
  }

  console.log(`Found ${unprocessedItems.length} new items to process.`);

  // Categorize items with AI
  const categorizations = await categorizeItems({
    prompt,
    items: allItems,
    model: MODEL,
  });

  await clean(TARGET_DIR);

  // Process each categorization
  for (const item of categorizations) {
    try {
      for (const target of item.targets) {
        const sourcePath = path.join(SOURCE_DIR, item.source.name);
        await createSymlink({
          sourcePath,
          targetBase: TARGET_DIR,
          target: item.source.type === "folder"
            ? target
            : path.join(target, item.source.name),
          allowedFolders,
        });
      }
    } catch (err) {
      console.error(`Error processing categorization ${item}:`, err);
    }
  }

  // Mark all items as processed, the AI might have skipped some
  for (const item of allItems) {
    try {
      markProcessed(item.name);
    } catch (err) {
      console.error(`Error marking item ${item.name} as processed:`, err);
    }
  }

  console.log("File organization complete.");
}
async function main() {
  // Run the process once immediately
  await processFiles();

  // Set up cron job to run every 10 minutes
  let running = false;
  const job = new CronJob("*/10 * * * *", async () => {
    if (running) {
      console.log("Process already running, skipping");
      return;
    }
    running = true;
    console.log("Running scheduled organization task...");
    try {
      await processFiles();
    } catch (err) {
      console.error("Error during organization task:", err);
    } finally {
      running = false;
    }
  });

  // Start the cron job
  job.start();

  console.log("File organizer is running. Press Ctrl+C to exit.");
}
main();
