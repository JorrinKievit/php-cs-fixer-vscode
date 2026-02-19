import * as vscode from "vscode";
import * as path from "path";

export async function discoverConfigFiles(
  documentUri: vscode.Uri,
): Promise<string[]> {
  const config = vscode.workspace.getConfiguration("phpCsFixer", documentUri);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);

  if (!workspaceFolder) {
    return [];
  }

  const root = workspaceFolder.uri.fsPath;

  // If explicit config files are set, use those
  const explicit = config.get<string[]>("configFiles");
  if (explicit && explicit.length > 0) {
    return explicit.map((f) =>
      path.isAbsolute(f) ? f : path.join(root, f),
    );
  }

  // Auto-discover using glob patterns
  const patterns = config.get<string[]>("autoDiscoverPatterns") ?? [
    ".php-cs-fixer.php",
    ".php-cs-fixer.dist.php",
    ".php-cs-fixer.*.php",
    ".php-cs-fixer.*.dist.php",
  ];

  const configFiles: string[] = [];

  for (const pattern of patterns) {
    const relativePattern = new vscode.RelativePattern(workspaceFolder, pattern);
    const files = await vscode.workspace.findFiles(relativePattern);
    for (const file of files) {
      if (!configFiles.includes(file.fsPath)) {
        configFiles.push(file.fsPath);
      }
    }
  }

  // Filter out disabled configs
  const disabled = config.get<string[]>("disabledConfigs") ?? [];
  const enabled = configFiles.filter(
    (f) => !disabled.includes(path.basename(f)),
  );

  // Sort for deterministic order: .php-cs-fixer.php first, then .dist.php, then others
  enabled.sort((a, b) => {
    const aBase = path.basename(a);
    const bBase = path.basename(b);
    const priority = (name: string) => {
      if (name === ".php-cs-fixer.php") return 0;
      if (name === ".php-cs-fixer.dist.php") return 1;
      return 2;
    };
    return priority(aBase) - priority(bBase);
  });

  return enabled;
}
