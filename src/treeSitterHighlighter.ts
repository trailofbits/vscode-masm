import * as vscode from "vscode";
import * as path from "path";
import { Parser, Language, Query, Tree, QueryCapture } from "web-tree-sitter";

// Mapping from tree-sitter capture names to VSCode semantic token types and modifiers
const captureToSemanticToken: Record<
  string,
  { type: string; modifiers?: string[] }
> = {
  "comment.doc": { type: "comment", modifiers: ["documentation"] },
  comment: { type: "comment" },
  keyword: { type: "keyword" },
  module: { type: "namespace" },
  constant: { type: "variable", modifiers: ["readonly", "declaration"] },
  function: { type: "function" },
  "function.method": { type: "method" },
  attribute: { type: "decorator" },
  property: { type: "property" },
  "string.special.symbol": { type: "string" },
  number: { type: "number" },
  string: { type: "string" },
  operator: { type: "operator" },
  "punctuation.delimiter": { type: "punctuation" },
  "punctuation.list_marker": { type: "punctuation" },
  "punctuation.bracket": { type: "punctuation" },
};

// Define semantic token legend
export const tokenTypes = [
  "comment",
  "keyword",
  "namespace",
  "variable",
  "function",
  "method",
  "decorator",
  "property",
  "string",
  "number",
  "operator",
  "punctuation",
];

export const tokenModifiers = ["documentation", "readonly", "declaration"];

export const legend = new vscode.SemanticTokensLegend(
  tokenTypes,
  tokenModifiers
);

export class TreeSitterSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider
{
  private parser: Parser | undefined;
  private query: Query | undefined;
  private trees: Map<string, Tree> = new Map();
  private initPromise: Promise<void>;

  constructor(private extensionPath: string) {
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Configure Parser.init with locateFile to find the tree-sitter.wasm
      const treeSitterWasmPath = path.join(
        this.extensionPath,
        "node_modules",
        "web-tree-sitter",
        "tree-sitter.wasm"
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await Parser.init({
        locateFile: () => treeSitterWasmPath,
      } as any);

      this.parser = new Parser();

      const wasmPath = path.join(
        this.extensionPath,
        "tree-sitter",
        "tree-sitter-masm.wasm"
      );
      const language = await Language.load(wasmPath);
      this.parser.setLanguage(language);

      const queryPath = path.join(
        this.extensionPath,
        "tree-sitter",
        "queries",
        "highlights.scm"
      );
      const queryContent = await vscode.workspace.fs.readFile(
        vscode.Uri.file(queryPath)
      );
      const queryString = Buffer.from(queryContent).toString("utf-8");
      this.query = new Query(language, queryString);
    } catch (error) {
      console.error(`[MASM] Tree-sitter initialization failed:`, error);
      throw error;
    }
  }

  async provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.SemanticTokens> {
    console.log(
      `[MASM] provideDocumentSemanticTokens called for: ${document.uri.toString()}`
    );

    await this.initPromise;

    if (!this.parser || !this.query) {
      return new vscode.SemanticTokens(new Uint32Array(0));
    }
    const text = document.getText();

    let tree: Tree | null;
    try {
      tree = this.parser.parse(text);
    } catch (e) {
      console.error(`[MASM] Parse failed:`, e);
      return new vscode.SemanticTokens(new Uint32Array(0));
    }

    if (!tree) {
      console.log(`[MASM] Failed to parse document`);
      return new vscode.SemanticTokens(new Uint32Array(0));
    }
    this.trees.set(document.uri.toString(), tree);

    let captures: QueryCapture[];
    try {
      captures = this.query.captures(tree.rootNode);
    } catch (e) {
      console.error(`[MASM] Query failed:`, e);
      return new vscode.SemanticTokens(new Uint32Array(0));
    }
    const builder = new vscode.SemanticTokensBuilder(legend);

    // Sort captures by position for correct ordering, then by specificity (smaller ranges first)
    captures.sort((a, b) => {
      const aStart = a.node.startPosition;
      const bStart = b.node.startPosition;
      if (aStart.row !== bStart.row) {
        return aStart.row - bStart.row;
      }
      if (aStart.column !== bStart.column) {
        return aStart.column - bStart.column;
      }
      // For same start position, prefer smaller (more specific) ranges
      const aLen = a.node.endIndex - a.node.startIndex;
      const bLen = b.node.endIndex - b.node.startIndex;
      return aLen - bLen;
    });

    // Track processed positions to avoid overlapping tokens
    // Store as array of {row, startCol, endCol} for overlap detection
    const processedPositions: Array<{
      row: number;
      startCol: number;
      endCol: number;
    }> = [];

    const isOverlapping = (
      row: number,
      startCol: number,
      endCol: number
    ): boolean => {
      for (const pos of processedPositions) {
        if (pos.row === row) {
          // Check for overlap on the same row
          if (startCol < pos.endCol && endCol > pos.startCol) {
            return true;
          }
        }
      }
      return false;
    };

    const markProcessed = (
      row: number,
      startCol: number,
      endCol: number
    ): void => {
      processedPositions.push({ row, startCol, endCol });
    };

    for (const capture of captures) {
      const tokenMapping = this.getTokenMapping(capture.name);
      if (!tokenMapping) {
        continue;
      }

      const { node } = capture;
      const startPos = node.startPosition;
      const endPos = node.endPosition;

      // Handle multi-line tokens
      if (startPos.row === endPos.row) {
        // Single line token
        const length = endPos.column - startPos.column;
        if (
          length > 0 &&
          !isOverlapping(startPos.row, startPos.column, endPos.column)
        ) {
          builder.push(
            startPos.row,
            startPos.column,
            length,
            tokenTypes.indexOf(tokenMapping.type),
            this.encodeModifiers(tokenMapping.modifiers)
          );
          markProcessed(startPos.row, startPos.column, endPos.column);
        }
      } else {
        // Multi-line token - push each line separately
        const lines = text.split("\n");
        for (let row = startPos.row; row <= endPos.row; row++) {
          const lineText = lines[row] || "";
          const startCol = row === startPos.row ? startPos.column : 0;
          const endCol = row === endPos.row ? endPos.column : lineText.length;
          const length = endCol - startCol;

          if (length > 0 && !isOverlapping(row, startCol, endCol)) {
            builder.push(
              row,
              startCol,
              length,
              tokenTypes.indexOf(tokenMapping.type),
              this.encodeModifiers(tokenMapping.modifiers)
            );
            markProcessed(row, startCol, endCol);
          }
        }
      }
    }

    return builder.build();
  }

  private getTokenMapping(
    captureName: string
  ): { type: string; modifiers?: string[] } | undefined {
    // Try exact match first
    if (captureToSemanticToken[captureName]) {
      return captureToSemanticToken[captureName];
    }

    // Try to match parent capture (e.g., "function.method" -> "function")
    const parts = captureName.split(".");
    for (let i = parts.length - 1; i >= 0; i--) {
      const partial = parts.slice(0, i + 1).join(".");
      if (captureToSemanticToken[partial]) {
        return captureToSemanticToken[partial];
      }
    }

    return undefined;
  }

  private encodeModifiers(modifiers?: string[]): number {
    if (!modifiers) {
      return 0;
    }
    let result = 0;
    for (const modifier of modifiers) {
      const idx = tokenModifiers.indexOf(modifier);
      if (idx >= 0) {
        result |= 1 << idx;
      }
    }
    return result;
  }

  dispose(): void {
    for (const tree of this.trees.values()) {
      tree.delete();
    }
    this.trees.clear();
  }
}
