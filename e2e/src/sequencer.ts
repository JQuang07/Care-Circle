/** Run scenario files in name order (01 → 05), not vitest's duration-based order. */
import { BaseSequencer, type TestSpecification } from "vitest/node";

export default class ByName extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
  async shard(files: TestSpecification[]) {
    return files;
  }
}
