import * as path from "path";
import * as vscode from "vscode";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
  // Configure masm-lsp to use the test core library path from environment
  const corePath = process.env.MASM_LSP_TEST_CORE_PATH;
  if (corePath) {
    const config = vscode.workspace.getConfiguration("masm-lsp");
    await config.update("corePath", corePath, vscode.ConfigurationTarget.Global);
  }

  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 60000, // 60 seconds timeout for extension tests
  });

  const testsRoot = path.resolve(__dirname, ".");

  const files = await glob("**/**.test.js", { cwd: testsRoot });

  // Add files to the test suite
  files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

  // Run the mocha test
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
