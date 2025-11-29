import * as vscode from "vscode";
import { startClient, stopClient, sendConfiguration, refreshDiagnostics } from "./client";
import {
  updateAllVisibleEditors,
  clearAllDecorations,
} from "./decorations";

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
}
