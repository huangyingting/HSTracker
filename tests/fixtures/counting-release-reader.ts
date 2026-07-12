import type {
  ReleaseObject,
  ReleaseObjectReader,
} from "../../src/release/release-object-store";

export class CountingReleaseReader implements ReleaseObjectReader {
  readCount = 0;

  constructor(private readonly delegate: ReleaseObjectReader) {}

  async getObject(key: string): Promise<ReleaseObject | null> {
    this.readCount += 1;
    return this.delegate.getObject(key);
  }
}
