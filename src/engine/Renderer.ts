import { GameState, Position, GHOST_DOOR_BURST_DURATION, GHOST_SPAWN_DURATION } from '../types';
import { GHOST_ENTRANCE_DOOR, GRID_CELL_SIZE, GRID_OFFSET, WALL_BODY_WIDTH } from './Collision';
// 静态地板/墙体绘制与离屏缓存都并入 FloorRenderer；hash01 为其导出的确定性哈希，本类剩余细节抖动共用
import { FloorRenderer, hash01 } from '../assets/FloorRenderer';
// 子弹/命中/金币飘字/暗角等视觉特效绘制独立成 EffectRenderer，本类仅转发调用
import { EffectRenderer } from '../assets/EffectRenderer';
// 房门/床铺/炮塔外观绘制独立成 SpawnRenderer；入场门与幽灵啃门借用其门几何/门框/门面画法
import { SpawnRenderer, DoorGeometry, DOOR_TIERS, DOOR_PANEL_HEIGHT, DOOR_SLAB_SIDE, DOOR_FACE_HEIGHT, DOOR_FRAME_POST_W } from '../assets/SpawnRenderer';
// 玩家与幽灵绘制独立成 CharacterRenderer（assets），本类仅转发
import { CharacterRenderer } from '../assets/CharacterRenderer';

// ── 左下角幽灵入场门（像素几何）────────────────────────────────────────
// 位置由 GHOST_ENTRANCE_DOOR（世界格坐标）换算：门洞中线即该格中心，墙线在它的 y 上。
// 门框/门板/门槛全部复用房门那套画法（同一副门柱与木质门面），只是没有等级与血条 ——
// 它不参与建造升级，是幽灵的出入口
const ENTRANCE_DOOR_CX = GRID_OFFSET.x + GHOST_ENTRANCE_DOOR.x * GRID_CELL_SIZE;
const ENTRANCE_DOOR_WALL_Y = GRID_OFFSET.y + GHOST_ENTRANCE_DOOR.y * GRID_CELL_SIZE;
const ENTRANCE_DOOR_HALF = 27; // 门洞半宽：与房门门板同量级（房门 baseHalf 约 27）
const ENTRANCE_DOOR_STUB_H = WALL_BODY_WIDTH + 10; // 两侧残墙高度：只剩半截，明显低于门洞顶
const ENTRANCE_DOOR_STUB_LEN = 96; // 右侧残墙长度：门前一段就断开（左段一直铺到画布左缘）
// 门被撞开后停在门柱旁：门板绕铰链横向压扁到只剩一条边，近似侧对镜头
const ENTRANCE_DOOR_OPEN_SCALE = 0.14;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  // 静态地板/墙体绘制与离屏缓存收在 FloorRenderer（assets），本类仅转发
  private floor: FloorRenderer;
  // 特效绘制（子弹/命中冲击/金币飘字/暗角）：绘制与飘字队列状态都收在 EffectRenderer（assets），本类仅转发
  private effects: EffectRenderer;
  // 房门/床铺/炮塔绘制收在 SpawnRenderer（assets），本类仅转发；入场门与幽灵啃门借用其门几何与画法
  private spawn: SpawnRenderer;
  // 玩家与幽灵绘制收在 CharacterRenderer（assets），本类仅转发；幽灵啃门经其借用同一 SpawnRenderer 实例
  private characters: CharacterRenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.floor = new FloorRenderer(this.ctx);
    this.effects = new EffectRenderer(this.ctx, canvas);
    this.spawn = new SpawnRenderer(this.ctx);
    this.characters = new CharacterRenderer(this.ctx, this.spawn);
  }
  // nowMs：引擎游戏时钟（GameLogic.getClockMs）。子弹/特效插值必须与引擎写入 startTime 时使用同一时钟，
  // 否则位置与命中结算会基准错位
  public render(state: GameState, nowMs: number) {
    this.clear();
    this.effects.updateGoldTexts(state, nowMs); // 金币增量检测：新入账时在玩家（睡觉即床中心）上方生成飘字
    this.floor.drawFloor(this.canvas.width, this.canvas.height); // 静态地板/墙体：直接贴预渲染缓存（FloorRenderer 构建），替代每帧重画
    this.drawGhostEntranceDoor(state, nowMs); // 左下角入场门：玩家第一次上床前就立在走廊尽头，等着被撞开
    this.spawn.drawDoors(state, nowMs);
    this.spawn.drawBeds(state);
    this.characters.drawPlayer(state, nowMs);
    this.spawn.drawTurrets(state, nowMs);
    this.effects.drawProjectiles(state, nowMs);
    this.characters.drawGhost(state, nowMs);
    this.effects.drawHitEffects(state, nowMs);
    this.effects.drawGoldTexts(nowMs); // 金币飘字与其余 Canvas 元素同一明暗层级（压在暗角之下）
    this.effects.drawVignette();
  }

  // 清空画布：每帧渲染前先擦除上一帧内容，避免残影
  private clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  
 
  // 入场门几何：与房门共用 DoorGeometry 结构，只是门洞不在房间轮廓上，位置由 GHOST_ENTRANCE_DOOR 常量给出
  private entranceDoorGeometry(): DoorGeometry {
    const cx = ENTRANCE_DOOR_CX;
    const wallY = ENTRANCE_DOOR_WALL_Y;
    const baseY = wallY + WALL_BODY_WIDTH / 2;
    const baseHalf = ENTRANCE_DOOR_HALF;
    const faceHalf = baseHalf - DOOR_SLAB_SIDE;
    return {
      cx,
      wallY,
      baseY,
      baseHalf,
      faceHalf,
      topHalf: faceHalf,
      point: (u, v) => ({ x: cx + u * faceHalf, y: baseY - DOOR_FACE_HEIGHT * v }),
    };
  }

  private drawGhostEntranceDoor(state: GameState, nowMs: number) {
    const g = this.entranceDoorGeometry();
    const ghost = state.ghost;
    const dormant = ghost.state === 'DORMANT';
    const sinceSpawn = nowMs - ghost.spawnTime;
    // 破门进度：0 = 门还关着，1 = 门板已甩到开完；尚未出场（spawnTime < 0）时恒为 0
    const raw = ghost.spawnTime < 0 ? 0 : Math.min(1, Math.max(0, sinceSpawn / GHOST_DOOR_BURST_DURATION));
    const open = raw * raw * (3 - 2 * raw); // smoothstep：起手最快、末段收住，像被撞开后顶到墙

    // 门洞暗面：门后是地图之外的黑，门板打开多少就露出多少
    const holeTop = g.baseY - DOOR_PANEL_HEIGHT;
    const hole = this.ctx.createLinearGradient(0, g.baseY, 0, holeTop);
    hole.addColorStop(0, '#05050a');
    hole.addColorStop(1, '#13131f');
    this.ctx.save();
    this.ctx.fillStyle = hole;
    this.ctx.fillRect(g.cx - g.baseHalf, holeTop, g.baseHalf * 2, DOOR_PANEL_HEIGHT);
    this.drawEntranceWallStubs(g);
    // 门框：与房门同一套画法（1 级门框配色，配一块木质门板）
    this.spawn.drawDoorFrame(g, 1);

    // 门板：关着 → 破门瞬间绕左门柱横向压扁（近似侧对镜头），停下后不再合上
    const hingeX = g.cx - g.baseHalf;
    const panelScale = 1 - (1 - ENTRANCE_DOOR_OPEN_SCALE) * open;
    this.ctx.save();
    this.ctx.translate(hingeX, 0);
    this.ctx.scale(panelScale, 1);
    this.ctx.translate(-hingeX, 0);
    this.spawn.drawDoorPanelBody(g, DOOR_TIERS.wood, false);
    this.spawn.drawWoodFace(g, DOOR_TIERS.wood);
    this.drawEntranceDoorClawMarks(g, 1 - open); // 门开得越大，门板上的爪痕越淡
    this.ctx.restore();
    this.ctx.restore();

    // 门缝/门洞里透出的红光：潜伏期按心跳节奏脉动（门后有东西在等），破门瞬间暴涨，出场后缓降到余辉
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 300);
    const afterglow = ghost.spawnTime < 0 ? 1 : Math.max(0, 1 - sinceSpawn / (GHOST_SPAWN_DURATION * 3));
    const healGlow = ghost.state === 'HEALING';
    this.drawEntranceLeak(g, dormant ? 0.3 + 0.3 * pulse : healGlow ? 0.1 : 0.14 + 0.5 * afterglow, open);

    // 幽灵缩在门洞里回血：门洞里那圈红光换成青绿色的治疗光，门楣上挂一行"回血中" ——
    // 这段时间打不着它，玩家该做的是攒钱升级，而不是对着门洞浪费火力
    if (healGlow) this.drawEntranceHealGlow(g, nowMs);

    // 破门瞬间的冲击环与门洞里涌出的红光：只在出场动画期间播
    if (ghost.spawnTime >= 0 && sinceSpawn < GHOST_SPAWN_DURATION) {
      this.drawEntranceBurst(g, sinceSpawn);
    }
  }

  // 回血期的门洞光：一圈青绿色的柔光（与幽灵身上失血的青绿光晕同色系）+ 门楣上的「回血中」标签，
  // 随心跳缓慢明暗，和潜伏期那道红色门缝光区分开
  private drawEntranceHealGlow(g: DoorGeometry, nowMs: number) {
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 260);
    const cy = g.baseY - DOOR_PANEL_HEIGHT * 0.45;
    const radius = 72 + 12 * pulse;

    this.ctx.save();
    const glow = this.ctx.createRadialGradient(g.cx, cy, 4, g.cx, cy, radius);
    glow.addColorStop(0, `rgba(90, 255, 210, ${0.32 + 0.12 * pulse})`);
    glow.addColorStop(0.55, `rgba(42, 208, 168, ${0.15 + 0.06 * pulse})`);
    glow.addColorStop(1, 'rgba(42, 208, 168, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(g.cx - radius, cy - radius, radius * 2, radius * 2);

    this.ctx.textAlign = 'center';
    this.ctx.font = 'bold 12px Arial';
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = 'rgba(6, 48, 38, 0.85)';
    this.ctx.fillStyle = '#c8fff0';
    this.ctx.strokeText('回血中', g.cx, g.baseY - DOOR_PANEL_HEIGHT - 8);
    this.ctx.fillText('回血中', g.cx, g.baseY - DOOR_PANEL_HEIGHT - 8);
    this.ctx.restore();
  }

  // 门洞两侧的残墙：一段低矮的砌体（砌体面 + 参差的崩塌断口 + 墙头受光亮线 + 墙脚暗边），
  // 让门洞看起来是长在墙上而不是凭空立在走廊里；左段一直铺到画布左缘，右段在门前一段就断开
  private drawEntranceWallStubs(g: DoorGeometry) {
    const bandY = g.wallY + WALL_BODY_WIDTH / 2; // 墙脚：与门板底边、门槛齐平
    const leftTo = g.cx - g.baseHalf - DOOR_FRAME_POST_W;
    const rightFrom = g.cx + g.baseHalf + DOOR_FRAME_POST_W;
    const rightEnd = rightFrom + ENTRANCE_DOOR_STUB_LEN;
    const segments: Array<[number, number, number]> = [
      [-8, leftTo, 311], // 左段：起点取在画布外，残墙看起来一直延伸出去
      [rightFrom, rightEnd, 353],
    ];

    segments.forEach(([x0, x1, seed]) => {
      // 崩塌断口：顶边按固定间距逐段取哈希起伏，像被砸剩下的墙头（逐帧稳定不闪）
      const step = 13;
      const top: Position[] = [];
      for (let x = x0; x <= x1 + 0.001; x += step) {
        const px = Math.min(x, x1);
        top.push({ x: px, y: bandY - ENTRANCE_DOOR_STUB_H + hash01(seed + Math.round(px / step), 7) * 7 });
      }

      // 砌体面：纵向渐变（上亮下暗），与房间墙体同一套光照
      const face = this.ctx.createLinearGradient(0, bandY - ENTRANCE_DOOR_STUB_H, 0, bandY);
      face.addColorStop(0, '#3c3c5a');
      face.addColorStop(0.55, '#2c2c44');
      face.addColorStop(1, '#1a1a28');
      this.ctx.beginPath();
      this.ctx.moveTo(top[0].x, bandY);
      top.forEach((p) => this.ctx.lineTo(p.x, p.y));
      this.ctx.lineTo(x1, bandY);
      this.ctx.closePath();
      this.ctx.fillStyle = face;
      this.ctx.fill();

      // 墙头受光：沿断口勾一道冷色亮线（与全场景左上主光源一致）
      this.ctx.beginPath();
      top.forEach((p, i) => (i === 0 ? this.ctx.moveTo(p.x, p.y) : this.ctx.lineTo(p.x, p.y)));
      this.ctx.lineJoin = 'round';
      this.ctx.strokeStyle = 'rgba(140, 142, 190, 0.3)';
      this.ctx.lineWidth = 1.4;
      this.ctx.stroke();

      // 墙脚暗边：残墙与地面交界处压暗
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      this.ctx.fillRect(x0, bandY - 1.5, x1 - x0, 1.5);
    });

    // 断口前的碎石：右段尽头散落三块，交代这堵墙是被砸塌的
    const rubble: Array<[number, number, number]> = [[rightEnd + 9, 3.6, 0], [rightEnd + 19, 2.6, 1], [rightEnd + 6, 2.2, 2]];
    rubble.forEach(([cx, size, i]) => {
      const cy = bandY - 1 - (i % 2) * 1.5;
      this.ctx.fillStyle = i === 1 ? '#4a4a68' : '#3b3b56';
      this.ctx.beginPath();
      this.ctx.moveTo(cx - size, cy + size * 0.7);
      this.ctx.lineTo(cx - size * 0.2, cy - size * 0.6);
      this.ctx.lineTo(cx + size, cy + size * 0.7);
      this.ctx.closePath();
      this.ctx.fill();
    });
  }

  // 门缝/门洞里透出的红光：门还基本关着时沿门板四边勾一道细亮红边、门口地面泛红，
  // 门开了则整片光从门洞漫到走廊上；另有门口一块地面光斑把这一角从暗角里拉出来，
  // 否则左下角本来就压在画布暗角里，门会黑得看不出形状
  private drawEntranceLeak(g: DoorGeometry, leak: number, open: number) {
    const holeTop = g.baseY - DOOR_PANEL_HEIGHT;
    const cx = g.cx;
    const cy = g.baseY - 16;
    const radius = 66 + 54 * open; // 门开得越大，漫出来的红光铺得越开

    this.ctx.save();
    const glow = this.ctx.createRadialGradient(cx, cy, 3, cx, cy, radius);
    glow.addColorStop(0, `rgba(255, 96, 72, ${0.5 * leak})`);
    glow.addColorStop(0.5, `rgba(216, 48, 38, ${0.18 * leak})`);
    glow.addColorStop(1, 'rgba(216, 48, 38, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // 门口地面光斑：横向铺开的暖色椭圆（把渐变圆压扁成贴地的光斑），照亮门前的走廊地面
    const poolR = 150;
    const poolCy = g.baseY - 44;
    this.ctx.save();
    this.ctx.translate(cx, poolCy);
    this.ctx.scale(1, 0.42);
    const pool = this.ctx.createRadialGradient(0, 0, 5, 0, 0, poolR);
    pool.addColorStop(0, `rgba(255, 138, 96, ${0.2 * leak})`);
    pool.addColorStop(0.55, `rgba(214, 78, 52, ${0.1 * leak})`);
    pool.addColorStop(1, 'rgba(214, 78, 52, 0)');
    this.ctx.fillStyle = pool;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, poolR, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();

    if (open < 0.5) {
      const seam = (1 - open * 2) * leak;
      this.ctx.strokeStyle = `rgba(255, 132, 104, ${0.55 * seam})`;
      this.ctx.lineWidth = 1.4;
      this.ctx.strokeRect(cx - g.baseHalf + 0.7, holeTop + 0.7, g.baseHalf * 2 - 1.4, DOOR_PANEL_HEIGHT - 1.4);
    }
    this.ctx.restore();
  }

  // 破门：门被撞开的一瞬自门口向外推出一圈贴地冲击环，门洞里同时涌出一团红光，
  // 两者都随出场进度衰减（与幽灵的钻出动画共用同一时钟）
  private drawEntranceBurst(g: DoorGeometry, sinceSpawn: number) {
    const p = Math.min(1, sinceSpawn / GHOST_SPAWN_DURATION);
    const burstT = Math.min(1, sinceSpawn / GHOST_DOOR_BURST_DURATION);

    this.ctx.save();
    // 地面冲击环：椭圆贴合地面，向外扩散并淡出
    const ringR = 24 + burstT * 104;
    this.ctx.strokeStyle = `rgba(255, 96, 72, ${0.5 * (1 - burstT)})`;
    this.ctx.lineWidth = 2 + 4 * (1 - burstT);
    this.ctx.beginPath();
    this.ctx.ellipse(g.cx, g.baseY - 8, ringR, ringR * 0.4, 0, 0, Math.PI * 2);
    this.ctx.stroke();

    // 门洞涌出的红光：出场前半段最亮，随后与幽灵一起淡去
    const flood = Math.max(0, 1 - p) * 0.5;
    const rad = 130;
    const floodGrad = this.ctx.createRadialGradient(g.cx, g.baseY - 12, 4, g.cx, g.baseY - 12, rad);
    floodGrad.addColorStop(0, `rgba(255, 74, 58, ${flood})`);
    floodGrad.addColorStop(1, 'rgba(255, 74, 58, 0)');
    this.ctx.fillStyle = floodGrad;
    this.ctx.fillRect(g.cx - rad, g.baseY - 12 - rad, rad * 2, rad * 2);
    this.ctx.restore();
  }

  // 门板上被门后的东西刨出的爪痕：三道斜向刮痕，调用方已套好门板变换（会随门板一起被压扁），
  // 门开得越大越淡 —— 让"门后有东西"这件事在潜伏期就有迹可循
  private drawEntranceDoorClawMarks(g: DoorGeometry, alpha: number) {
    this.ctx.save();
    this.ctx.globalAlpha = Math.max(0, alpha);
    this.ctx.lineCap = 'round';
    for (let k = -1; k <= 1; k++) {
      const a = g.point(-0.34 + k * 0.24, 0.13);
      const b = g.point(0.2 + k * 0.24, 0.6);
      this.ctx.beginPath();
      this.ctx.moveTo(a.x, a.y);
      this.ctx.quadraticCurveTo((a.x + b.x) / 2 + 4, (a.y + b.y) / 2, b.x, b.y);
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      this.ctx.lineWidth = 2.4;
      this.ctx.stroke();
      this.ctx.strokeStyle = 'rgba(255, 150, 130, 0.28)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

}
