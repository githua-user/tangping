import { GameState } from '../types';
// 静态地板/墙体绘制与离屏缓存都并入 FloorRenderer，本类仅转发
import { FloorRenderer } from '../assets/FloorRenderer';
// 金币飘字/画面暗角等视觉特效绘制独立成 EffectRenderer，本类仅转发调用
import { EffectRenderer } from '../assets/EffectRenderer';
// 房门/床铺外观绘制独立成 SpawnRenderer，本类仅转发
import { SpawnRenderer } from '../assets/SpawnRenderer';
import { PlayerRenderer } from '../assets/PlayerRenderer';
import { GhostRenderer } from '../assets/GhostRenderer';
import { TurretRenderer } from '../assets/TurretRenderer';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  // 静态地板/墙体绘制与离屏缓存收在 FloorRenderer（assets），本类仅转发
  private floor: FloorRenderer;
  // 金币飘字/暗角：绘制与飘字队列状态都收在 EffectRenderer（assets），本类仅转发
  private effects: EffectRenderer;
  // 房门/床铺绘制收在 SpawnRenderer（assets），本类仅转发；入场门与幽灵啃门借用其门几何与画法
  private spawn: SpawnRenderer;
  // 玩家绘制收在 PlayerRenderer（assets），本类仅转发
  private playerRenderer: PlayerRenderer;
  // 幽灵绘制收在 GhostRenderer（assets），本类仅转发；幽灵啃门经其借用同一 SpawnRenderer 实例
  private ghostRenderer: GhostRenderer;
  // 炮塔与子弹/命中特效绘制收在 TurretRenderer（assets），本类仅转发；炮头角度缓存随其实例演进
  private turretRenderer: TurretRenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.floor = new FloorRenderer(this.ctx);
    this.effects = new EffectRenderer(this.ctx, canvas);
    this.spawn = new SpawnRenderer(this.ctx);
    this.playerRenderer = new PlayerRenderer(this.ctx);
    this.ghostRenderer = new GhostRenderer(this.ctx, this.spawn);
    this.turretRenderer = new TurretRenderer(this.ctx);
  }
  // nowMs：引擎游戏时钟（GameLogic.getClockMs）。子弹/特效插值必须与引擎写入 startTime 时使用同一时钟，
  // 否则位置与命中结算会基准错位
  public render(state: GameState, nowMs: number) {
    this.clear();
    this.effects.updateGoldTexts(state, nowMs); // 金币增量检测：新入账时在玩家（睡觉即床中心）上方生成飘字
    this.floor.drawFloor(this.canvas.width, this.canvas.height); // 静态地板/墙体：直接贴预渲染缓存（FloorRenderer 构建），替代每帧重画
    this.ghostRenderer.drawGhostEntranceDoor(state, nowMs); // 左下角入场门：玩家第一次上床前就立在走廊尽头，等着被撞开
    this.spawn.drawDoors(state, nowMs);
    this.spawn.drawBeds(state);
    this.playerRenderer.drawPlayer(state, nowMs);
    this.turretRenderer.drawTurrets(state, nowMs);
    this.turretRenderer.drawProjectiles(state, nowMs);
    this.ghostRenderer.drawGhost(state, nowMs);
    this.turretRenderer.drawHitEffects(state, nowMs);
    this.effects.drawGoldTexts(nowMs); // 金币飘字与其余 Canvas 元素同一明暗层级（压在暗角之下）
    this.effects.drawVignette();
  }

  // 清空画布：每帧渲染前先擦除上一帧内容，避免残影
  private clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

}
