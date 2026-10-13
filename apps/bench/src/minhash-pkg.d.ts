// minhash@0.0.9 ships no types. Only what the bench calls is declared.
declare module "minhash" {
  export class Minhash {
    constructor(config?: { numPerm?: number; seed?: number });
    numPerm: number;
    hashvalues: number[];
    update(str: string): void;
    jaccard(other: Minhash): number;
  }
  export class LshIndex {
    constructor(args?: { bandSize?: number });
    bandSize: number;
    insert(key: string, minhash: Minhash): void;
    query(minhash: Minhash): string[];
  }
}
