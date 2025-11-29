# MASM VS Code Extension

VS Code LSP client for the Miden assembly language (MASM) powered by the [`masm-lsp`](https://github.com/trailofbits/masm-lsp) language server.

## Features

The extension provides:

- Syntax highlighting for `.masm` files.
- Goto symbol definitions and references.
- Procedure documentation on hover.
  <div style="margin:1em">
    <img src="assets/hover_documentation.png" alt="Hover documentation example" height="250" />
  </div>
- Inline descriptions for all MASM instructions.
  <div style="margin:1em">
    <img src="assets/inline_descriptions.png" alt="Inlay hints example" height="250" />
  </div>
- Best-effort inline decompilation of procedures.
  <div style="margin:1em">
    <img src="assets/inline_decompilation.png" alt="Inline decompilation example" height="250" />
  </div>
- Diagnostics for inconsistent stack effects and unvalidated advice use.

## Commands

The extension provides the following commands (accessible via the Command Palette):

| Command                               | Description                                |
| ------------------------------------- | ------------------------------------------ |
| `MASM: Restart Language Server`       | Restart the LSP server                     |
| `MASM: Toggle Inline Decompilation`   | Enable or disable inline decompilation     |
| `MASM: Toggle Inline Descriptions`    | Enable or disable inline descriptions      |
| `MASM: Set Inline Hints Position`     | Set the column to align inline hints to    |

## Requirements

- `masm-lsp` binary available on your `PATH` (or configure `masm-lsp.serverPath`).
- Node.js 18+ for running/building the extension.

## Development

To build and package the extension, run the following commands:

```bash
cd vscode-masm
npm install      # To install dependencies
npm run compile  # To compile the extension
npm run package  # To package the extension into a .vsix file
```

The resulting `.vsix` file can be installed in VS Code via the "Extensions: Install from VSIX" command.

### Configuration

- `masm-lsp.serverPath`: absolute path or command name for the LSP binary (defaults to `masm-lsp`).
- `masm-lsp.trace.server`: LSP trace level (`off`, `messages`, `verbose`).
- `masm-lsp.stdlibPath`: path to the `miden-vm` repository containing the MASM stdlib. If omitted, the extension will try to infer it from the current workspace; if it cannot, it will prompt once. Leaving it blank lets the server auto-clone a temporary copy.
- `masm-lsp.inlayHints.position`: column to align inlay hints to. If 0, hints use minimum padding only. If the line extends past this column, minimum padding is used instead.
- `masm-lsp.inlayHints.minimumPadding`: minimum number of spaces between source code and inlay hints.
