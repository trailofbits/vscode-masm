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

let client: LanguageClient | undefined;

// Decoration-based inlay hints state
let inlayHintsEnabled = true;
const decorationType = vscode.window.createTextEditorDecorationType({});
const documentDecorations = new Map<string, vscode.DecorationOptions[]>();

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
      // Suppress native inlay hints - we render them as decorations instead
      provideInlayHints: async () => [],
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

// Fetch inlay hints from LSP and convert to decorations
async function updateInlayHintDecorations(editor: vscode.TextEditor) {
  if (!client || !inlayHintsEnabled) {
    editor.setDecorations(decorationType, []);
    return;
  }

  const document = editor.document;
  if (document.languageId !== "masm") {
    return;
  }

  try {
    const range = new vscode.Range(
      0,
      0,
      document.lineCount - 1,
      document.lineAt(document.lineCount - 1).text.length
    );

    // Request inlay hints from the LSP server
    const hints = await client.sendRequest<vscode.InlayHint[] | null>(
      "textDocument/inlayHint",
      {
        textDocument: { uri: document.uri.toString() },
        range: {
          start: { line: range.start.line, character: range.start.character },
          end: { line: range.end.line, character: range.end.character },
        },
      }
    );

    if (!hints || hints.length === 0) {
      editor.setDecorations(decorationType, []);
      documentDecorations.set(document.uri.toString(), []);
      return;
    }

    const config = vscode.workspace.getConfiguration("masm-lsp");
    const alignColumn = config.get<number>("inlayHints.position", 40);
    const minPadding = config.get<number>("inlayHints.minimumPadding", 2);

    // Group hints by line number, preserving order
    const hintsByLine = new Map<number, string[]>();
    for (const hint of hints) {
      const lineNum = (hint.position as { line: number }).line;

      let labelText: string;
      if (typeof hint.label === "string") {
        labelText = hint.label;
      } else if (Array.isArray(hint.label) && hint.label.length > 0) {
        labelText = hint.label.map((part: { value: string }) => part.value).join("");
      } else {
        continue;
      }

      const existing = hintsByLine.get(lineNum) || [];
      existing.push(labelText);
      hintsByLine.set(lineNum, existing);
    }

    const decorations: vscode.DecorationOptions[] = [];

    for (const [lineNum, labelTexts] of hintsByLine) {
      const line = document.lineAt(lineNum);
      const lineLength = line.text.length;

      // Calculate margin for alignment
      let marginChars: number;
      if (alignColumn > 0 && lineLength < alignColumn) {
        marginChars = alignColumn - lineLength;
      } else {
        marginChars = minPadding;
      }

      // Concatenate multiple hints as sentences, prefixed with # to look like a comment
      const combinedText = "# " + labelTexts.join(" ");

      const decoration: vscode.DecorationOptions = {
        range: new vscode.Range(lineNum, lineLength, lineNum, lineLength),
        renderOptions: {
          after: {
            contentText: combinedText,
            color: new vscode.ThemeColor("editorInlayHint.foreground"),
            backgroundColor: "transparent",
            fontStyle: "normal",
            margin: `0 0 0 ${marginChars}ch`,
          },
        },
      };

      decorations.push(decoration);
    }

    editor.setDecorations(decorationType, decorations);
    documentDecorations.set(document.uri.toString(), decorations);
  } catch (err) {
    console.error("[MASM] Failed to fetch inlay hints:", err);
    editor.setDecorations(decorationType, []);
  }
}

// Update decorations for all visible MASM editors
async function updateAllVisibleEditors() {
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.languageId === "masm") {
      await updateInlayHintDecorations(editor);
    }
  }
}

// Clear all decorations
function clearAllDecorations() {
  for (const editor of vscode.window.visibleTextEditors) {
    editor.setDecorations(decorationType, []);
  }
  documentDecorations.clear();
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("[MASM] Activating MASM extension");

  // Register commands first (before starting LSP client which may fail)
  context.subscriptions.push(
    vscode.commands.registerCommand("masm.restartServer", async () => {
      await stopClient();
      await startClient(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("masm.toggleInlayHints", async () => {
      inlayHintsEnabled = !inlayHintsEnabled;
      if (inlayHintsEnabled) {
        await updateAllVisibleEditors();
      } else {
        clearAllDecorations();
      }
      const status = inlayHintsEnabled ? "enabled" : "disabled";
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
      documentDecorations.delete(document.uri.toString());
    })
  );

  // Start the language server client (may fail if masm-lsp is not available)
  await startClient(context);

  // Initial update for any already-open MASM editors
  await updateAllVisibleEditors();
}

export async function deactivate(): Promise<void> {
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
