import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";

const projectFolder = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localBuild = process.argv.includes("--local");

const reportFolder = resolve(projectFolder, "etc");
const reportTempFolder = resolve(projectFolder, "temp");
mkdirSync(reportFolder, { recursive: true });
mkdirSync(reportTempFolder, { recursive: true });

// One report per published entry point (API Extractor is single-entry).
const entries = [
  { name: "distillate", dts: "dist/index.d.ts" },
  { name: "bloom", dts: "dist/bloom/index.d.ts" },
  { name: "blocked", dts: "dist/blocked/index.d.ts" },
  { name: "fuse", dts: "dist/fuse/index.d.ts" },
];

let failed = false;

for (const entry of entries) {
  const config = ExtractorConfig.prepare({
    configObjectFullPath: resolve(projectFolder, "api-extractor.json"),
    packageJsonFullPath: resolve(projectFolder, "package.json"),
    configObject: {
      projectFolder,
      mainEntryPointFilePath: resolve(projectFolder, entry.dts),
      compiler: { tsconfigFilePath: resolve(projectFolder, "tsconfig.json") },
      apiReport: {
        enabled: true,
        reportFileName: `${entry.name}.api.md`,
        reportFolder,
        reportTempFolder,
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        // The library ships no TSDoc release tags; the report is the contract.
        extractorMessageReporting: {
          "ae-missing-release-tag": { logLevel: "none" },
        },
      },
    },
  });

  const result = Extractor.invoke(config, {
    localBuild,
    showVerboseMessages: false,
  });

  if (!result.succeeded) failed = true;
}

if (failed) process.exit(1);
