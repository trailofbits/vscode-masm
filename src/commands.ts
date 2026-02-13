import * as fs from "fs";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { startClient, stopClient, sendConfiguration, refreshDiagnostics, getClient } from "./client";
import {
  updateAllVisibleEditors,
  clearAllDecorations,
} from "./decorations";
import { refreshCodeLenses } from "./codelens";
import { expandPath } from "./utils";

interface DecompileResult {
  uri: string;
  procedure: {
    name: string;
    path: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  };
  decompiled: string;
}

interface DecompileFileResult {
  uri: string;
  modulePath: string;
  useStatements: string[];
  status: "success" | "partial" | "failure";
  summary: {
    totalProcedures: number;
    decompiledProcedures: number;
    failedProcedures: number;
  };
  procedures: {
    name: string;
    path: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    decompiled: string;
  }[];
  failures: {
    name: string;
    path: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    code: string;
    message: string;
  }[];
}

/**
 * Call the LSP decompileProcedureAtCursor command for the current cursor position.
 */
async function decompileProcedureAtCursor(
  client: LanguageClient,
  editor: vscode.TextEditor
): Promise<DecompileResult | undefined> {
  const position = editor.selection.active;
  try {
    const result = await client.sendRequest<DecompileResult>("workspace/executeCommand", {
      command: "masm-lsp.decompileProcedureAtCursor",
      arguments: [{
        uri: editor.document.uri.toString(),
        position: { line: position.line, character: position.character },
      }],
    });
    return result;
  } catch (err: unknown) {
    console.error("[MASM] decompileProcedureAtCursor failed:", err);
    const rpcError = err as { code?: number; message?: string; data?: { diagnostic?: string } };
    const detail = rpcError.data?.diagnostic || rpcError.message;
    if (rpcError.code === -32600) {
      // InvalidRequest — cursor not inside a procedure
      vscode.window.showWarningMessage(detail || "Cursor is not inside a procedure");
    } else if (rpcError.code === -32603) {
      // InternalError — decompilation failed
      vscode.window.showErrorMessage(detail || "Decompilation failed");
    } else {
      vscode.window.showErrorMessage(detail || "Failed to decompile procedure");
    }
    return undefined;
  }
}

/**
 * Helper to toggle a specific inlay hint type on/off.
 * If the current type matches, turn it off (set to "none").
 * Otherwise, enable the specified type.
 */
async function toggleInlayHintType(targetType: "decompilation" | "description"): Promise<void> {
  const config = vscode.workspace.getConfiguration("masm-lsp");
  const currentType = config.get<string>("inlayHints.type", "none");

  const nextType = currentType === targetType ? "none" : targetType;

  await config.update(
    "inlayHints.type",
    nextType,
    vscode.ConfigurationTarget.Global
  );

  await sendConfiguration();

  if (nextType === "none") {
    clearAllDecorations();
  } else {
    await updateAllVisibleEditors();
  }

  // Refresh diagnostics to apply filtering based on new setting
  await refreshDiagnostics();

  const label = targetType === "decompilation" ? "Inline decompilation" : "Inline descriptions";
  const status = nextType === "none" ? "disabled" : "enabled";
  vscode.window.showInformationMessage(`${label} ${status}`);
}

/**
 * Register all extension commands.
 */
export function registerCommands(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("masm.restartServer", async () => {
      await stopClient();
      await startClient(context);
      await sendConfiguration();
      await updateAllVisibleEditors();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.toggleInlineDecompilation", async () => {
      await toggleInlayHintType("decompilation");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.toggleInlineDescriptions", async () => {
      await toggleInlayHintType("description");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.setInlineHintsPosition", async () => {
      const config = vscode.workspace.getConfiguration("masm-lsp");
      const currentValue = config.get<number>("inlayHints.position", 40);
      const input = await vscode.window.showInputBox({
        title: "Set Inline Hints Position",
        prompt: "Enter the column position for inline hints.",
        value: String(currentValue),
        validateInput: (val) => {
          const num = parseInt(val, 10);
          if (isNaN(num) || num < 0) {
            return "Please enter a non-negative integer";
          }
          return null;
        },
      });
      if (input !== undefined) {
        const newValue = parseInt(input, 10);
        await config.update(
          "inlayHints.position",
          newValue,
          vscode.ConfigurationTarget.Global
        );

        // Refresh decorations with new position
        await updateAllVisibleEditors();

        vscode.window.showInformationMessage(
          `Inline hints position set to column ${newValue}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.toggleStackEffects", async () => {
      const config = vscode.workspace.getConfiguration("masm-lsp");
      const currentValue = config.get<boolean>("codeLens.stackEffects", true);
      const nextValue = !currentValue;

      await config.update(
        "codeLens.stackEffects",
        nextValue,
        vscode.ConfigurationTarget.Global
      );

      await sendConfiguration();
      refreshCodeLenses();

      const status = nextValue ? "enabled" : "disabled";
      vscode.window.showInformationMessage(`Stack effects ${status}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.setStdlibRoot", async () => {
      const client = getClient();
      if (!client) {
        vscode.window.showWarningMessage("Language server not running");
        return;
      }

      const config = vscode.workspace.getConfiguration("masm-lsp");
      const currentPath = config.get<string>("stdlibPath", "");

      const input = await vscode.window.showInputBox({
        title: "Set Standard Library Path",
        prompt: "Enter the path to the miden-vm repository.",
        value: currentPath,
        validateInput: (val) => {
          if (!val.trim()) return null;
          const resolved = expandPath(val.trim());
          if (!fs.existsSync(resolved)) {
            return "Path does not exist";
          }
          return null;
        },
      });

      if (input === undefined) return;

      const stdlibPath = input.trim() || undefined;

      if (stdlibPath) {
        const resolved = expandPath(stdlibPath);
        await client.sendRequest("workspace/executeCommand", {
          command: "masm-lsp.setStdlibRoot",
          arguments: [resolved],
        });

        await config.update("stdlibPath", resolved, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Standard library path set to ${resolved}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.copyPseudocodeToClipboard", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }

      if (editor.document.languageId !== "masm") {
        vscode.window.showWarningMessage("Not a MASM file");
        return;
      }

      const client = getClient();
      if (!client) {
        vscode.window.showWarningMessage("Language server not running");
        return;
      }

      const result = await decompileProcedureAtCursor(client, editor);
      if (!result) return;

      await vscode.env.clipboard.writeText(result.decompiled);
      vscode.window.showInformationMessage("Copied pseudocode to clipboard");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.openPseudocodeInNewWindow", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }

      if (editor.document.languageId !== "masm") {
        vscode.window.showWarningMessage("Not a MASM file");
        return;
      }

      const client = getClient();
      if (!client) {
        vscode.window.showWarningMessage("Language server not running");
        return;
      }

      const masmPath = editor.document.uri.fsPath;
      const dmasmPath = masmPath.replace(/\.masm$/, ".dmasm");

      // If a .dmasm file already exists, just open it
      if (fs.existsSync(dmasmPath)) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(dmasmPath));
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
        return;
      }

      let result: DecompileFileResult;
      try {
        result = await client.sendRequest<DecompileFileResult>("workspace/executeCommand", {
          command: "masm-lsp.decompileFile",
          arguments: [{ uri: editor.document.uri.toString() }],
        });
      } catch (err: unknown) {
        console.error("[MASM] decompileFile failed:", err);
        const rpcError = err as { message?: string };
        vscode.window.showErrorMessage(rpcError.message || "Failed to decompile file");
        return;
      }

      if (result.status === "failure") {
        const names = result.failures.map((f) => f.name).join(", ");
        vscode.window.showErrorMessage(`Failed to decompile: ${names}`);
        return;
      }

      if (result.status === "partial") {
        const { decompiledProcedures, totalProcedures } = result.summary;
        vscode.window.showWarningMessage(
          `Decompiled ${decompiledProcedures} of ${totalProcedures} procedures`
        );
      }

      const parts: string[] = [];
      if (result.useStatements.length > 0) {
        parts.push(result.useStatements.join("\n") + "\n");
      }
      parts.push(
        ...result.procedures.map((proc) => proc.decompiled)
      );
      const content = parts.join("\n\n");

      // Open as an untitled document bound to the .dmasm path.
      // The file is not written to disk until the user explicitly saves.
      const untitledUri = vscode.Uri.from({ scheme: "untitled", path: dmasmPath });
      const doc = await vscode.workspace.openTextDocument(untitledUri);
      const newEditor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
      });
      await newEditor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), content);
      });
      await vscode.languages.setTextDocumentLanguage(doc, "dmasm");
    })
  );
}
