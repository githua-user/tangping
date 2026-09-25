import { GameState, Position } from '../types';
import { GRID_CELL_SIZE, GRID_OFFSET } from '../utils/Collision';
// roundRect 路径工具（SpawnRenderer 导出）
import { roundRect } from './SpawnRenderer';

// 玩家绘制（睡觉躺床 / 站立移动两种姿态）：只读 GameState 与引擎时钟，不回写游戏状态
export class PlayerRenderer {
  private ctx: CanvasRenderingContext2D;
  private cellSize: number = GRID_CELL_SIZE; // 单个网格单元格的像素边长
  private gridOffset: Position = GRID_OFFSET; // 网格原点相对画布左上角的偏移（用于把场地居中）

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
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
}
