import * as vscode from "vscode";
import { PhpCsFixerFormattingProvider } from "./formatter";

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("PHP CS Fixer");

  const formatter = new PhpCsFixerFormattingProvider(outputChannel);

  const registration =
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: "php", scheme: "file" },
      formatter,
    );

  context.subscriptions.push(registration, outputChannel);

  outputChannel.appendLine("PHP CS Fixer extension activated");
}

export function deactivate() {
  if (outputChannel) {
    outputChannel.dispose();
  }
}
