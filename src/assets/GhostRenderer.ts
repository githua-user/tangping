import { GameState, Position, GHOST_DOOR_BURST_DURATION, GHOST_SPAWN_DURATION } from '../types';
import { GHOST_ENTRANCE_DOOR, GRID_CELL_SIZE, GRID_OFFSET, WALL_BODY_WIDTH } from '../utils/Collision';
// hash01：确定性哈希（FloorRenderer 导出），啃门木屑定位共用
import { hash01 } from './FloorRenderer';
// roundRect 路径工具；并注入 SpawnRenderer 以借用门几何、啃门判定与门框/门面画法
import { roundRect, SpawnRenderer, DoorGeometry, DOOR_TIERS, DOOR_PANEL_HEIGHT, DOOR_SLAB_SIDE, DOOR_FACE_HEIGHT, DOOR_FRAME_POST_W } from './SpawnRenderer';

// 前扑幅度（px）：出手时整个身体向上扑向门板，影子留在地面
const GHOST_ATTACK_LUNGE = 9;

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

// 幽灵绘制（含左下角入场门：潜伏期红光 / 破门动画 / 回血期门洞光）：只读 GameState 与引擎时钟，不回写游戏状态；
// 啃门的动作与落点特效依赖 SpawnRenderer 的门几何与站位判定（构造时注入同一实例）
export class GhostRenderer {
  private ctx: CanvasRenderingContext2D;
  private spawn: SpawnRenderer; // 门几何/啃门判定的来源（与 Renderer 共享同一实例）
  private cellSize: number = GRID_CELL_SIZE; // 单个网格单元格的像素边长
  private gridOffset: Position = GRID_OFFSET; // 网格原点相对画布左上角的偏移（用于把场地居中）

  constructor(ctx: CanvasRenderingContext2D, spawn: SpawnRenderer) {
    this.ctx = ctx;
    this.spawn = spawn;
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

  // 左下角入场门：玩家第一次上床前就立在走廊尽头，等着被撞开 ——
  // 潜伏期门缝透红光（按心跳脉动）、破门瞬间门板甩开并推出冲击环、回血期门洞里换成青绿色治疗光
  public drawGhostEntranceDoor(state: GameState, nowMs: number) {
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

  // nowMs：引擎游戏时钟（GameLogic.getClockMs），浮动/尾部波纹/光晕脉冲与全局时钟同源
  public drawGhost(state: GameState, nowMs: number) {
    const ghost = state.ghost;
    // 潜伏期：幽灵还压在左下角的入场门后，画面上只有那扇门的红光（见 drawGhostEntranceDoor）
    if (ghost.state === 'DORMANT') return;

    const { x, y } = ghost.position;
    const px = this.gridOffset.x + x * this.cellSize + this.cellSize / 2;
    const py = this.gridOffset.y + y * this.cellSize + this.cellSize / 2;

    const t = nowMs / 1000;
    const hpPercent = Math.max(0, ghost.health / ghost.maxHealth);
    const isAttacking = ghost.state === 'ATTACKING';
    const retreating = ghost.state === 'RETREATING';
    const healing = ghost.state === 'HEALING';
    // 破门出场 / 回血后再出场：由小长大钻出门洞的过渡（0 → 1，过渡期间引擎侧位置不动）。
    // 用 emergeTime 而不是 spawnTime：入场门只被撞开一次，而鬼每次从门洞里出来都该播这一段
    const spawnProgress = ghost.emergeTime < 0 ? 1 : Math.min(1, Math.max(0, (nowMs - ghost.emergeTime) / GHOST_SPAWN_DURATION));
    const emerging = spawnProgress < 1;
    // 正在啃门时的攻击动作：出手强度驱动前扑 + 落点特效（走到门口的路上不播）
    const gnawDoor = emerging ? undefined : this.spawn.gnawingDoor(state);
    const swing = gnawDoor ? this.spawn.attackSwing(nowMs) : 0;
    const lunging = swing > 0;

    // 悬浮起伏与尾部波纹相位：由引擎时钟推导的浮动偏移量
    const bob = Math.sin(t * 2.2) * 2.5;
    const wob = Math.sin(t * 4.5) * 2;
    const cy = py - 4 + bob;

    // 状态配色：啃门时最凶（亮红），追击次之；半血逃跑转成失血的青紫，缩门回血转成治疗青绿 ——
    // 一眼分清"该补刀"和"打不着"
    const auraColor = healing ? '#2ad0a8' : retreating ? '#8f6bd8' : isAttacking ? '#ff2d2d' : '#e74c3c';
    const eyeColor = healing ? '#a8ffe6' : '#ffd93b';

    this.ctx.save();

    if (emerging) {
      // 破门而出：幽灵自门洞里钻出来 —— 一边向上浮一边由小长大（近似从门里朝镜头逼近的透视），
      // 透明度同步渐显；变换以幽灵自身位置为中心，出场期间引擎侧位置不动，全部动感都在这段过渡里
      const p = 1 - Math.pow(1 - spawnProgress, 3); // ease-out：起手冲得快、末段收稳
      const scale = 0.55 + 0.45 * p;
      this.ctx.globalAlpha = 0.15 + 0.85 * p;
      this.ctx.translate(px, py + (1 - p) * 26);
      this.ctx.scale(scale, scale);
      this.ctx.translate(-px, -py);
    } else if (healing) {
      // 缩进门洞回血：整体收小一档、压暗一点，读作"钻进门口那块黑里去了"
      this.ctx.globalAlpha = 0.92;
      this.ctx.translate(px, py);
      this.ctx.scale(0.86, 0.86);
      this.ctx.translate(-px, -py);
    }

    // 地面影子：留在地面随悬浮高度呼吸缩放
    this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
    this.ctx.beginPath();
    this.ctx.ellipse(px, py + 22, 19 - bob, 4.5, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // 出手前扑：影子留在地面，身体（连同光晕、血条）整体向上扑向门板
    if (lunging) {
      this.ctx.save();
      this.ctx.translate(0, -GHOST_ATTACK_LUNGE * swing);
    }

    // 幽灵身后的脉动光晕：半径随时间周期脉动
    const pulse = 1 + Math.sin(t * 3) * 0.08;
    const auraR = 38 * pulse;
    const aura = this.ctx.createRadialGradient(px, cy, 8, px, cy, auraR);
    if (healing) {
        aura.addColorStop(0, 'rgba(42,208,168,0.5)');
        aura.addColorStop(1, 'rgba(42,208,168,0)');
    } else if (retreating) {
        aura.addColorStop(0, 'rgba(143,107,216,0.44)');
        aura.addColorStop(1, 'rgba(143,107,216,0)');
    } else if (isAttacking) {
        aura.addColorStop(0, 'rgba(255,45,45,0.48)');
        aura.addColorStop(1, 'rgba(255,45,45,0)');
    } else {
        aura.addColorStop(0, 'rgba(231,76,60,0.35)');
        aura.addColorStop(1, 'rgba(231,76,60,0)');
    }
    this.ctx.fillStyle = aura;
    this.ctx.beginPath();
    this.ctx.arc(px, cy, auraR, 0, Math.PI * 2);
    this.ctx.fill();

    // 手臂与尖爪：先于身体绘制，位于身体后方
    this.ctx.strokeStyle = '#8e1f14';
    this.ctx.lineCap = 'round';
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.moveTo(px - 17, cy + 2);
    this.ctx.quadraticCurveTo(px - 26, cy + 4, px - 25, cy + 11);
    this.ctx.moveTo(px + 17, cy + 2);
    this.ctx.quadraticCurveTo(px + 26, cy + 4, px + 25, cy + 11);
    this.ctx.stroke();
    this.ctx.lineWidth = 1.6;
    this.ctx.beginPath();
    this.ctx.moveTo(px - 25, cy + 11);
    this.ctx.lineTo(px - 28, cy + 15);
    this.ctx.moveTo(px - 25, cy + 11);
    this.ctx.lineTo(px - 24, cy + 16);
    this.ctx.moveTo(px + 25, cy + 11);
    this.ctx.lineTo(px + 28, cy + 15);
    this.ctx.moveTo(px + 25, cy + 11);
    this.ctx.lineTo(px + 24, cy + 16);
    this.ctx.stroke();

    // 身体轮廓：贝塞尔圆顶 + 动态波浪裙摆
    const traceBody = () => {
        this.ctx.beginPath();
        this.ctx.moveTo(px - 20, cy - 4);
        this.ctx.bezierCurveTo(px - 20, cy - 27, px + 20, cy - 27, px + 20, cy - 4);
        this.ctx.bezierCurveTo(px + 22, cy + 4, px + 21, cy + 10, px + 19, cy + 14);
        this.ctx.quadraticCurveTo(px + 14, cy + 23 + wob, px + 9.5, cy + 14);
        this.ctx.quadraticCurveTo(px + 5, cy + 24 - wob, px, cy + 14);
        this.ctx.quadraticCurveTo(px - 5, cy + 23 + wob, px - 9.5, cy + 14);
        this.ctx.quadraticCurveTo(px - 14, cy + 24 - wob, px - 19, cy + 14);
        this.ctx.bezierCurveTo(px - 21, cy + 10, px - 22, cy + 4, px - 20, cy - 4);
        this.ctx.closePath();
    };

    traceBody();
    const bodyGrad = this.ctx.createRadialGradient(px - 7, cy - 16, 3, px, cy, 36);
    bodyGrad.addColorStop(0, '#ff9a8a');
    bodyGrad.addColorStop(0.45, '#d64533');
    bodyGrad.addColorStop(1, '#7e1a10');
    this.ctx.shadowColor = auraColor;
    this.ctx.shadowBlur = isAttacking ? 28 : 20;
    this.ctx.fillStyle = bodyGrad;
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    // 身体内部细节（裁剪进身体轮廓内）：圆顶高光
    this.ctx.save();
    traceBody();
    this.ctx.clip();

    const gloss = this.ctx.createRadialGradient(px - 8, cy - 18, 1, px - 8, cy - 18, 14);
    gloss.addColorStop(0, 'rgba(255,255,255,0.35)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    this.ctx.fillStyle = gloss;
    this.ctx.fillRect(px - 40, cy - 40, 80, 80);

    this.ctx.restore();

    // 怒眉：两道下压的深色眉毛
    this.ctx.strokeStyle = '#4a0d06';
    this.ctx.lineCap = 'round';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.moveTo(px - 15, cy - 17);
    this.ctx.quadraticCurveTo(px - 10, cy - 16, px - 4.5, cy - 12.5);
    this.ctx.moveTo(px + 15, cy - 17);
    this.ctx.quadraticCurveTo(px + 10, cy - 16, px + 4.5, cy - 12.5);
    this.ctx.stroke();

    // 发光眼睛：黄色发光椭圆眼
    this.ctx.shadowColor = eyeColor;
    this.ctx.shadowBlur = 10;
    this.ctx.fillStyle = eyeColor;
    this.ctx.beginPath();
    this.ctx.ellipse(px - 8, cy - 8.5, 4.6, 5.8, -0.12, 0, Math.PI * 2);
    this.ctx.ellipse(px + 8, cy - 8.5, 4.6, 5.8, 0.12, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    // 竖瞳：眼睛中央细长的深色瞳孔
    this.ctx.fillStyle = '#1a0505';
    this.ctx.beginPath();
    this.ctx.ellipse(px - 8, cy - 8.5, 1.3, 3.4, 0, 0, Math.PI * 2);
    this.ctx.ellipse(px + 8, cy - 8.5, 1.3, 3.4, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // 嘴巴：按幽灵状态绘制咆哮或冷笑
    if (isAttacking) {
        // 攻击状态：张口咆哮 + 獠牙
        this.ctx.fillStyle = '#2b0500';
        this.ctx.beginPath();
        this.ctx.ellipse(px, cy + 4.5, 7.5, 6, 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#fdfdf0';
        this.ctx.beginPath();
        this.ctx.moveTo(px - 5, cy + 0.5);
        this.ctx.lineTo(px - 1.8, cy + 0.5);
        this.ctx.lineTo(px - 3.4, cy + 4.4);
        this.ctx.moveTo(px + 5, cy + 0.5);
        this.ctx.lineTo(px + 1.8, cy + 0.5);
        this.ctx.lineTo(px + 3.4, cy + 4.4);
        this.ctx.closePath();
        this.ctx.fill();
    } else {
        // 平时状态：阴笑嘴角 + 小獠牙
        this.ctx.strokeStyle = '#5c1206';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(px - 7, cy + 1.5);
        this.ctx.quadraticCurveTo(px, cy + 6.5, px + 7, cy + 1.5);
        this.ctx.stroke();
        this.ctx.fillStyle = '#fdfdf0';
        this.ctx.beginPath();
        this.ctx.moveTo(px - 4.5, cy + 2.5);
        this.ctx.lineTo(px - 1.8, cy + 2.5);
        this.ctx.lineTo(px - 3.1, cy + 5.4);
        this.ctx.moveTo(px + 4.5, cy + 2.5);
        this.ctx.lineTo(px + 1.8, cy + 2.5);
        this.ctx.lineTo(px + 3.1, cy + 5.4);
        this.ctx.closePath();
        this.ctx.fill();
    }

    // 血条：幽灵头顶的耐久条，随血量比例变色
    const barW = 46;
    const barH = 5;
    const barX = px - barW / 2;
    const barY = py - 38;
    this.ctx.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(this.ctx, barX - 1.5, barY - 1.5, barW + 3, barH + 3, 3.5);
    this.ctx.fill();
    if (hpPercent > 0) {
        this.ctx.fillStyle = hpPercent > 0.5 ? '#2ecc71' : hpPercent > 0.25 ? '#f1c40f' : '#e74c3c';
        roundRect(this.ctx, barX, barY, barW * hpPercent, barH, 2.5);
        this.ctx.fill();
        this.ctx.fillStyle = 'rgba(255,255,255,0.35)';
        roundRect(this.ctx, barX, barY, barW * hpPercent, barH / 2, 2.5);
        this.ctx.fill();
    }

    // 半血逃跑：头顶闪一个"！" —— 这几秒是唯一能补刀的窗口，必须一眼可读
    if (retreating) {
        const blink = 0.55 + 0.45 * Math.sin(t * 9);
        this.ctx.save();
        this.ctx.globalAlpha = 0.45 + 0.55 * blink;
        this.ctx.textAlign = 'center';
        this.ctx.font = 'bold 18px Arial';
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = 'rgba(46, 12, 78, 0.9)';
        this.ctx.strokeText('！', px, barY - 8);
        this.ctx.fillStyle = '#f0dcff';
        this.ctx.fillText('！', px, barY - 8);
        this.ctx.restore();
    }

    // 回血中：血条右端标一个 +，头顶浮起几粒上飘的治疗碎光
    if (healing) {
        this.ctx.save();
        this.ctx.fillStyle = '#7dffd4';
        this.ctx.font = 'bold 13px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('+', barX + barW + 9, barY + barH);
        for (let i = 0; i < 4; i++) {
            const p = (t * 0.55 + i / 4) % 1;
            const mx = px - 14 + i * 9.5 + Math.sin(t * 2 + i) * 2.5;
            const my = cy + 16 - p * 44;
            this.ctx.globalAlpha = (1 - p) * 0.85;
            this.ctx.fillStyle = '#9dffe2';
            this.ctx.beginPath();
            this.ctx.arc(mx, my, 2.1 - p * 0.9, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.restore();
    }

    if (lunging) this.ctx.restore(); // 收掉前扑位移

    // 落点特效画在幽灵之后（压在最上层）：抓痕与碎屑落在门板正面，正好盖住扑上去的身体上沿
    if (gnawDoor) this.drawGhostClawStrike(this.spawn.doorGeometry(gnawDoor), swing);

    this.ctx.restore();
  }

  // 幽灵啃门的落点特效：门面上被抓出的三道亮痕 + 接触点白光 + 溅出的木屑，
  // 强度全部跟着出手强度 swing 走，一个周期一次"抓下去"的节奏
  private drawGhostClawStrike(g: DoorGeometry, swing: number) {
    if (swing <= 0.02) return;
    const cx = g.cx;
    const cy = g.baseY - 12; // 接触点：门板下部（幽灵正对着的位置）

    this.ctx.save();

    // 接触点白光：抓上去的一瞬亮起
    const flashR = 8 + 14 * swing;
    const flash = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, flashR);
    flash.addColorStop(0, `rgba(255, 240, 218, ${0.75 * swing})`);
    flash.addColorStop(0.5, `rgba(255, 132, 92, ${0.4 * swing})`);
    flash.addColorStop(1, 'rgba(255, 90, 60, 0)');
    this.ctx.fillStyle = flash;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, flashR, 0, Math.PI * 2);
    this.ctx.fill();

    // 三道抓痕：自接触点向上甩出的三道弧（左偏 / 居中 / 右偏），亮芯压在深色刮槽上
    this.ctx.lineCap = 'round';
    const len = 16 + 9 * swing;
    for (let k = -1; k <= 1; k++) {
      const from = { x: cx - 6 - k * 8, y: cy + 6 };
      const to = { x: cx + k * 15, y: cy - len };
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.quadraticCurveTo(cx + k * 4, cy - len * 0.5, to.x, to.y);
      this.ctx.strokeStyle = `rgba(0, 0, 0, ${0.5 * swing})`;
      this.ctx.lineWidth = 3.4;
      this.ctx.stroke();
      this.ctx.strokeStyle = `rgba(255, 216, 188, ${0.7 * swing})`;
      this.ctx.lineWidth = 1.2;
      this.ctx.stroke();
    }

    // 溅出的木屑：自接触点向外甩开的小碎块（逐块哈希定位，逐帧稳定），出手越猛飞得越远、淡得越快
    const prog = Math.min(1, swing * 1.6);
    for (let i = 0; i < 7; i++) {
      const ang = -Math.PI * 0.5 + (hash01(i, 71) - 0.5) * 2.8;
      const dist = (9 + hash01(i, 73) * 22) * prog;
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist + 12 * prog * prog; // 略带上抛后下坠
      const size = 1.4 + hash01(i, 79) * 1.8;
      this.ctx.fillStyle = `rgba(196, 172, 138, ${0.7 * Math.max(0, 1 - prog)})`;
      this.ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }

    this.ctx.restore();
  }
}
