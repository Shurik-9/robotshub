import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

const chromiumCandidates = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
];

function isExecutable(filePath) {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveChromiumPath(env = process.env) {
  if (env.CHROMIUM_PATH !== undefined) {
    const configuredPath = env.CHROMIUM_PATH.trim();
    if (configuredPath && isExecutable(configuredPath)) return configuredPath;
    throw new Error(
      `CHROMIUM_PATH is set but does not point to an executable browser: ${env.CHROMIUM_PATH}`,
    );
  }

  for (const directory of (env.PATH ?? "").split(delimiter)) {
    for (const candidate of chromiumCandidates) {
      const candidatePath = join(directory, candidate);
      if (isExecutable(candidatePath)) return candidatePath;
    }
  }

  throw new Error(
    `Chromium was not found on PATH. Install Chromium/Google Chrome or set CHROMIUM_PATH to its executable.`,
  );
}