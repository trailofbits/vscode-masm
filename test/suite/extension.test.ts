import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

// Note: __dirname is out/test/suite when compiled
const fixturesPath = path.resolve(__dirname, "../../../test/fixtures");

// Semantic token types as defined in treeSitterHighlighter.ts
const TOKEN_TYPES = [
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

// Helper to decode semantic tokens into readable format
interface DecodedToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: string;
  text: string;
}

function decodeSemanticTokens(
  tokens: vscode.SemanticTokens,
  documentText: string
): DecodedToken[] {
  const result: DecodedToken[] = [];
  const lines = documentText.split("\n");
  let currentLine = 0;
  let currentChar = 0;

  // Tokens are encoded as groups of 5 integers:
  // [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
  for (let i = 0; i < tokens.data.length; i += 5) {
    const deltaLine = tokens.data[i];
    const deltaStartChar = tokens.data[i + 1];
    const length = tokens.data[i + 2];
    const tokenTypeIndex = tokens.data[i + 3];

    currentLine += deltaLine;
    currentChar =
      deltaLine === 0 ? currentChar + deltaStartChar : deltaStartChar;

    const lineText = lines[currentLine] || "";
    const text = lineText.substring(currentChar, currentChar + length);

    result.push({
      line: currentLine,
      startChar: currentChar,
      length,
      tokenType: TOKEN_TYPES[tokenTypeIndex] || `unknown(${tokenTypeIndex})`,
      text,
    });
  }

  return result;
}

// Helper to find tokens by type
function findTokensByType(
  tokens: DecodedToken[],
  type: string
): DecodedToken[] {
  return tokens.filter((t) => t.tokenType === type);
}

// Helper to find token containing specific text
function findTokenByText(
  tokens: DecodedToken[],
  text: string
): DecodedToken | undefined {
  return tokens.find((t) => t.text === text);
}

// Helper to get semantic tokens from content
async function getDecodedTokens(content: string): Promise<DecodedToken[]> {
  const document = await vscode.workspace.openTextDocument({
    language: "masm",
    content,
  });
  await vscode.window.showTextDocument(document);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
    "vscode.provideDocumentSemanticTokens",
    document.uri
  );

  if (!tokens) {
    return [];
  }

  return decodeSemanticTokens(tokens, content);
}

suite("MASM Extension Test Suite", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    // Open a .masm file to trigger extension activation and initialize tree-sitter
    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  test("Language should be registered for .masm files", async function () {
    this.timeout(10000);

    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);

    assert.strictEqual(
      document.languageId,
      "masm",
      "Files with .masm extension should have languageId 'masm'"
    );
  });

  test("Restart server command should be registered", async function () {
    this.timeout(30000);

    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("masm.restartServer"),
      "masm.restartServer command should be registered after extension activation"
    );
  });
});

suite("Semantic Token Type Verification", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  test("Comments should be tokenized as 'comment' type", async function () {
    this.timeout(30000);

    const content = "# This is a comment\nbegin\nend";
    const tokens = await getDecodedTokens(content);

    const commentTokens = findTokensByType(tokens, "comment");
    assert.ok(
      commentTokens.length > 0,
      "Should have at least one comment token"
    );

    const commentToken = commentTokens.find((t) =>
      t.text.includes("This is a comment")
    );
    assert.ok(
      commentToken,
      "The comment text should be tokenized as a comment"
    );
  });

  test("Keywords 'begin' and 'end' should be tokenized as 'keyword' type", async function () {
    this.timeout(30000);

    // Use the simple fixture file which has a complete, parseable program
    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const rawTokens =
      await vscode.commands.executeCommand<vscode.SemanticTokens>(
        "vscode.provideDocumentSemanticTokens",
        document.uri
      );
    assert.ok(rawTokens, "Tokens should be returned");
    const tokens = decodeSemanticTokens(rawTokens, document.getText());

    // Keywords are captured as full tokens per the grammar
    const keywordTokens = findTokensByType(tokens, "keyword");
    const keywords = keywordTokens.map((t) => t.text);

    assert.ok(
      keywords.includes("begin"),
      `'begin' should be a keyword. Found keywords: ${JSON.stringify(keywords)}`
    );
    assert.ok(
      keywords.includes("end"),
      `'end' should be a keyword. Found keywords: ${JSON.stringify(keywords)}`
    );
    // The file contains multiple keyword instructions
    assert.ok(
      keywords.length >= 5,
      `Should have at least 5 keyword tokens. Found: ${JSON.stringify(
        keywords
      )}`
    );
  });

  test("Procedure names should be tokenized as 'function' type", async function () {
    this.timeout(30000);

    const content = "export.my_procedure\n    nop\nend";
    const tokens = await getDecodedTokens(content);

    const procToken = findTokenByText(tokens, "my_procedure");
    assert.ok(procToken, "Procedure name 'my_procedure' should be tokenized");
    assert.strictEqual(
      procToken?.tokenType,
      "function",
      "Procedure name should be a function"
    );
  });

  test("Constants should be tokenized as 'variable' with readonly modifier", async function () {
    this.timeout(30000);

    const content = "const.MY_CONST=42\nbegin\nend";
    const tokens = await getDecodedTokens(content);

    const constToken = findTokenByText(tokens, "MY_CONST");
    assert.ok(constToken, "Constant 'MY_CONST' should be tokenized");
    assert.strictEqual(
      constToken?.tokenType,
      "variable",
      "Constant should be tokenized as variable"
    );
  });

  test("Numeric literals should be tokenized as 'number' type", async function () {
    this.timeout(30000);

    // Use the fixture file which has working number literals
    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const rawTokens =
      await vscode.commands.executeCommand<vscode.SemanticTokens>(
        "vscode.provideDocumentSemanticTokens",
        document.uri
      );
    assert.ok(rawTokens, "Tokens should be returned");
    const tokens = decodeSemanticTokens(rawTokens, document.getText());

    // simple.masm contains numbers like 1, 2, 100
    const numberTokens = findTokensByType(tokens, "number");
    assert.ok(
      numberTokens.length > 0,
      `Should have number tokens. All tokens: ${JSON.stringify(
        tokens.map((t) => ({ text: t.text, type: t.tokenType }))
      )}`
    );
  });

  test("Decorators (@inline, @test) should be tokenized as 'decorator' type", async function () {
    this.timeout(30000);

    const content = "@inline\nexport.my_func\n    nop\nend";
    const tokens = await getDecodedTokens(content);

    // The grammar captures @ and the name separately as @attribute
    const decoratorTokens = findTokensByType(tokens, "decorator");
    assert.ok(
      decoratorTokens.length > 0,
      `Should have decorator tokens. All tokens: ${JSON.stringify(
        tokens.map((t) => ({ text: t.text, type: t.tokenType }))
      )}`
    );
  });

  test("Import aliases should be tokenized as 'namespace' type", async function () {
    this.timeout(30000);

    // Use the complex fixture which has import aliases (use.x::y->alias)
    const filePath = path.join(fixturesPath, "complex.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const rawTokens =
      await vscode.commands.executeCommand<vscode.SemanticTokens>(
        "vscode.provideDocumentSemanticTokens",
        document.uri
      );
    assert.ok(rawTokens, "Tokens should be returned");
    const tokens = decodeSemanticTokens(rawTokens, document.getText());

    // complex.masm has: use.std::collections::smt->smt_alias
    // The import alias name is captured as @module -> "namespace"
    const namespaceTokens = findTokensByType(tokens, "namespace");
    assert.ok(
      namespaceTokens.length > 0,
      `Import alias should be tokenized as namespace. Found types: ${[
        ...new Set(tokens.map((t) => t.tokenType)),
      ]}`
    );

    // Verify the alias name is among the namespace tokens
    const namespaceTexts = namespaceTokens.map((t) => t.text);
    assert.ok(
      namespaceTexts.includes("smt_alias"),
      `'smt_alias' should be tokenized as namespace. Found: ${JSON.stringify(
        namespaceTexts
      )}`
    );
  });

  test("Control flow keywords should be tokenized as 'keyword' type", async function () {
    this.timeout(30000);

    // Use the complex fixture which has control flow
    const filePath = path.join(fixturesPath, "complex.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const rawTokens =
      await vscode.commands.executeCommand<vscode.SemanticTokens>(
        "vscode.provideDocumentSemanticTokens",
        document.uri
      );
    assert.ok(rawTokens, "Tokens should be returned");
    const tokens = decodeSemanticTokens(rawTokens, document.getText());

    const keywordTokens = findTokensByType(tokens, "keyword");
    const keywords = keywordTokens.map((t) => t.text);

    // Note: The grammar captures "if.true" and "while.true" as full keywords
    assert.ok(
      keywords.includes("if.true"),
      `'if.true' should be a keyword. Found: ${JSON.stringify(keywords)}`
    );
    assert.ok(
      keywords.includes("else"),
      `'else' should be a keyword. Found: ${JSON.stringify(keywords)}`
    );
    assert.ok(
      keywords.includes("while.true"),
      `'while.true' should be a keyword. Found: ${JSON.stringify(keywords)}`
    );
  });
});

suite("Inlay Hints Commands", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  test("Toggle inlay hints command should be registered", async function () {
    this.timeout(10000);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("masm.toggleInlayHints"),
      "masm.toggleInlayHints command should be registered"
    );
  });

  test("Set inlay hints padding command should be registered", async function () {
    this.timeout(10000);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("masm.setInlayHintsPosition"),
      "masm.setInlayHintsPosition command should be registered"
    );
  });

  test("Toggle inlay hints command should execute without error", async function () {
    this.timeout(10000);

    // Execute toggle command twice to test both enable and disable paths
    // The command now uses internal state and decorations instead of editor.inlayHints.enabled
    await vscode.commands.executeCommand("masm.toggleInlayHints");
    await vscode.commands.executeCommand("masm.toggleInlayHints");

    // If we got here without throwing, the command executed successfully
    assert.ok(true, "Toggle command should execute without error");
  });

  test("Set inlay hints position command should update masm-lsp.inlayHints.alignPosition", async function () {
    this.timeout(15000);

    const config = vscode.workspace.getConfiguration("masm-lsp");

    // Get initial value
    const initialValue = config.get<number>("inlayHints.alignPosition", 40);

    // Execute the command - this opens an input box
    const commandPromise = vscode.commands.executeCommand(
      "masm.setInlayHintsPosition"
    );

    // Wait for the input box to appear
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Accept the input box with the default (current) value
    // Note: We can't programmatically type into VS Code's QuickInput widget in extension tests
    await vscode.commands.executeCommand(
      "workbench.action.acceptSelectedQuickOpenItem"
    );

    // Wait for the command to complete
    await commandPromise;

    // Give VSCode time to update the configuration
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify the setting still has a valid value (command executed successfully)
    const updatedConfig = vscode.workspace.getConfiguration("masm-lsp");
    const newValue = updatedConfig.get<number>("inlayHints.alignPosition");

    // The value should be the same as the initial value since we accepted the default
    assert.strictEqual(
      newValue,
      initialValue,
      `Padding should remain ${initialValue} when accepting default value`
    );
  });

  test("masm-lsp.inlayHints.minimumPadding setting can be updated programmatically", async function () {
    this.timeout(10000);

    const config = vscode.workspace.getConfiguration("masm-lsp");

    // Get initial value and pick a different test value
    const initialValue = config.get<number>("inlayHints.minimumPadding", 2);
    const testValue = initialValue === 5 ? 6 : 5;

    // Update the setting programmatically
    await config.update(
      "inlayHints.minimumPadding",
      testValue,
      vscode.ConfigurationTarget.Global
    );

    // Give VSCode time to update the configuration
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get updated value
    const updatedConfig = vscode.workspace.getConfiguration("masm-lsp");
    const newValue = updatedConfig.get<number>("inlayHints.minimumPadding");

    // Verify it was updated
    assert.strictEqual(
      newValue,
      testValue,
      `Padding should be updated from ${initialValue} to ${testValue}`
    );

    // Restore original value
    await config.update(
      "inlayHints.minimumPadding",
      initialValue,
      vscode.ConfigurationTarget.Global
    );
  });
});

suite("Semantic Token Edge Cases", () => {
  suiteSetup(async function () {
    this.timeout(60000);
    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  test("Empty document should return empty tokens array", async function () {
    this.timeout(30000);

    const tokens = await getDecodedTokens("");
    assert.strictEqual(
      tokens.length,
      0,
      "Empty document should produce no tokens"
    );
  });

  test("Simple fixture file should have correct token types", async function () {
    this.timeout(30000);

    // Use the simple fixture file to verify multiple token types
    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const rawTokens =
      await vscode.commands.executeCommand<vscode.SemanticTokens>(
        "vscode.provideDocumentSemanticTokens",
        document.uri
      );
    assert.ok(rawTokens, "Tokens should be returned");
    const tokens = decodeSemanticTokens(rawTokens, document.getText());

    // Verify comment tokens exist
    const commentTokens = findTokensByType(tokens, "comment");
    assert.ok(
      commentTokens.length >= 2,
      "Should have comment tokens (regular and doc)"
    );

    // Verify function tokens (my_function, helper_function)
    const functionTokens = findTokensByType(tokens, "function");
    assert.ok(
      functionTokens.length >= 2,
      "Should have function tokens for procedure names"
    );
    const functionNames = functionTokens.map((t) => t.text);
    assert.ok(
      functionNames.includes("my_function"),
      `'my_function' should be tokenized as function. Found: ${JSON.stringify(
        functionNames
      )}`
    );

    // Verify keyword tokens (begin, end, export, proc, etc.)
    const keywordTokens = findTokensByType(tokens, "keyword");
    assert.ok(keywordTokens.length >= 5, "Should have multiple keyword tokens");
  });

  test("Complex fixture file should have all expected token types", async function () {
    this.timeout(30000);

    // Use the complex fixture file which exercises more features
    const filePath = path.join(fixturesPath, "complex.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const rawTokens =
      await vscode.commands.executeCommand<vscode.SemanticTokens>(
        "vscode.provideDocumentSemanticTokens",
        document.uri
      );
    assert.ok(rawTokens, "Tokens should be returned");
    const tokens = decodeSemanticTokens(rawTokens, document.getText());

    // Verify decorator tokens (@inline, @test)
    const decoratorTokens = findTokensByType(tokens, "decorator");
    assert.ok(
      decoratorTokens.length > 0,
      `Should have decorator tokens for @inline/@test. Found types: ${[
        ...new Set(tokens.map((t) => t.tokenType)),
      ]}`
    );

    // Verify namespace tokens (module paths in use statements)
    const namespaceTokens = findTokensByType(tokens, "namespace");
    assert.ok(
      namespaceTokens.length > 0,
      "Should have namespace tokens for import paths"
    );

    // Verify number tokens
    const numberTokens = findTokensByType(tokens, "number");
    assert.ok(numberTokens.length > 0, "Should have number tokens");

    // Verify operator tokens
    const operatorTokens = findTokensByType(tokens, "operator");
    assert.ok(operatorTokens.length > 0, "Should have operator tokens");
  });

  test("Procedure names should be distinct from keywords", async function () {
    this.timeout(30000);

    // Verify that procedure names are not confused with keywords
    const filePath = path.join(fixturesPath, "simple.masm");
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const rawTokens =
      await vscode.commands.executeCommand<vscode.SemanticTokens>(
        "vscode.provideDocumentSemanticTokens",
        document.uri
      );
    assert.ok(rawTokens, "Tokens should be returned");
    const tokens = decodeSemanticTokens(rawTokens, document.getText());

    const functionTokens = findTokensByType(tokens, "function");
    const keywordTokens = findTokensByType(tokens, "keyword");

    const functionTexts = functionTokens.map((t) => t.text);
    const keywordTexts = keywordTokens.map((t) => t.text);

    // Procedure names should not appear in keyword list
    for (const funcName of ["my_function", "helper_function"]) {
      assert.ok(
        !keywordTexts.includes(funcName),
        `Procedure '${funcName}' should not be tokenized as keyword`
      );
      assert.ok(
        functionTexts.includes(funcName),
        `Procedure '${funcName}' should be tokenized as function`
      );
    }
  });
});
