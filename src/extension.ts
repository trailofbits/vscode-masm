import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  Trace,
} from "vscode-languageclient/node";
import {
  TreeSitterSemanticTokensProvider,
  legend,
} from "./treeSitterHighlighter";

let client: LanguageClient | undefined;
let semanticTokensProvider: TreeSitterSemanticTokensProvider | undefined;

async function startClient(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("masm-lsp");
  const serverCommand = config.get<string>("serverPath", "masm-lsp");
  const trace = config.get<string>("trace.server", "off");
  const stdlibPath = await resolveStdlibPath(context);

  const outputChannel = vscode.window.createOutputChannel("MASM LSP");

  const serverOptions: ServerOptions = {
    command: serverCommand,
    args: stdlibPath ? ["--stdlib-path", stdlibPath] : [],
    options: {
      env: process.env,
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "masm" }],
    outputChannel,
    traceOutputChannel: outputChannel,
    middleware: {
      provideInlayHints: async (document, range, token, next) => {
        const hints = await next(document, range, token);
        if (!hints || hints.length === 0) {
          return hints;
        }

        const config = vscode.workspace.getConfiguration("masm-lsp");
        const alignColumn = config.get<number>("inlayHints.alignPosition", 40);
        const minPadding = config.get<number>("inlayHints.minimumPadding", 2);

        for (const hint of hints) {
          const pos = hint.position;
          const line = document.lineAt(pos.line);
          const lineLength = line.text.length;

          let spacesNeeded: number;
          if (alignColumn > 0 && lineLength < alignColumn) {
            // Align to target column
            spacesNeeded = alignColumn - lineLength;
          } else {
            // Use minimum padding
            spacesNeeded = minPadding;
          }

          if (spacesNeeded > 0) {
            const padding = " ".repeat(spacesNeeded);
            if (typeof hint.label === "string") {
              hint.label = padding + hint.label;
            } else if (Array.isArray(hint.label) && hint.label.length > 0) {
              hint.label[0].value = padding + hint.label[0].value;
            }
          }

          hint.paddingLeft = false;
          hint.paddingRight = false;
        }

        return hints;
      },
    },
  };

  const newClient = new LanguageClient(
    "masm-lsp",
    "MASM Language Server",
    serverOptions,
    clientOptions
  );

  if (trace === "verbose") {
    newClient.setTrace(Trace.Verbose);
  } else if (trace === "messages") {
    newClient.setTrace(Trace.Messages);
  } else {
    newClient.setTrace(Trace.Off);
  }

  try {
    await newClient.start();
    client = newClient;
    context.subscriptions.push(newClient, outputChannel);
  } catch (err) {
    const friendly =
      'MASM LSP failed to start. Verify "masm-lsp.serverPath" points to the masm-lsp binary (or add it to PATH).';
    outputChannel.appendLine(`Failed to start masm-lsp: ${String(err)}`);
    vscode.window.showErrorMessage(friendly);
    await newClient.dispose().catch(() => undefined);
    context.subscriptions.push(outputChannel);
  }
}

async function stopClient() {
  if (!client) return;
  const current = client;
  client = undefined;
  await current.stop();
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("[MASM] Activating MASM extension");

  // Register tree-sitter based semantic token provider
  semanticTokensProvider = new TreeSitterSemanticTokensProvider(
    context.extensionPath
  );

  const disposable = vscode.languages.registerDocumentSemanticTokensProvider(
    { language: "masm" },
    semanticTokensProvider,
    legend
  );
  console.log("[MASM] Semantic tokens provider registered");
  context.subscriptions.push(disposable);

  // Register commands first (before starting LSP client which may fail)
  context.subscriptions.push(
    vscode.commands.registerCommand("masm.restartServer", async () => {
      await stopClient();
      await startClient(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.toggleInlayHints", async () => {
      const config = vscode.workspace.getConfiguration("editor", {
        languageId: "masm",
      });
      const currentValue = config.get<string>("inlayHints.enabled", "on");
      const newValue = currentValue === "off" ? "on" : "off";
      await config.update(
        "inlayHints.enabled",
        newValue,
        vscode.ConfigurationTarget.Global,
        true // overrideInLanguage
      );
      const status = newValue === "on" ? "enabled" : "disabled";
      vscode.window.showInformationMessage(`MASM inlay hints ${status}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.setInlayHintsPosition", async () => {
      const config = vscode.workspace.getConfiguration("masm-lsp");
      const currentValue = config.get<number>("inlayHints.alignPosition", 40);
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
          "inlayHints.alignPosition",
          newValue,
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage(
          `MASM inlay hints position set to ${newValue}`
        );
      }
    })
  );

  // Start the language server client (may fail if masm-lsp is not available)
  await startClient(context);
}

export async function deactivate(): Promise<void> {
  semanticTokensProvider?.dispose();
  await stopClient();
}

async function resolveStdlibPath(
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

function expandPath(input: string): string {
  if (input.startsWith("~")) {
    return path.join(os.homedir(), input.slice(1));
  }
  return path.resolve(input);
}

function inferMidenVmRootFromWorkspace(): string | undefined {
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

function findAncestorNamed(
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
