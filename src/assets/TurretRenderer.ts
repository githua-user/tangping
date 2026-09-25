import { GameState, Position, TURRET_MAX_LEVEL, GHOST_SPAWN_DURATION } from '../types';
import { GRID_CELL_SIZE, GRID_OFFSET } from '../utils/Collision';
// roundRect 路径工具（SpawnRenderer 导出）
import { roundRect } from './SpawnRenderer';

// 炮口火光时长（ms）：自开火瞬间（projectile.startTime）起算的余焰持续时间
const MUZZLE_FLASH_DURATION = 130;

// 炮塔外观分档（1~5 级）：底座/炮头/炮管尺寸与配色，逐级加件（机枪塔 → 双管塔 → 加农炮 → 重炮 → 等离子炮）；
// barrel 同时是炮口火光的锚点距离，因此换档后焰舌始终落在炮口上
const TURRET_TIERS = [
  { baseR: 15, ringR: 11, base: '#7f8c8d', baseDark: '#5d6d7e', trim: '#95a5a6', headSize: 16, head: '#2ecc71', headDark: '#27ae60', barrel: 20, barrelW: 8, core: '#a9e6c0' },
  { baseR: 16, ringR: 12, base: '#78858a', baseDark: '#546065', trim: '#9fb0b5', headSize: 17, head: '#27ae60', headDark: '#1e8449', barrel: 23, barrelW: 8, core: '#a9dfbf' },
  { baseR: 17, ringR: 13, base: '#6f7c82', baseDark: '#4a545a', trim: '#aab8bd', headSize: 18, head: '#1e8449', headDark: '#145a32', barrel: 26, barrelW: 9, core: '#7dcea0' },
  { baseR: 18, ringR: 14, base: '#616d73', baseDark: '#3d4649', trim: '#b6c4c9', headSize: 19, head: '#196f3d', headDark: '#0e4429', barrel: 29, barrelW: 10, core: '#58d68d' },
  { baseR: 19, ringR: 15, base: '#4a5358', baseDark: '#2b3236', trim: '#e8c23c', headSize: 20, head: '#117a46', headDark: '#07432a', barrel: 32, barrelW: 11, core: '#9effe0' },
];

// 炮塔与子弹/命中特效绘制：只读 GameState 与引擎时钟，不回写游戏状态；
// 炮头转向角度缓存作为实例状态持有，随实例生命周期演进（Renderer 构造时创建一次）
export class TurretRenderer {
  private ctx: CanvasRenderingContext2D;
  private cellSize: number = GRID_CELL_SIZE; // 单个网格单元格的像素边长
  private gridOffset: Position = GRID_OFFSET; // 网格原点相对画布左上角的偏移（用于把场地居中）
  // 炮塔炮头当前角度缓存（按炮塔 id），用于逐帧平滑转向目标
  private turretAngles: Map<string, number> = new Map();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  // nowMs：引擎游戏时钟，炮口火光余焰按「当前时钟 - 开火时刻」衰减
  public drawTurrets(state: GameState, nowMs: number) {
    state.turrets.forEach(turret => {
        const px = this.gridOffset.x + turret.position.x * this.cellSize + this.cellSize / 2;
        const py = this.gridOffset.y + turret.position.y * this.cellSize + this.cellSize / 2;
        // 等级封顶在 TURRET_MAX_LEVEL（炮塔外观 5 档），超出部分统一按最高档绘制
        const level = Math.min(turret.level, TURRET_MAX_LEVEL);
        const t = TURRET_TIERS[level - 1];

        this.ctx.save();

        // 底座：外沿暗圈 + 盘面 + 装甲圈；3 级起加铆钉、4 级起加压暗底裙、5 级起加能量环
        this.ctx.fillStyle = t.baseDark;
        this.ctx.beginPath();
        this.ctx.arc(px, py, t.baseR, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = t.base;
        this.ctx.beginPath();
        this.ctx.arc(px, py - 1, t.baseR - 1.5, 0, Math.PI * 2);
        this.ctx.fill();
        // 盘面左上受光高光（与全场景左上主光源一致）
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        this.ctx.beginPath();
        this.ctx.arc(px - t.baseR * 0.3, py - t.baseR * 0.42, t.baseR * 0.56, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = t.trim;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(px, py, t.ringR, 0, Math.PI * 2);
        this.ctx.stroke();
        // 4 级起：底裙压暗（下半圈一块厚装甲的落影）
        if (level >= 4) {
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
          this.ctx.beginPath();
          this.ctx.arc(px, py, t.baseR - 0.5, Math.PI * 0.12, Math.PI * 0.88);
          this.ctx.closePath();
          this.ctx.fill();
        }
        // 3 级起：装甲圈上的铆钉（4 级起由 4 颗加到 6 颗）
        if (level >= 3) {
          const bolts = level >= 4 ? 6 : 4;
          for (let i = 0; i < bolts; i++) {
            const a = (i / bolts) * Math.PI * 2 + 0.45;
            const bxp = px + Math.cos(a) * t.ringR;
            const byp = py + Math.sin(a) * t.ringR;
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            this.ctx.beginPath();
            this.ctx.arc(bxp, byp, 1.7, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            this.ctx.beginPath();
            this.ctx.arc(bxp - 0.5, byp - 0.5, 0.8, 0, Math.PI * 2);
            this.ctx.fill();
          }
        }
        // 5 级：能量环（发光细圈），点明最高档
        if (level >= 5) {
          this.ctx.save();
          this.ctx.shadowColor = t.core;
          this.ctx.shadowBlur = 10;
          this.ctx.strokeStyle = t.core;
          this.ctx.lineWidth = 2.2;
          this.ctx.beginPath();
          this.ctx.arc(px, py, t.ringR - 3, 0, Math.PI * 2);
          this.ctx.stroke();
          this.ctx.restore();
        }

        // 炮头朝向：射程内平滑追踪幽灵，射程外慢速空转；
        // 潜伏期 / 缩进门洞回血中 / 钻出门洞的过渡期间不索敌，炮头空转（与引擎侧 updateTurrets 的守卫一致）
        const dx = state.ghost.position.x - turret.position.x;
        const dy = state.ghost.position.y - turret.position.y;
        const inRange = this.ghostHittable(state.ghost, nowMs) && Math.sqrt(dx * dx + dy * dy) <= turret.range;
        const currentAngle = this.turretAngles.get(turret.id) ?? 0;
        const targetAngle = inRange ? Math.atan2(dy, dx) : currentAngle + 0.05;
        // 目标角与当前角的最小夹角（处理 ±π 环绕）后按比例插值，避免瞬间摇头
        let diff = targetAngle - currentAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const angle = currentAngle + diff * 0.18;
        this.turretAngles.set(turret.id, angle);

        // 炮头与炮管随追踪角度整体旋转，形状按等级分档
        this.ctx.translate(px, py);
        this.ctx.rotate(angle);
        this.drawTurretHead(t, level);

        this.ctx.restore();

        // 炮口火光：该炮塔最近 MUZZLE_FLASH_DURATION 内有子弹发射（startTime 即引擎时钟记下的开火时刻），
        // 在炮口沿炮头朝向绘制光晕 + 焰舌，强度随时间衰减到 0
        const fired = state.projectiles.find(
            (p) => p.from.x === turret.position.x && p.from.y === turret.position.y
                && nowMs - p.startTime < MUZZLE_FLASH_DURATION
        );
        if (fired) {
            const tf = Math.min(1, (nowMs - fired.startTime) / MUZZLE_FLASH_DURATION);
            const k = 1 - tf; // 余焰强度
            // 炮口位置：沿炮管方向取本档炮管末端稍外（换档后焰舌仍落在炮口）
            const mx = px + Math.cos(angle) * (t.barrel + 1);
            const my = py + Math.sin(angle) * (t.barrel + 1);

            this.ctx.save();
            this.ctx.translate(mx, my);
            this.ctx.rotate(angle);

            // 径向光晕：黄白核心向外渐隐
            const glow = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 16 * k + 6);
            glow.addColorStop(0, `rgba(255, 255, 220, ${0.95 * k})`);
            glow.addColorStop(0.35, `rgba(255, 214, 90, ${0.7 * k})`);
            glow.addColorStop(1, 'rgba(255, 140, 0, 0)');
            this.ctx.fillStyle = glow;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 16 * k + 6, 0, Math.PI * 2);
            this.ctx.fill();

            // 焰舌：主焰朝炮口前方 + 上下两片副焰，长度随开火时刻微扰让每一发形状略有差异
            const len = 10 + 9 * k + Math.sin(fired.startTime * 0.37) * 2;
            this.ctx.fillStyle = `rgba(255, 235, 160, ${0.9 * k})`;
            this.ctx.beginPath();
            this.ctx.moveTo(2, -3.2);
            this.ctx.lineTo(len, 0);
            this.ctx.lineTo(2, 3.2);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.beginPath();
            this.ctx.moveTo(2, -2.6);
            this.ctx.lineTo(len * 0.6, -5.5);
            this.ctx.lineTo(2.5, -0.5);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.beginPath();
            this.ctx.moveTo(2, 2.6);
            this.ctx.lineTo(len * 0.6, 5.5);
            this.ctx.lineTo(2.5, 0.5);
            this.ctx.closePath();
            this.ctx.fill();

            this.ctx.restore();
        }

        // 等级标识：炮塔下方居中（深色衬底保证压在地板纹理上仍可读）
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        roundRect(this.ctx, px - 24, py + 21, 48, 12, 6);
        this.ctx.fill();
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '10px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`炮塔 Lv.${level}`, px, py + 30);
    });
  }

  // 子弹：绿色能量弹，带朝飞行方向的渐隐拖尾（now 为引擎游戏时钟）
  public drawProjectiles(state: GameState, now: number) {
    state.projectiles.forEach(proj => {
        const t = Math.min(1, (now - proj.startTime) / proj.duration);
        const fx = this.gridOffset.x + proj.from.x * this.cellSize + this.cellSize / 2;
        const fy = this.gridOffset.y + proj.from.y * this.cellSize + this.cellSize / 2;
        const tx = this.gridOffset.x + proj.to.x * this.cellSize + this.cellSize / 2;
        const ty = this.gridOffset.y + proj.to.y * this.cellSize + this.cellSize / 2;
        const x = fx + (tx - fx) * t;
        const y = fy + (ty - fy) * t;

        // 飞行方向单位向量（用于拖尾朝向）
        const dirLen = Math.hypot(tx - fx, ty - fy) || 1;
        const ux = (tx - fx) / dirLen;
        const uy = (ty - fy) / dirLen;

        this.ctx.save();

        // 拖尾：沿飞行反方向的渐隐短尾
        const tail = 16;
        const grad = this.ctx.createLinearGradient(x - ux * tail, y - uy * tail, x, y);
        grad.addColorStop(0, 'rgba(46, 204, 113, 0)');
        grad.addColorStop(1, 'rgba(46, 204, 113, 0.85)');
        this.ctx.strokeStyle = grad;
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(x - ux * tail, y - uy * tail);
        this.ctx.lineTo(x, y);
        this.ctx.stroke();

        // 弹头：带光晕的发光核心
        this.ctx.shadowColor = '#aaffcc';
        this.ctx.shadowBlur = 10;
        this.ctx.fillStyle = '#eafff3';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();
    });
  }

  // 命中特效：扩散冲击环 + 中心闪光，整体随时间渐隐（now 为引擎游戏时钟）
  public drawHitEffects(state: GameState, now: number) {
    state.hitEffects.forEach(eff => {
        const t = Math.min(1, (now - eff.startTime) / eff.duration);
        const px = this.gridOffset.x + eff.position.x * this.cellSize + this.cellSize / 2;
        const py = this.gridOffset.y + eff.position.y * this.cellSize + this.cellSize / 2;
        const alpha = 1 - t;

        this.ctx.save();

        // 扩散冲击环
        this.ctx.strokeStyle = `rgba(46, 204, 113, ${alpha * 0.9})`;
        this.ctx.lineWidth = 3 * alpha + 1;
        this.ctx.beginPath();
        this.ctx.arc(px, py, 5 + t * 20, 0, Math.PI * 2);
        this.ctx.stroke();

        // 中心闪光渐隐
        const flash = this.ctx.createRadialGradient(px, py, 0, px, py, 14);
        flash.addColorStop(0, `rgba(234, 255, 243, ${alpha})`);
        flash.addColorStop(1, 'rgba(234, 255, 243, 0)');
        this.ctx.fillStyle = flash;
        this.ctx.beginPath();
        this.ctx.arc(px, py, 14, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();
    });
  }

  // 炮头与炮管（在已按朝向旋转的坐标系里绘制，原点为炮塔中心，+x 为朝向）：
  // 1 级方形炮头 + 直炮管；2 级起加侧面弹匣；3 级起换六边形炮头 + 炮口制退器；
  // 4 级起加后座套筒；5 级加能量芯线与炮头核心
  private drawTurretHead(t: typeof TURRET_TIERS[number], level: number) {
    const hs = t.headSize / 2;

    // 炮管：自中心沿朝向伸出
    this.ctx.fillStyle = t.headDark;
    this.ctx.fillRect(0, -t.barrelW / 2, t.barrel, t.barrelW);
    // 4 级起：后座套筒（炮管根部加粗的一段）
    if (level >= 4) {
      this.ctx.fillStyle = t.baseDark;
      this.ctx.fillRect(hs - 3, -t.barrelW / 2 - 2, 10, t.barrelW + 4);
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      this.ctx.fillRect(hs - 3, -t.barrelW / 2 - 2, 10, 1.5);
    }
    // 3 级起：炮口制退器（末端加宽的一圈）
    if (level >= 3) {
      this.ctx.fillStyle = t.trim;
      this.ctx.fillRect(t.barrel - 5, -t.barrelW / 2 - 2, 5, t.barrelW + 4);
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      this.ctx.fillRect(t.barrel - 5, t.barrelW / 2, 5, 2);
    }
    // 5 级：能量芯线（沿炮管中线的一道发光带）
    if (level >= 5) {
      this.ctx.save();
      this.ctx.shadowColor = t.core;
      this.ctx.shadowBlur = 8;
      this.ctx.fillStyle = t.core;
      this.ctx.fillRect(hs, -1, t.barrel - hs - 2, 2);
      this.ctx.restore();
    }

    // 炮头本体：3 级起为六边形（比方形更像炮塔），1-2 级为方形
    this.ctx.fillStyle = t.head;
    if (level >= 3) {
      this.ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * hs;
        const y = Math.sin(a) * hs;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.closePath();
      this.ctx.fill();
    } else {
      this.ctx.fillRect(-hs, -hs, t.headSize, t.headSize);
    }
    // 炮头受光面（上沿）与背光面（下沿）
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    this.ctx.fillRect(-hs + 1.5, -hs + 1.5, t.headSize - 3, 3);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    this.ctx.fillRect(-hs + 1.5, hs - 3, t.headSize - 3, 2);

    // 2 级起：炮头侧面的弹匣
    if (level >= 2) {
      this.ctx.fillStyle = t.headDark;
      this.ctx.fillRect(-hs - 3.5, -4, 5, 8);
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      this.ctx.fillRect(-hs - 3.5, -4, 5, 1.5);
    }

    // 5 级：炮头能量核心
    if (level >= 5) {
      this.ctx.save();
      this.ctx.shadowColor = t.core;
      this.ctx.shadowBlur = 10;
      this.ctx.fillStyle = t.core;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 3, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  // 幽灵此刻能不能被打：与引擎侧 GameLogic.isGhostHittable 同一套规则 ——
  // 潜伏期还没有实体；缩进门洞回血中免伤；钻出门洞的过渡期间人还在门洞里，同样打不到
  private ghostHittable(ghost: GameState['ghost'], nowMs: number): boolean {
    if (ghost.spawnTime < 0 || ghost.state === 'DORMANT' || ghost.state === 'HEALING') return false;
    return nowMs - ghost.emergeTime >= GHOST_SPAWN_DURATION;
  }
}
