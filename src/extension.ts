import * as vscode from "vscode";
import { startClient, stopClient, sendConfiguration } from "./client";
import { registerCommands } from "./commands";
import {
  updateInlayHintDecorations,
  updateAllVisibleEditors,
  removeDocumentDecorations,
} from "./decorations";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log("[MASM] Activating MASM extension");

  // Register commands first (before starting LSP client which may fail)
  registerCommands(context);

  // Set up event listeners for decoration updates
  let updateTimeout: NodeJS.Timeout | undefined;
  const debouncedUpdate = (editor: vscode.TextEditor) => {
    if (updateTimeout) {
      clearTimeout(updateTimeout);
    }
    updateTimeout = setTimeout(() => {
      updateInlayHintDecorations(editor);
    }, 100);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === "masm") {
        updateInlayHintDecorations(editor);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        if (editor.document.languageId === "masm") {
          updateInlayHintDecorations(editor);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== "masm") {
        return;
      }
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document === event.document
      );
      if (editor) {
        debouncedUpdate(editor);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      removeDocumentDecorations(document.uri.toString());
    })
  );

  // Start the language server client (may fail if masm-lsp is not available)
  await startClient(context);

  // Send initial configuration to the server
  await sendConfiguration();

  // Initial update for any already-open MASM editors
  await updateAllVisibleEditors();
}

export async function deactivate(): Promise<void> {
  await stopClient();
}
