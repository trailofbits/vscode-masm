# MASM VS Code Extension

VS Code client for the Miden assembly language (MASM) powered by the `masm-lsp` language server.

## Features
- LSP: diagnostics, go-to-definition, references, and more via `masm-lsp`.

## Requirements
- `masm-lsp` binary available on your `PATH` (or configure `masm-lsp.serverPath`).
- Node.js 18+ for running/building the extension.

## Development
```bash
cd vscode-masm
npm install
npm run compile
```

Open this folder in VS Code and run the "Launch Extension" task (F5). The extension activates for `.masm` files.

### Configuration
- `masm-lsp.serverPath`: absolute path or command name for the LSP binary (defaults to `masm-lsp`).
- `masm-lsp.trace.server`: LSP trace level (`off`, `messages`, `verbose`).
- `masm-lsp.stdlibPath`: path to the `miden-vm` repository containing the MASM stdlib. If omitted, the extension will try to infer it from the current workspace; if it cannot, it will prompt once. Leaving it blank lets the server auto-clone a temporary copy.
