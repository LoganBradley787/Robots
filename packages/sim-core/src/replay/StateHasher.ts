// FNV-1a over the exact bytes of each value. Exact bits, not quantized: the sim is supposed to be
// bit-identical run to run, and any drift should show up immediately.
export class StateHasher {
  private h = 0x811c9dc5;
  private readonly view = new DataView(new ArrayBuffer(8));

  private addByte(b: number): void {
    this.h ^= b & 0xff;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
  }

  addInt(v: number): void {
    this.view.setInt32(0, v | 0, true);
    for (let i = 0; i < 4; i++) this.addByte(this.view.getUint8(i));
  }

  addF64(v: number): void {
    this.view.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.addByte(this.view.getUint8(i));
  }

  digest(): number {
    return this.h >>> 0;
  }

  static hex(h: number): string {
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
