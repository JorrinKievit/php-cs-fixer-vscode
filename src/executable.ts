import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";

const VENDOR_BINARY = path.join("vendor", "bin", "php-cs-fixer");
const VENDOR_BINARY_WIN = path.join("vendor", "bin", "php-cs-fixer.bat");

export function resolveExecutable(
  documentUri: vscode.Uri,
): { php: string; fixer: string } | null {
  const config = vscode.workspace.getConfiguration("phpCsFixer", documentUri);
  const phpPath = config.get<string>("phpPath") || "php";

  const configuredPath = config.get<string>("executablePath");
  if (configuredPath) {
    const resolved = resolveConfiguredPath(configuredPath, documentUri);
    if (resolved) {
      return { php: phpPath, fixer: resolved };
    }
  }

  const vendorPath = findVendorBinary(documentUri);
  if (vendorPath) {
    return { php: phpPath, fixer: vendorPath };
  }

  const globalPath = findGlobalBinary();
  if (globalPath) {
    return { php: phpPath, fixer: globalPath };
  }

  return null;
}

function resolveConfiguredPath(
  configuredPath: string,
  documentUri: vscode.Uri,
): string | null {
  if (path.isAbsolute(configuredPath)) {
    return fs.existsSync(configuredPath) ? configuredPath : null;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (workspaceFolder) {
    const absolute = path.join(workspaceFolder.uri.fsPath, configuredPath);
    if (fs.existsSync(absolute)) {
      return absolute;
    }
  }

  return null;
}

function findVendorBinary(documentUri: vscode.Uri): string | null {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (!workspaceFolder) {
    return null;
  }

  const isWindows = process.platform === "win32";
  const candidates = isWindows
    ? [VENDOR_BINARY_WIN, VENDOR_BINARY]
    : [VENDOR_BINARY];

  // Walk up from file directory to workspace root looking for vendor/bin
  let dir = path.dirname(documentUri.fsPath);
  const root = workspaceFolder.uri.fsPath;

  while (dir.startsWith(root)) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Also check workspace root directly
  for (const candidate of candidates) {
    const fullPath = path.join(root, candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function findGlobalBinary(): string | null {
  // Check common global install locations
  const isWindows = process.platform === "win32";

  if (isWindows) {
    const appData = process.env.APPDATA;
    if (appData) {
      const composerGlobal = path.join(
        appData,
        "Composer",
        "vendor",
        "bin",
        "php-cs-fixer.bat",
      );
      if (fs.existsSync(composerGlobal)) return composerGlobal;
    }
  } else {
    const home = process.env.HOME;
    if (home) {
      const composerGlobal = path.join(
        home,
        ".composer",
        "vendor",
        "bin",
        "php-cs-fixer",
      );
      if (fs.existsSync(composerGlobal)) return composerGlobal;

      const configComposer = path.join(
        home,
        ".config",
        "composer",
        "vendor",
        "bin",
        "php-cs-fixer",
      );
      if (fs.existsSync(configComposer)) return configComposer;
    }
  }

  // Fall back to hoping it's in PATH — will fail at runtime if not
  return "php-cs-fixer";
}

export async function verifyExecutable(
  php: string,
  fixer: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const isPhpScript = fixer.endsWith(".php") || !fixer.endsWith(".bat");
    const cmd = isPhpScript && !fixer.endsWith(".bat") ? php : fixer;
    const args =
      isPhpScript && !fixer.endsWith(".bat")
        ? [fixer, "--version"]
        : ["--version"];

    execFile(cmd, args, { timeout: 5000 }, (error) => {
      resolve(!error);
    });
  });
}
