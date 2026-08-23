import type { BoxDef } from "../../shared/mapData";
import { MAP_BOXES, MAP_SIZE } from "../../shared/mapData";

/**
 * Minimapa 2D (top-down, norte fixo = +Z para cima).
 * A geometria estática é pré-renderizada num canvas offscreen;
 * por frame só se desenha a seta do player.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private scale: number;
  private mapSizeX: number;
  private mapSizeZ: number;
  private offsetX = 0;
  private offsetY = 0;
  private boxes: readonly BoxDef[];
  private background: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.size = canvas.width;
    this.mapSizeX = MAP_SIZE;
    this.mapSizeZ = MAP_SIZE;
    this.scale = this.size / MAP_SIZE;
    this.boxes = MAP_BOXES;
    this.background = this.prerenderBackground();
  }

  rebuild(boxes: readonly BoxDef[], mapSizeX: number, mapSizeZ: number = mapSizeX): void {
    this.boxes = boxes;
    this.mapSizeX = Math.max(8, mapSizeX);
    this.mapSizeZ = Math.max(8, mapSizeZ);
    this.scale = this.size / Math.max(this.mapSizeX, this.mapSizeZ);
    const drawnW = this.mapSizeX * this.scale;
    const drawnH = this.mapSizeZ * this.scale;
    this.offsetX = (this.size - drawnW) / 2;
    this.offsetY = (this.size - drawnH) / 2;
    this.background = this.prerenderBackground();
  }

  private toPx(wx: number): number {
    return this.offsetX + (wx + this.mapSizeX / 2) * this.scale;
  }

  private toPy(wz: number): number {
    return this.offsetY + this.mapSizeZ * this.scale - (wz + this.mapSizeZ / 2) * this.scale;
  }

  private prerenderBackground(): HTMLCanvasElement {
    const off = document.createElement("canvas");
    off.width = this.size;
    off.height = this.size;
    const ctx = off.getContext("2d")!;

    ctx.fillStyle = "rgba(10, 14, 20, 0.72)";
    ctx.fillRect(0, 0, this.size, this.size);

    const colors: Record<string, string> = {
      wall: "#3d4654",
      building: "#8a7a68",
      box: "#b06a35",
      platform: "#5a8a66",
      pillar: "#9aa0ac",
    };

    for (const b of this.boxes) {
      ctx.fillStyle = colors[b.kind] ?? "#666";
      const x = this.toPx(b.x - b.w / 2);
      const y = this.toPy(b.z + b.d / 2);
      ctx.fillRect(x, y, b.w * this.scale, b.d * this.scale);
    }
    return off;
  }

  /** Redesenha o minimapa (chamar ~15x/s). */
  draw(playerX: number, playerZ: number, playerYaw: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(this.background, 0, 0);

    const px = this.toPx(playerX);
    const py = this.toPy(playerZ);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(playerYaw);
    ctx.fillStyle = "#ff9d2f";
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
