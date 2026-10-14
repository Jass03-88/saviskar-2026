import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { EVENT_RULEBOOKS } from "../lib/events/rulebooks.ts";

async function syncRulebooks() {
  const startTime = Date.now();
  console.log("🚀 Starting Rulebook Sync...\n");

  const projectRoot = process.cwd();
  const rulebooksDir = path.join(projectRoot, "public", "rulebooks");
  const eventsDir = path.join(rulebooksDir, "events");

  if (!fs.existsSync(eventsDir)) {
    fs.mkdirSync(eventsDir, { recursive: true });
  }

  const masterPdfPaths = {
    cultural: path.join(rulebooksDir, "saviskar-2026-cultural-rulebook.pdf"),
    "non-technical": path.join(rulebooksDir, "saviskar-2026-non-technical-rulebook.pdf"),
    technical: path.join(rulebooksDir, "saviskar-2026-technical-rulebook.pdf"),
  };

  const loadedDocs = {};

  for (const [realm, filePath] of Object.entries(masterPdfPaths)) {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Master rulebook for "${realm}" not found at ${filePath}`);
      process.exit(1);
    }
    const bytes = fs.readFileSync(filePath);
    loadedDocs[realm] = await PDFDocument.load(bytes);
    console.log(`📖 Loaded ${realm} master rulebook (${loadedDocs[realm].getPageCount()} pages)`);
  }

  console.log("\n✂️  Slicing individual event rulebooks...");

  const events = Object.values(EVENT_RULEBOOKS);
  let count = 0;

  for (const event of events) {
    const srcDoc = loadedDocs[event.category];
    if (!srcDoc) {
      console.warn(`⚠️ Unknown category ${event.category} for event ${event.slug}`);
      continue;
    }

    const totalSrcPages = srcDoc.getPageCount();
    if (event.startPage > totalSrcPages || event.endPage > totalSrcPages) {
      console.error(
        `❌ Page range [${event.startPage}-${event.endPage}] exceeds master document page count (${totalSrcPages}) for ${event.slug}`
      );
      continue;
    }

    const subDoc = await PDFDocument.create();
    // 1-indexed to 0-indexed page indices
    const pageIndices = [];
    for (let p = event.startPage; p <= event.endPage; p++) {
      pageIndices.push(p - 1);
    }

    const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
    for (const page of copiedPages) {
      subDoc.addPage(page);
    }

    const pdfBytes = await subDoc.save();
    const destPath = path.join(eventsDir, `${event.slug}.pdf`);
    fs.writeFileSync(destPath, pdfBytes);
    count++;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Successfully synced and updated ${count}/${events.length} individual event PDFs in ${duration}s!`);
  console.log(`📁 Destination: public/rulebooks/events/`);
}

syncRulebooks().catch((err) => {
  console.error("❌ Rulebook sync failed:", err);
  process.exit(1);
});
