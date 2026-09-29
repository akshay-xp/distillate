/** One published entry point, with package-relative paths. */
export interface Entry {
  /** The key in package.json exports, e.g. "./bloom". */
  subpath: string;
  /** The API report name: "distillate" for ".", else the subpath's directory. */
  name: string;
  src: string;
  dts: string;
}

export function entriesOf(exports: Record<string, unknown>): Entry[];

export function publishedEntries(): Entry[];
