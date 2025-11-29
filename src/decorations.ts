import * as vscode from "vscode";
import { getClient } from "./client";

const decorationType = vscode.window.createTextEditorDecorationType({});
const documentDecorations = new Map<string, vscode.DecorationOptions[]>();

/**
 * Fetch inlay hints from LSP and convert to decorations.
 */
export async function updateInlayHintDecorations(
  editor: vscode.TextEditor
): Promise<void> {
  const config = vscode.workspace.getConfiguration("masm-lsp");
  const hintType = config.get<string>("inlayHints.type", "none");
  const client = getClient();

  if (!client || hintType === "none") {
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
    const requestStart = performance.now();
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
    const requestEnd = performance.now();
    console.log(
      `[MASM] Inlay hints request took ${(requestEnd - requestStart).toFixed(1)}ms (${hints?.length ?? 0} hints)`
    );

    if (!hints || hints.length === 0) {
      editor.setDecorations(decorationType, []);
      documentDecorations.set(document.uri.toString(), []);
      return;
    }

    const processingStart = performance.now();
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
        labelText = hint.label
          .map((part: { value: string }) => part.value)
          .join("");
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

      // Extract leading whitespace from first hint
      const firstHint = labelTexts[0];
      const leadingMatch = firstHint.match(/^[\s\u00A0]*/);
      const leadingWhitespace = leadingMatch ? leadingMatch[0] : "";

      // Normalize all hints: convert all whitespace to regular spaces, collapse multiple spaces, trim
      const trimmedTexts = labelTexts.map((text) =>
        text.replace(/[\s\u00A0]+/g, " ").trim()
      );

      // Concatenate hints, prefixed with # and original indentation
      // Replace spaces with non-breaking spaces to preserve indentation in CSS rendering
      const combinedText = (
        "# " +
        leadingWhitespace +
        trimmedTexts.join(" ")
      ).replace(/ /g, "\u00A0");

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
    const processingEnd = performance.now();
    console.log(
      `[MASM] Decoration processing took ${(processingEnd - processingStart).toFixed(1)}ms (${decorations.length} lines)`
    );
  } catch (err) {
    console.error("[MASM] Failed to fetch inlay hints:", err);
    editor.setDecorations(decorationType, []);
  }
}

/**
 * Update decorations for all visible MASM editors.
 */
export async function updateAllVisibleEditors(): Promise<void> {
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.languageId === "masm") {
      await updateInlayHintDecorations(editor);
    }
  }
}

/**
 * Clear all decorations.
 */
export function clearAllDecorations(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    editor.setDecorations(decorationType, []);
  }
  documentDecorations.clear();
}

/**
 * Remove decorations for a closed document.
 */
export function removeDocumentDecorations(uri: string): void {
  documentDecorations.delete(uri);
}
