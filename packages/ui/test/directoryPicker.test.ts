import assert from "node:assert/strict";
import test from "node:test";
import {
  parentDirectoryPath,
  pickDirectoryInBrowser,
  setDirectoryPicker,
} from "../src/lib/directoryPickerBridge.js";

test("parentDirectoryPath handles Windows, POSIX and Termux paths", () => {
  assert.equal(parentDirectoryPath("C:\\Users\\Ev"), "C:\\Users");
  assert.equal(parentDirectoryPath("C:\\Users"), "C:\\");
  assert.equal(parentDirectoryPath("C:\\"), "C:\\");
  assert.equal(parentDirectoryPath("/home/u"), "/home");
  assert.equal(parentDirectoryPath("/home"), "/");
  assert.equal(parentDirectoryPath("/"), "/");
  assert.equal(
    parentDirectoryPath("/data/data/com.termux/files/home"),
    "/data/data/com.termux/files",
  );
});

test("web selectDirectory resolves through the registered folder browser", async () => {
  assert.equal(await pickDirectoryInBrowser(), null);
  setDirectoryPicker(() => Promise.resolve("/srv/project"));
  assert.equal(await pickDirectoryInBrowser(), "/srv/project");
  setDirectoryPicker(null);
});
