import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  Trace,
} from "vscode-languageclient/node";
import { commandExists, cargoExists, installMasmLsp } from "./installation";
import { resolveStdlibPath } from "./utils";

let client: LanguageClient | undefined;

/**
 * Get the current LSP client instance.
 */
export function getClient(): LanguageClient | undefined {
  return client;
}

/**
 * Start the LSP client, prompting for installation if necessary.
 */
export async function startClient(
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("masm-lsp");
  let serverCommand = config.get<string>("serverPath", "masm-lsp");
  const trace = config.get<string>("trace.server", "off");

  const outputChannel = vscode.window.createOutputChannel("MASM LSP");

  // Check if the masm-lsp binary exists
  if (!commandExists(serverCommand)) {
    outputChannel.appendLine(`masm-lsp binary not found at: ${serverCommand}`);

    // Check if cargo is available for installation
    if (!cargoExists()) {
      const msg =
        "masm-lsp binary not found and cargo is not available. Please install masm-lsp manually or install Rust/Cargo first.";
      outputChannel.appendLine(msg);
      vscode.window.showErrorMessage(msg);
      context.subscriptions.push(outputChannel);
      return;
    }

    // Prompt user to install
    const choice = await vscode.window.showWarningMessage(
      "masm-lsp binary not found. Would you like to install it using cargo?",
      "Install",
      "Cancel"
    );

    if (choice !== "Install") {
      outputChannel.appendLine("User declined to install masm-lsp");
      context.subscriptions.push(outputChannel);
      return;
    }

    const installed = await installMasmLsp(outputChannel);
    if (!installed) {
      vscode.window.showErrorMessage(
        "Failed to install masm-lsp. Check the output channel for details."
      );
      context.subscriptions.push(outputChannel);
      return;
    }

    vscode.window.showInformationMessage("masm-lsp installed successfully!");

    // After installation, the binary should be in ~/.cargo/bin/masm-lsp
    // If the user had a custom path configured that didn't exist, use the default
    if (!commandExists(serverCommand)) {
      serverCommand = "masm-lsp";
    }
  }

  const stdlibPath = await resolveStdlibPath(context);

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
    synchronize: {
      configurationSection: "masm-lsp",
    },
    middleware: {
      // Suppress native inlay hints - we render them as decorations instead
      provideInlayHints: async () => [],
      // Filter out decompilation warnings when decompilation is not active
      handleDiagnostics: (uri, diagnostics, next) => {
        const config = vscode.workspace.getConfiguration("masm-lsp");
        const hintType = config.get<string>("inlayHints.type", "none");

        if (hintType !== "decompilation") {
          // Filter out decompilation failure warnings
          diagnostics = diagnostics.filter(
            (d) => d.source !== "masm-lsp/decompilation"
          );
        }

        next(uri, diagnostics);
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

/**
 * Stop the LSP client.
 */
export async function stopClient(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  await current.stop();
}

/**
 * Send configuration to the LSP server.
 */
export async function sendConfiguration(): Promise<void> {
  if (!client) {
    console.log("[MASM] sendConfiguration: no client");
    return;
  }

  const config = vscode.workspace.getConfiguration("masm-lsp");
  const hintType = config.get<string>("inlayHints.type", "none");
  console.log(`[MASM] sendConfiguration: sending type=${hintType}`);

  const settings = {
    masm: {
      inlayHints: {
        type: hintType,
      },
    },
  };

  await client.sendNotification("workspace/didChangeConfiguration", {
    settings,
  });
}

/**
 * Refresh diagnostics for all open MASM documents.
 * This triggers the server to re-publish diagnostics, which will be filtered by the middleware.
 */
export async function refreshDiagnostics(): Promise<void> {
  if (!client) return;

  // Touch all open MASM documents to trigger diagnostic refresh
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === "masm") {
      // Send a no-op change notification to trigger diagnostics refresh
      await client.sendNotification("textDocument/didChange", {
        textDocument: {
          uri: document.uri.toString(),
          version: document.version,
        },
        contentChanges: [],
      });
    }
  }
}
