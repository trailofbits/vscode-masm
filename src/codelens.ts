import * as vscode from "vscode";
import { getClient } from "./client";
import { CodeLensRequest } from "vscode-languageclient";

let codeLensProvider: vscode.Disposable | undefined;

/**
 * Check if stack effects code lenses are enabled.
 */
export function isStackEffectsEnabled(): boolean {
  const config = vscode.workspace.getConfiguration("masm-lsp");
  return config.get<boolean>("codeLens.stackEffects", true);
}

/**
 * Code lens provider that requests stack effects from the LSP server.
 */
class StackEffectsCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  /**
   * Trigger a refresh of code lenses.
   */
  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (!isStackEffectsEnabled()) {
      return [];
    }

    const client = getClient();
    if (!client) {
      return [];
    }

    try {
      const result = await client.sendRequest(CodeLensRequest.type, {
        textDocument: { uri: document.uri.toString() },
      });

      if (!result) {
        return [];
      }

      // Convert LSP code lenses to VS Code code lenses
      return result.map((lens) => {
        const range = new vscode.Range(
          lens.range.start.line,
          lens.range.start.character,
          lens.range.end.line,
          lens.range.end.character
        );

        const command = lens.command
          ? { title: lens.command.title, command: lens.command.command ?? "" }
          : undefined;

        return new vscode.CodeLens(range, command);
      });
    } catch (err) {
      console.error("[MASM] Failed to fetch code lenses:", err);
      return [];
    }
  }
}

let provider: StackEffectsCodeLensProvider | undefined;

/**
 * Register the code lens provider for MASM files.
 */
export function registerCodeLensProvider(
  context: vscode.ExtensionContext
): void {
  provider = new StackEffectsCodeLensProvider();
  codeLensProvider = vscode.languages.registerCodeLensProvider(
    { language: "masm", scheme: "file" },
    provider
  );
  context.subscriptions.push(codeLensProvider);
}

/**
 * Refresh code lenses in all visible MASM editors.
 */
export function refreshCodeLenses(): void {
  if (provider) {
    provider.refresh();
  }
}
