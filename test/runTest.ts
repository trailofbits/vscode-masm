import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { runTests } from "@vscode/test-electron";

const MIDEN_VM_REPO = "https://github.com/0xPolygonMiden/miden-vm.git";
const TEMP_CORE_PATH = "/tmp/masm-lsp-test-core";

function cloneMidenVm(): void {
  if (fs.existsSync(TEMP_CORE_PATH)) {
    console.log(`Removing existing ${TEMP_CORE_PATH}`);
    fs.rmSync(TEMP_CORE_PATH, { recursive: true, force: true });
  }
  console.log(`Cloning miden-vm to ${TEMP_CORE_PATH}`);
  execSync(`git clone --depth 1 ${MIDEN_VM_REPO} ${TEMP_CORE_PATH}`, {
    stdio: "inherit",
  });
}

function cleanupMidenVm(): void {
  if (fs.existsSync(TEMP_CORE_PATH)) {
    console.log(`Cleaning up ${TEMP_CORE_PATH}`);
    fs.rmSync(TEMP_CORE_PATH, { recursive: true, force: true });
  }
}

async function main() {
  try {
    // Clone miden-vm to temp directory for tests
    cloneMidenVm();

    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    // Note: __dirname is out/test when compiled
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    // The path to the workspace to open for tests
    const testWorkspace = path.resolve(__dirname, "../../test/fixtures");

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testWorkspace, "--disable-extensions"],
      extensionTestsEnv: {
        MASM_LSP_TEST_CORE_PATH: TEMP_CORE_PATH,
      },
    });
  } catch (err) {
    console.error("Failed to run tests:", err);
    process.exit(1);
  } finally {
    // Always clean up, even if tests fail
    cleanupMidenVm();
  }
}

main();
