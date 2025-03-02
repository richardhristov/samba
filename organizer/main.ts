#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net
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
async function listRootItems(root: string) {
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
  targetDir: string;
  target: string;
  allowedRootFolders: string[];
}) {
  if (!REAL_RUN) {
    console.log(
      `Skipping symlink creation ${args.sourcePath} -> ${args.target} because REAL_RUN is false`,
    );
    return;
  }
  const rootFolder = path.dirname(args.target);
  if (!args.allowedRootFolders.includes(rootFolder)) {
    console.log(
      `Skipping ${args.target} because it's not in the allowed root folders`,
    );
    return;
  }
  // Create parent directories if they don't exist
  const targetPath = path.join(args.targetDir, args.target);
  await Deno.mkdir(args.targetDir, { recursive: true });
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
    console.error(`Error creating symlink ${targetPath}:`, err);
  }
}

// Define AI functions
const allowedRootFolders = [
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
2. Potential media type (anime, movies, tv shows, music, software, etc.)
3. Any identifiable genres, artists, or series

Organize only into the following root folders:
${JSON.stringify(allowedRootFolders)}

For files, the target path does not include the name of the file.
Be creative but logical in your categorization.
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
        "The target paths where the source item should be linked to, e.g. 'Movies/Nichijou' or 'Anime/Nichijou'. For files, the target path does not include the name of the file.",
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
  return object;
}

// Main function to process files and create symlinks
async function processFiles(): Promise<void> {
  console.log("Starting file organization process...");

  // TODO clean dead links and empty folders from target

  // Get root items
  const allItems = await listRootItems(SOURCE_DIR);

  // Filter out already processed items
  const unprocessedItems = allItems.filter((item) => !isProcessed(item.name));

  if (unprocessedItems.length === 0) {
    console.log("No new items to process.");
    return;
  }

  console.log(`Found ${unprocessedItems.length} new items to process.`);
  if (!REAL_RUN) {
    console.log(unprocessedItems);
  }

  // Categorize items with AI
  const categorizations = await categorizeItems({
    prompt,
    items: unprocessedItems,
    model: MODEL,
  });

  // Create symlinks based on AI categorization
  for (const item of categorizations) {
    for (const target of item.targets) {
      const sourcePath = path.join(SOURCE_DIR, item.source.name);
      await createSymlink({
        sourcePath,
        targetDir: TARGET_DIR,
        target: item.source.type === "folder"
          ? target
          : path.join(target, item.source.name),
        allowedRootFolders,
      });
    }
    // Mark as processed
    markProcessed(item.source.name);
  }

  console.log("File organization complete.");
}

// Run the process once immediately
await processFiles();

// Set up cron job to run every 10 minutes
const job = new CronJob("*/10 * * * *", async () => {
  console.log("Running scheduled organization task...");
  await processFiles();
});

// Start the cron job
job.start();

console.log("File organizer is running. Press Ctrl+C to exit.");
