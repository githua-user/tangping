import { GameState, Position } from '../types';
import { GRID_CELL_SIZE, GRID_OFFSET } from '../utils/Collision';

// 金币飘字动画时长（ms）：上浮 + 渐隐的总时长（引擎时钟计时）
const GOLD_TEXT_DURATION = 900;

// 视觉特效绘制（金币飘字/画面暗角）：只读 GameState 与引擎时钟，不回写游戏状态；
// 金币飘字队列与其基准金价作为实例状态持有，随实例生命周期演进（Renderer 构造时创建一次）；
// 子弹与命中特效绘制随炮塔渲染独立成 TurretRenderer（assets）
export class EffectRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private cellSize: number = GRID_CELL_SIZE; // 单个网格单元格的像素边长
  private gridOffset: Position = GRID_OFFSET; // 网格原点相对画布左上角的偏移（用于把场地居中）
  // 金币飘字队列：纯视觉反馈，逐帧对比金币增量生成，生命周期由引擎时钟推进
  private goldTexts: Array<{ amount: number; x: number; y: number; startTime: number; driftX: number }> = [];
  // 上一帧金币值（null = 尚未建立基准，首帧只记录不生成飘字）
  private lastGold: number | null = null;

  constructor(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    this.ctx = ctx;
    this.canvas = canvas;
  }

  // 金币飘字：逐帧对比 player.gold 增量，金币入账（睡觉产出）时在玩家当前位置
  // （睡觉即吸附于床中心）上方生成"+N"飘字；金币减少（建造/升级消费）不触发，首帧只建立基准
  public updateGoldTexts(state: GameState, nowMs: number) {
    const gold = state.player.gold;
    if (this.lastGold !== null && gold > this.lastGold) {
      const px = this.gridOffset.x + state.player.position.x * this.cellSize + this.cellSize / 2;
      const py = this.gridOffset.y + state.player.position.y * this.cellSize + this.cellSize / 2;
      this.goldTexts.push({
        amount: gold - this.lastGold,
        x: px + (Math.random() - 0.5) * 16, // 小幅随机偏移，连续产币时飘字不完全重叠
        y: py - 30,
        startTime: nowMs,
        driftX: (Math.random() - 0.5) * 14,
      });
    }
    this.lastGold = gold;
    // 仅保留未播完的飘字；nowMs 冻结（暂停）时列表原样保留，恢复后继续播放
    this.goldTexts = this.goldTexts.filter((gt) => nowMs - gt.startTime < GOLD_TEXT_DURATION);
  }

  // 绘制金币飘字：出生短暂放大 → 上浮（先快后缓）→ 后段加速渐隐；深色描边保证任何场景下可读
  public drawGoldTexts(nowMs: number) {
    this.goldTexts.forEach((gt) => {
      const t = Math.min(1, (nowMs - gt.startTime) / GOLD_TEXT_DURATION);
      const alpha = 1 - t * t;
      const rise = 36 * (1 - (1 - t) * (1 - t));
      const x = gt.x + gt.driftX * t;
      const y = gt.y - rise;
      const scale = 1 + 0.3 * Math.max(0, 1 - t * 4); // 前 1/4 段弹出放大

      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.font = `bold ${Math.round(15 * scale)}px Arial`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.lineJoin = 'round';
      this.ctx.lineWidth = 3;
      this.ctx.strokeStyle = 'rgba(77, 48, 0, 0.9)';
      this.ctx.strokeText(`+${gt.amount}`, x, y);
      const goldGrad = this.ctx.createLinearGradient(x, y - 9, x, y + 9);
      goldGrad.addColorStop(0, '#fff7cc');
      goldGrad.addColorStop(1, '#f5c518');
      this.ctx.fillStyle = goldGrad;
      this.ctx.fillText(`+${gt.amount}`, x, y);
      this.ctx.restore();
    });
  }

  // 画面暗角：四周径向渐入黑暗，压暗边缘、把视觉焦点收拢到场地中心
  public drawVignette() {
      const gradient = this.ctx.createRadialGradient(
          this.canvas.width / 2, this.canvas.height / 2, 200,
          this.canvas.width / 2, this.canvas.height / 2, 500
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
      
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
