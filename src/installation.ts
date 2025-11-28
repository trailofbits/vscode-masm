import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export const MASM_LSP_REPO = "https://github.com/trailofbits/masm-lsp";

/**
 * Check if a command exists in PATH or at an absolute path.
 */
export function commandExists(command: string): boolean {
  // If it's an absolute path, check if file exists
  if (path.isAbsolute(command)) {
    return fs.existsSync(command);
  }

  // Check in PATH using `which` (Unix) or `where` (Windows)
  const whichCmd = process.platform === "win32" ? "where" : "which";
  try {
    cp.execSync(`${whichCmd} ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if cargo is available.
 */
export function cargoExists(): boolean {
  return commandExists("cargo");
}

/**
 * Install masm-lsp using cargo.
 */
export async function installMasmLsp(
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing masm-lsp",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Running cargo install..." });
      outputChannel.appendLine(`Installing masm-lsp from ${MASM_LSP_REPO}`);
      outputChannel.show();

      return new Promise<boolean>((resolve) => {
        const child = cp.spawn(
          "cargo",
          ["install", "--git", MASM_LSP_REPO],
          {
            shell: true,
            env: process.env,
          }
        );

        child.stdout?.on("data", (data) => {
          outputChannel.append(data.toString());
        });

        child.stderr?.on("data", (data) => {
          outputChannel.append(data.toString());
        });

        child.on("close", (code) => {
          if (code === 0) {
            outputChannel.appendLine("masm-lsp installed successfully!");
            resolve(true);
          } else {
            outputChannel.appendLine(`cargo install failed with code ${code}`);
            resolve(false);
          }
        });

        child.on("error", (err) => {
          outputChannel.appendLine(`Failed to run cargo: ${err.message}`);
          resolve(false);
        });
      });
    }
  );
}
