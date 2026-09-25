import { GameState, Position, GHOST_SPAWN_DURATION } from '../types';
import { GRID_CELL_SIZE, GRID_OFFSET } from '../engine/Collision';
// hash01：确定性哈希（FloorRenderer 导出），啃门木屑定位共用
import { hash01 } from './FloorRenderer';
// roundRect 路径工具；并注入 SpawnRenderer 以借用门几何与啃门判定
import { roundRect, SpawnRenderer, DoorGeometry } from './SpawnRenderer';

// 前扑幅度（px）：出手时整个身体向上扑向门板，影子留在地面
const GHOST_ATTACK_LUNGE = 9;

// 角色绘制（玩家与幽灵）：只读 GameState 与引擎时钟，不回写游戏状态；
// 幽灵啃门的动作与落点特效依赖 SpawnRenderer 的门几何与站位判定（构造时注入同一实例）
export class CharacterRenderer {
  private ctx: CanvasRenderingContext2D;
  private spawn: SpawnRenderer; // 门几何/啃门判定的来源（与 Renderer 共享同一实例）
  private cellSize: number = GRID_CELL_SIZE; // 单个网格单元格的像素边长
  private gridOffset: Position = GRID_OFFSET; // 网格原点相对画布左上角的偏移（用于把场地居中）

  constructor(ctx: CanvasRenderingContext2D, spawn: SpawnRenderer) {
    this.ctx = ctx;
    this.spawn = spawn;
  }

  // nowMs：引擎游戏时钟（GameLogic.getClockMs），呼吸起伏/眨眼/睡觉 Zzz 与全局时钟同源，暂停时同步冻结
  public drawPlayer(state: GameState, nowMs: number) {
    // 睡觉时躺到正在睡觉的那张床上
    const sleepingBed = state.beds.find((bed) => bed.isSleeping);

    this.ctx.save();

    if (sleepingBed) {
        const bedX = this.gridOffset.x + sleepingBed.position.x * this.cellSize + this.cellSize / 2;
        const bedY = this.gridOffset.y + sleepingBed.position.y * this.cellSize + this.cellSize / 2;
        // 熟睡呼吸：被面随引擎时钟轻微起伏
        const breath = Math.sin((nowMs / 1000) * 1.8) * 0.5;

        // 被子：暖红布面纵向渐变（受光在上），圆角方被盖住身体
        const quilt = this.ctx.createLinearGradient(bedX, bedY - 5, bedX, bedY + 17);
        quilt.addColorStop(0, '#ff7a63');
        quilt.addColorStop(0.5, '#e74c3c');
        quilt.addColorStop(1, '#a93226');
        this.ctx.fillStyle = quilt;
        roundRect(this.ctx, bedX - 18, bedY - 5, 36, 22, 4);
        this.ctx.fill();

        // 被面折痕：两道随呼吸轻晃的弧线
        this.ctx.strokeStyle = 'rgba(70, 8, 4, 0.4)';
        this.ctx.lineWidth = 1.2;
        this.ctx.beginPath();
        this.ctx.moveTo(bedX - 12, bedY + 3 + breath);
        this.ctx.quadraticCurveTo(bedX, bedY + 5.5 + breath, bedX + 12, bedY + 3 + breath);
        this.ctx.moveTo(bedX - 8.5, bedY + 10.5 - breath);
        this.ctx.quadraticCurveTo(bedX, bedY + 13 - breath, bedX + 8.5, bedY + 10.5 - breath);
        this.ctx.stroke();

        // 被沿高光：上缘一道柔亮窄边，像被面翻边
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        roundRect(this.ctx, bedX - 15, bedY - 4, 30, 3, 1.5);
        this.ctx.fill();

        // 头（枕头上）：闭眼熟睡
        this.drawPlayerHead(bedX, bedY - 13, true, nowMs);

        // 睡觉浮起的 Zzz：一大一小两颗字母，随引擎时钟交替漂浮并明暗呼吸（暂停时冻结）
        const zPhase = Math.sin(nowMs / 500);
        this.ctx.globalAlpha = 0.6 + 0.4 * (zPhase * 0.5 + 0.5);
        this.ctx.fillStyle = '#e8f0ff';
        this.ctx.font = 'bold 14px Arial';
        this.ctx.textAlign = 'left';
        this.ctx.fillText('Z', bedX + 14, bedY - 20 + zPhase * 5);
        this.ctx.font = 'bold 10px Arial';
        this.ctx.fillText('z', bedX + 21, bedY - 26 + zPhase * 3.5);
        this.ctx.globalAlpha = 1;
    } else {
        // 站立/移动的小人：跟随玩家位置
        const { x, y } = state.player.position;
        const px = this.gridOffset.x + x * this.cellSize + this.cellSize / 2;
        const py = this.gridOffset.y + y * this.cellSize + this.cellSize / 2;
        // 呼吸起伏：腿以上的部位随引擎时钟轻微上下浮动
        const breath = Math.sin((nowMs / 1000) * 2.4) * 1.2;

        // 影子：径向渐变的柔和落地影
        const shadow = this.ctx.createRadialGradient(px, py + 22, 2, px, py + 22, 15);
        shadow.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
        shadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = shadow;
        this.ctx.beginPath();
        this.ctx.ellipse(px, py + 22, 15, 5, 0, 0, Math.PI * 2);
        this.ctx.fill();

        // 双腿：深色裤管，两脚略微分开
        this.ctx.fillStyle = '#4a3524';
        roundRect(this.ctx, px - 6.5, py + 12, 5.5, 9, 2.5);
        this.ctx.fill();
        roundRect(this.ctx, px + 1, py + 12, 5.5, 9, 2.5);
        this.ctx.fill();

        // 上身与头随呼吸整体起伏
        this.ctx.save();
        this.ctx.translate(0, breath);

        // 双臂：袖管垂在身体两侧，末端露出小手
        this.ctx.fillStyle = '#c9661a';
        roundRect(this.ctx, px - 11.5, py - 1, 5, 12, 2.5);
        this.ctx.fill();
        roundRect(this.ctx, px + 6.5, py - 1, 5, 12, 2.5);
        this.ctx.fill();
        this.ctx.fillStyle = '#eec06a';
        this.ctx.beginPath();
        this.ctx.arc(px - 9, py + 10, 2, 0, Math.PI * 2);
        this.ctx.arc(px + 9, py + 10, 2, 0, Math.PI * 2);
        this.ctx.fill();

        // 躯干：橙色卫衣，纵向渐变 + 下摆压暗 + 拉链与肩部高光
        const hoodie = this.ctx.createLinearGradient(px, py - 4, px, py + 14);
        hoodie.addColorStop(0, '#f59033');
        hoodie.addColorStop(0.55, '#e67e22');
        hoodie.addColorStop(1, '#b85c0f');
        this.ctx.fillStyle = hoodie;
        roundRect(this.ctx, px - 8.5, py - 4, 17, 16, 5.5);
        this.ctx.fill();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        roundRect(this.ctx, px - 8.5, py + 8, 17, 4, 2);
        this.ctx.fill();
        this.ctx.strokeStyle = 'rgba(90, 45, 5, 0.5)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(px, py - 2.5);
        this.ctx.lineTo(px, py + 8);
        this.ctx.stroke();
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        roundRect(this.ctx, px - 6.5, py - 2.5, 3.5, 8, 1.75);
        this.ctx.fill();

        // 头：睁眼状态，内部按引擎时钟周期眨眼
        this.drawPlayerHead(px, py - 12, false, nowMs);

        this.ctx.restore();
    }

    this.ctx.restore();
  }

  // 玩家头部：暖肤径向渐变 + 深棕短发 + 五官；eyesClosed 为睡眠态闭眼，否则按引擎时钟周期眨眼；
  // cx/cy 为头部圆心，由站立/躺床两种姿态共用
  private drawPlayerHead(cx: number, cy: number, eyesClosed: boolean, nowMs: number) {
    // 颈部阴影：头与衣领/枕头衔接处的暗部
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy + 8, 5, 2.5, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // 脸部：左上受光的暖肤径向渐变（光源与场景顶光一致）
    const skin = this.ctx.createRadialGradient(cx - 3, cy - 3.5, 1.5, cx, cy, 9.5);
    skin.addColorStop(0, '#ffe9c0');
    skin.addColorStop(0.6, '#f7cd7a');
    skin.addColorStop(1, '#d9a13f');
    this.ctx.fillStyle = skin;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    this.ctx.fill();

    // 耳朵：两侧各一枚圆耳
    this.ctx.fillStyle = '#eec06a';
    this.ctx.beginPath();
    this.ctx.arc(cx - 8.6, cy + 0.5, 2, 0, Math.PI * 2);
    this.ctx.arc(cx + 8.6, cy + 0.5, 2, 0, Math.PI * 2);
    this.ctx.fill();

    // 短发：深棕发盖 + 额前锯齿刘海 + 发顶高光
    const hair = this.ctx.createLinearGradient(cx, cy - 11, cx, cy - 1);
    hair.addColorStop(0, '#6b4526');
    hair.addColorStop(1, '#3d2513');
    this.ctx.fillStyle = hair;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy - 1.2, 9.2, Math.PI, 0);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.beginPath();
    this.ctx.moveTo(cx - 9.2, cy - 1.2);
    this.ctx.quadraticCurveTo(cx - 6, cy + 1.6, cx - 3.2, cy - 1.4);
    this.ctx.quadraticCurveTo(cx - 0.4, cy + 2.2, cx + 2.6, cy - 1.4);
    this.ctx.quadraticCurveTo(cx + 5.6, cy + 1.8, cx + 9.2, cy - 1.2);
    this.ctx.lineTo(cx + 9.2, cy - 3.4);
    this.ctx.lineTo(cx - 9.2, cy - 3.4);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255, 214, 160, 0.3)';
    this.ctx.lineWidth = 1.3;
    this.ctx.beginPath();
    this.ctx.arc(cx - 1, cy - 2, 6, Math.PI * 1.12, Math.PI * 1.75);
    this.ctx.stroke();

    // 眼睛：睡眠（或周期眨眼）时画两道闭眼睫毛弧，否则画眼白 + 瞳孔 + 高光
    const blinking = !eyesClosed && (nowMs / 1000) % 3.4 < 0.13;
    if (eyesClosed || blinking) {
      this.ctx.strokeStyle = '#5a3a1a';
      this.ctx.lineWidth = 1.6;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.arc(cx - 3.6, cy + 0.2, 2.4, Math.PI * 0.18, Math.PI * 0.82);
      this.ctx.arc(cx + 3.6, cy + 0.2, 2.4, Math.PI * 0.18, Math.PI * 0.82);
      this.ctx.stroke();
    } else {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.ellipse(cx - 3.6, cy + 0.4, 2.6, 2.9, 0, 0, Math.PI * 2);
      this.ctx.ellipse(cx + 3.6, cy + 0.4, 2.6, 2.9, 0, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = '#3a2410';
      this.ctx.beginPath();
      this.ctx.arc(cx - 3.4, cy + 0.6, 1.5, 0, Math.PI * 2);
      this.ctx.arc(cx + 3.8, cy + 0.6, 1.5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(cx - 3.9, cy - 0.2, 0.6, 0, Math.PI * 2);
      this.ctx.arc(cx + 3.3, cy - 0.2, 0.6, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // 腮红 + 嘴：睡眠时小圆嘴，清醒时一抹浅笑
    this.ctx.fillStyle = 'rgba(255, 110, 80, 0.22)';
    this.ctx.beginPath();
    this.ctx.ellipse(cx - 5.6, cy + 3.2, 2, 1.3, 0, 0, Math.PI * 2);
    this.ctx.ellipse(cx + 5.6, cy + 3.2, 2, 1.3, 0, 0, Math.PI * 2);
    this.ctx.fill();
    if (eyesClosed) {
      this.ctx.fillStyle = 'rgba(150, 75, 35, 0.9)';
      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy + 4.6, 1.4, 1.1, 0, 0, Math.PI * 2);
      this.ctx.fill();
    } else {
      this.ctx.strokeStyle = '#a05a28';
      this.ctx.lineWidth = 1.4;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.arc(cx, cy + 3.4, 2.6, Math.PI * 0.22, Math.PI * 0.78);
      this.ctx.stroke();
    }
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
