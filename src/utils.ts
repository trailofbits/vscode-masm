import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Expand ~ to home directory and resolve relative paths.
 */
export function expandPath(input: string): string {
  if (input.startsWith("~")) {
    return path.join(os.homedir(), input.slice(1));
  }
  return path.resolve(input);
}

/**
 * Find an ancestor directory with a specific name.
 */
export function findAncestorNamed(
  startPath: string,
  dirName: string
): string | undefined {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;

  while (true) {
    if (path.basename(current) === dirName) {
      return current;
    }
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }

  return undefined;
}

/**
 * Try to infer the miden-vm root from the current workspace.
 */
export function inferMidenVmRootFromWorkspace(): string | undefined {
  const candidates: string[] = [];

  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (active) {
    candidates.push(active);
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    candidates.push(folder.uri.fsPath);
  }

  for (const candidate of candidates) {
    const root = findAncestorNamed(candidate, "miden-vm");
    if (root) return root;
  }

  return undefined;
}

/**
 * Resolve the stdlib path from settings, cache, or user input.
 */
export async function resolveStdlibPath(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("masm-lsp");
  const fromSettings = config.get<string>("stdlibPath");
  if (fromSettings && fromSettings.trim().length > 0) {
    return expandPath(fromSettings.trim());
  }

  const cached = context.globalState.get<string>("masmStdlibPath");
  if (cached && cached.trim().length > 0) {
    return expandPath(cached.trim());
  }

  const inferred = inferMidenVmRootFromWorkspace();
  if (inferred) {
    return inferred;
  }

  const entered = await vscode.window.showInputBox({
    title: "Miden stdlib location",
    prompt:
      "Enter the path to the miden-vm repository, or leave blank for an extension managed location.",
    placeHolder: "Path to the miden-vm repository",
    ignoreFocusOut: true,
    validateInput: (val) => {
      if (!val.trim()) return null;
      const exists = fs.existsSync(expandPath(val.trim()));
      return exists ? null : "Path does not exist";
    },
  });

  if (entered && entered.trim().length > 0) {
    const resolved = expandPath(entered.trim());
    await context.globalState.update("masmStdlibPath", resolved);
    return resolved;
  }

  return undefined;
}
