import * as vscode from "vscode";
import { startClient, stopClient, sendConfiguration } from "./client";
import {
  updateAllVisibleEditors,
  clearAllDecorations,
} from "./decorations";

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
    vscode.commands.registerCommand("masm.toggleInlayHints", async () => {
      const config = vscode.workspace.getConfiguration("masm-lsp");
      const currentType = config.get<string>(
        "inlayHints.type",
        "decompilation"
      );

      // Toggle between none and decompilation
      const nextType = currentType === "none" ? "decompilation" : "none";

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

      const status = nextType === "none" ? "disabled" : "enabled";
      vscode.window.showInformationMessage(`MASM inlay hints ${status}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.setInlayHintsPosition", async () => {
      const config = vscode.workspace.getConfiguration("masm-lsp");
      const currentValue = config.get<number>("inlayHints.position", 40);
      const input = await vscode.window.showInputBox({
        title: "Set Inlay Hints Position",
        prompt: "Enter the position of the inlay hints (in characters).",
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
          `MASM inlay hints position set to ${newValue}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "masm.toggleInlayHintDescriptions",
      async () => {
        try {
          console.log("[MASM] Toggle inlay hint type started");
          const config = vscode.workspace.getConfiguration("masm-lsp");
          const currentType = config.get<string>(
            "inlayHints.type",
            "decompilation"
          );

          // Toggle between decompilation and description
          const nextType =
            currentType === "description" ? "decompilation" : "description";
          console.log(`[MASM] Switching from ${currentType} to ${nextType}`);

          await config.update(
            "inlayHints.type",
            nextType,
            vscode.ConfigurationTarget.Global
          );
          console.log("[MASM] Config updated");

          // Manually send configuration to ensure server receives it
          await sendConfiguration();
          console.log("[MASM] Configuration sent to server");

          // Refresh decorations with new hint type
          await updateAllVisibleEditors();
          console.log("[MASM] Decorations updated");

          vscode.window.showInformationMessage(
            `MASM inlay hints now showing ${nextType}`
          );
        } catch (err) {
          console.error("[MASM] Toggle inlay hint type failed:", err);
          vscode.window.showErrorMessage(
            `Failed to toggle inlay hint type: ${err}`
          );
        }
      }
    )
  );
}
