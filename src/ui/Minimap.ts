import { MAP_BOXES, MAP_SIZE } from "../../shared/mapData";

/**
 * Minimapa 2D (top-down, norte fixo = +Z para cima).
 * A geometria estática é pré-renderizada num canvas offscreen;
 * por frame só se desenha a seta do player.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly scale: number;
  private readonly background: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.size = canvas.width;
    this.scale = this.size / MAP_SIZE;
    this.background = this.prerenderBackground();
  }

  private toPx(wx: number): number {
    return (wx + MAP_SIZE / 2) * this.scale;
  }

  private toPy(wz: number): number {
    return this.size - (wz + MAP_SIZE / 2) * this.scale;
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

    for (const b of MAP_BOXES) {
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

    // Player: seta laranja apontando para onde olha.
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
