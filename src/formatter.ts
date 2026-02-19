import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { resolveExecutable } from "./executable";
import { discoverConfigFiles } from "./config";

type FormatResult =
  | { status: "formatted"; edits: vscode.TextEdit[] }
  | { status: "no-changes" }
  | { status: "not-matched" }
  | { status: "error"; message: string };

export class PhpCsFixerFormattingProvider
  implements vscode.DocumentFormattingEditProvider
{
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    const executable = resolveExecutable(document.uri);
    if (!executable) {
      vscode.window
        .showErrorMessage(
          "php-cs-fixer executable not found. Install it via Composer or configure the path.",
          "Open Settings",
        )
        .then((choice) => {
          if (choice === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "phpCsFixer.executablePath",
            );
          }
        });
      return [];
    }

    const configFiles = await discoverConfigFiles(document.uri);
    if (configFiles.length === 0) {
      this.outputChannel.appendLine(
        "No php-cs-fixer config files found. Running with default rules.",
      );
      const result = await this.formatWithConfig(
        document,
        executable,
        null,
        token,
      );
      return result.status === "formatted" ? result.edits : [];
    }

    this.outputChannel.appendLine(
      `Found ${configFiles.length} config file(s): ${configFiles.map((f) => path.basename(f)).join(", ")}`,
    );

    // Try each config with --path-mode=intersection.
    // We use --dry-run --diff first to check if the config matches the file
    // without modifying anything, then apply only the matching config.
    for (let i = 0; i < configFiles.length; i++) {
      if (token.isCancellationRequested) return [];

      const configFile = configFiles[i];
      const configName = path.basename(configFile);
      this.outputChannel.appendLine(
        `[${i + 1}/${configFiles.length}] Trying config: ${configName}`,
      );

      const result = await this.formatWithConfig(
        document,
        executable,
        configFile,
        token,
      );

      switch (result.status) {
        case "formatted":
          this.outputChannel.appendLine(
            `  → Matched and formatted using: ${configName}`,
          );
          return result.edits;
        case "no-changes":
          this.outputChannel.appendLine(
            `  → Matched (already formatted): ${configName}`,
          );
          return [];
        case "not-matched":
          this.outputChannel.appendLine(
            `  → Not matched by Finder in: ${configName}`,
          );
          continue;
        case "error":
          this.outputChannel.appendLine(
            `  → Error: ${result.message}`,
          );
          continue;
      }
    }

    this.outputChannel.appendLine(
      "No config file matched this file path. No formatting applied.",
    );
    return [];
  }

  private async formatWithConfig(
    document: vscode.TextDocument,
    executable: { php: string; fixer: string },
    configFile: string | null,
    token: vscode.CancellationToken,
  ): Promise<FormatResult> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return { status: "error", message: "No workspace folder" };
    }

    const config = vscode.workspace.getConfiguration(
      "phpCsFixer",
      document.uri,
    );
    const timeout = config.get<number>("timeout") ?? 10000;
    const extraArgs = config.get<string[]>("extraArgs") ?? [];
    const filePath = document.uri.fsPath;
    let originalDiskContent: Buffer | null = null;

    try {
      try {
        originalDiskContent = fs.readFileSync(filePath);
      } catch {
        originalDiskContent = null;
      }

      const currentContent = document.getText();
      fs.writeFileSync(filePath, currentContent, "utf8");

      // Step 1: Dry-run to check if this config's Finder matches the file
      // and whether changes are needed.
      const dryRunArgs = [
        "fix",
        filePath,
        "--using-cache=no",
        "--dry-run",
        "--diff",
      ];

      if (configFile) {
        dryRunArgs.push(`--config=${configFile}`);
        dryRunArgs.push("--path-mode=intersection");
      }

      dryRunArgs.push(...extraArgs);

      const dryResult = await this.runFixer(
        executable,
        dryRunArgs,
        workspaceFolder.uri.fsPath,
        timeout,
        token,
      );

      // With --dry-run:
      // Exit code 0 = no changes needed. But we can't tell if the Finder matched.
      // Exit code 8 = changes would be applied (file matched and needs fixing).
      // php-cs-fixer uses bitmask exit codes: 8 = "changed" flag.

      const hasChanges = (dryResult.exitCode & 8) !== 0;
      const hasError = dryResult.exitCode >= 2 && !hasChanges;

      if (hasError) {
        return {
          status: "error",
          message: dryResult.stderr || `Exit code ${dryResult.exitCode}`,
        };
      }

      if (!hasChanges) {
        // Exit code 0: either Finder didn't match, or file is already formatted.
        // Check if the Finder matches by running list-files.
        const matched = await this.checkFinderMatch(
          executable,
          filePath,
          configFile,
          workspaceFolder.uri.fsPath,
          timeout,
          token,
        );

        return matched ? { status: "no-changes" } : { status: "not-matched" };
      }

      // Step 2: Actually apply the fix
      const fixArgs = ["fix", filePath, "--using-cache=no"];

      if (configFile) {
        fixArgs.push(`--config=${configFile}`);
        fixArgs.push("--path-mode=intersection");
      }

      fixArgs.push(...extraArgs);

      await this.runFixer(
        executable,
        fixArgs,
        workspaceFolder.uri.fsPath,
        timeout,
        token,
      );

      const formatted = fs.readFileSync(filePath, "utf8");
      if (formatted === currentContent) {
        return { status: "no-changes" };
      }

      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(currentContent.length),
      );
      return {
        status: "formatted",
        edits: [vscode.TextEdit.replace(fullRange, formatted)],
      };
    } finally {
      try {
        if (originalDiskContent !== null) {
          fs.writeFileSync(filePath, originalDiskContent);
        }
      } catch {
        // Best effort restore
      }
    }
  }

  private async checkFinderMatch(
    executable: { php: string; fixer: string },
    filePath: string,
    configFile: string | null,
    cwd: string,
    timeout: number,
    token: vscode.CancellationToken,
  ): Promise<boolean> {
    // Use php-cs-fixer to list files that would be processed.
    // If our file is in the list, the Finder matches.
    const args = [
      "list-files",
      `--config=${configFile}`,
    ];

    const result = await this.runFixer(executable, args, cwd, timeout, token);

    if (result.exitCode !== 0) {
      // Can't determine, assume not matched
      return false;
    }

    // list-files outputs relative paths (e.g. "./src/Foo.php")
    // Resolve them against cwd to compare with the absolute file path
    const normalizedTarget = path.normalize(filePath);
    const lines = result.stdout.split("\n");
    return lines.some((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      const absolute = path.resolve(cwd, trimmed);
      return path.normalize(absolute) === normalizedTarget;
    });
  }

  private runFixer(
    executable: { php: string; fixer: string },
    args: string[],
    cwd: string,
    timeout: number,
    token: vscode.CancellationToken,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const isBat =
        process.platform === "win32" && executable.fixer.endsWith(".bat");
      const cmd = isBat ? executable.fixer : executable.php;
      const fullArgs = isBat ? args : [executable.fixer, ...args];

      this.outputChannel.appendLine(`  $ ${cmd} ${fullArgs.join(" ")}`);

      const proc = execFile(
        cmd,
        fullArgs,
        { cwd, timeout, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const exitCode =
            error && "code" in error ? (error.code as number) : error ? 2 : 0;
          resolve({ exitCode, stdout, stderr });
        },
      );

      token.onCancellationRequested(() => {
        proc.kill();
      });
    });
  }
}
