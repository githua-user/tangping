import { GameState, Position, Door, BED_MAX_LEVEL, DOOR_MAX_LEVEL } from '../types';
import { GHOST_ATTACK_OFFSET_Y, GRID_CELL_SIZE, GRID_OFFSET, ROOM_ORIGINS, ROOM_OUTLINES, ROOM_DOOR_GAP, WALL_BODY_WIDTH, WALL_LEAN_FRONT, roomIndexOf } from '../utils/Collision';
// hash01：确定性哈希（FloorRenderer 导出），门面木纹/残段锯齿/木屑等扰动共用
import { hash01 } from './FloorRenderer';

// 门板高度由南墙抬升量推导：南墙顶面在墙线之上 WALL_LEAN_FRONT，而门板底边落在墙带外沿
// （墙线之下 半个砖身宽），再加上顶缘高光的外扩量，门板顶边正好与墙顶面齐平；
// 改 WALL_LEAN_FRONT 时门板自动跟随，不会从墙里冒出来或陷进去
export const DOOR_PANEL_HEIGHT = Math.round(WALL_LEAN_FRONT + WALL_BODY_WIDTH / 2 + 4.5);
const DOOR_PANEL_TOP_INSET = 0; // 顶边每侧内收量（0 = 侧边与墙面平行；调大即重新做出透视收拢）
export const DOOR_FRAME_POST_W = 12; // 门柱宽：与砖身带宽同量级，正好盖住墙在门洞处的断面
// 门板厚度：门板不是贴在墙上的平面色块，而是一块立在门洞里的板 —— 顶部留出可见顶面（与墙顶面同样受光）、
// 左右各留一条板厚侧面（左受光、右背光），正面（材质面）因此向内收进，
// 与墙体「立面 + 顶面 + 受光/背光棱」的画法共用同一套立体语言
const DOOR_SLAB_TOP = 4;
export const DOOR_SLAB_SIDE = 1.5;
export const DOOR_FACE_HEIGHT = DOOR_PANEL_HEIGHT - DOOR_SLAB_TOP; // 正面（材质面）高度

// 门框柱头压顶的颜色（按等级 1~5 取一档）：石青 → 铁灰 → 亮钢 → 金，升级时门框也一起变化
const DOOR_FRAME_TRIM = ['#8282ac', '#8b96a0', '#9aa5ad', '#b6c0c7', '#e8c23c'];

// 幽灵啃门的攻击动作周期（ms）：幽灵前扑、门面抓痕、门板抖动共用这条相位
const GHOST_ATTACK_CYCLE = 760;

// 床铺外观分档（1~5 级）：床架/床垫/枕头/被面配色，逐级加件（木板床 → 单人床 → 舒适床 → 软床 → 豪华床）：
// glow 为最高档的床体暖光晕，其余档位留空
const BED_TIERS = [
  { frame: '#6b4a2f', frameLit: '#8a6340', mattress: '#e3d9c6', mattressDark: '#b9ab90', pillow: '#f2efe6', quilt: '#d8cfba', quiltDark: '#b09f83', glow: '' },
  { frame: '#5d4037', frameLit: '#7d5747', mattress: '#3498db', mattressDark: '#20648f', pillow: '#ecf0f1', quilt: '#5dade2', quiltDark: '#2e86c1', glow: '' },
  { frame: '#4a5560', frameLit: '#6d7a86', mattress: '#2980b9', mattressDark: '#1a5276', pillow: '#f7fbfe', quilt: '#5499c7', quiltDark: '#2874a6', glow: '' },
  { frame: '#3f4a52', frameLit: '#5f6d77', mattress: '#7d3c98', mattressDark: '#4a235a', pillow: '#fdf6ff', quilt: '#a569bd', quiltDark: '#7d3c98', glow: '' },
  { frame: '#8a6a1f', frameLit: '#e8c23c', mattress: '#b3243c', mattressDark: '#7b1526', pillow: '#fff7e2', quilt: '#e2603f', quiltDark: '#a8361f', glow: 'rgba(241, 196, 15, 0.5)' },
];

// 门板材质配色（按等级切换：1 木门 → 2 加固木门 → 3 铁门 → 4 重铁门 → 5 金门；
// 1-2 级共用木质底色，靠横向铁箍区分，3-4 级共用铁质底色，靠加强筋与铆钉数量区分）：
// dark/base/light 为门面纵向渐变三档，lit/shade 为受光/背光棱线，text 为等级铭牌文字色
export const DOOR_TIERS = {
  wood: { dark: '#3d2718', base: '#5d4037', light: '#7d5949', lit: 'rgba(255, 214, 170, 0.5)', shade: 'rgba(0, 0, 0, 0.5)', text: '#f6e2c8' },
  iron: { dark: '#4b5255', base: '#7f8c8d', light: '#a9b3b4', lit: 'rgba(255, 255, 255, 0.45)', shade: 'rgba(0, 0, 0, 0.45)', text: '#f0f5f6' },
  heavy: { dark: '#3f4547', base: '#6d7779', light: '#9aa4a6', lit: 'rgba(255, 255, 255, 0.4)', shade: 'rgba(0, 0, 0, 0.5)', text: '#f0f5f6' },
  gold: { dark: '#a4760a', base: '#f1c40f', light: '#ffe98a', lit: 'rgba(255, 250, 210, 0.9)', shade: 'rgba(90, 55, 0, 0.5)', text: '#fff8d6' },
} as const;
// 门板材质档位类型：四档配色结构一致，按等级取其中一档
export type DoorTier = (typeof DOOR_TIERS)[keyof typeof DOOR_TIERS];

// 门洞与门板的屏幕几何（px）：point(u, v) 把「门面（正面）」的局部坐标映射到屏幕——
// u ∈ [-1, 1] 为门面横向（左负右正），v ∈ [0, 1] 为门面纵向（0 = 贴墙脚的底边，1 = 顶面下沿）；
// 门面比整块门板小一圈（顶部让出 DOOR_SLAB_TOP 的顶面、左右各让出 DOOR_SLAB_SIDE 的板厚），
// 横向半宽随 v 由 faceHalf 收窄到 topHalf（当前内收为 0，故两侧平行），
// 门面上的板缝/铆钉/加强筋/铭牌全部走这里落笔，改动板厚或收拢量时细节自动跟随
export interface DoorGeometry {
  cx: number;
  wallY: number; // 墙线（室内地面与墙的交线）
  baseY: number; // 门板底边：墙带外沿，与墙脚齐平
  baseHalf: number; // 整块门板的半宽（含板厚侧面）
  faceHalf: number; // 正面的半宽
  topHalf: number; // 正面顶边的半宽
  point: (u: number, v: number) => Position;
}

// 已建造物件的外观绘制（房门/床铺）：只读 GameState 与引擎时钟，不回写游戏状态。
// 门几何与门框/门面画法同时供 Renderer 的入场门与幽灵啃门复用（对应方法为 public）；
// 炮塔绘制独立成 TurretRenderer（assets）
export class SpawnRenderer {
  private ctx: CanvasRenderingContext2D;
  private cellSize: number = GRID_CELL_SIZE; // 单个网格单元格的像素边长
  private gridOffset: Position = GRID_OFFSET; // 网格原点相对画布左上角的偏移（用于把场地居中）

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  // 房门（后倾门板）：在门洞里立一块向后倾斜的门板 —— 底边贴墙线并卡在两侧门柱内沿之间，
  // 顶边向上抬 DOOR_PANEL_HEIGHT、向两侧各内收 DOOR_PANEL_TOP_INSET，门面因此从「俯视的一条 10px 细边」
  // 变成门格里最大的一块可见面；门面材质按等级切换（木门 → 铁门 → 重铁门 → 金门），
  // 升级时颜色、细节与等级数字同时变化，一眼可辨
  public drawDoors(state: GameState, nowMs: number) {
    state.doors.forEach((door) => {
      const g = this.doorGeometry(door);

      this.ctx.save();
      // 等级封顶在 DOOR_MAX_LEVEL（门面外观一共 5 档），超出部分统一按最高档绘制
      const level = Math.min(door.level, DOOR_MAX_LEVEL);
      // 门框先立起来：门柱同时盖住墙在门洞处的断面，门楣压在门板顶边之上
      this.drawDoorFrame(g, level);
      if (door.isBroken) {
        this.drawBrokenDoor(g, level);
      } else {
        // 门板（含血条）在挨啃时跟着攻击相位抖动，门框钉在墙上不动 —— 像门板被从门外一下下撞
        if (this.gnawingDoor(state) === door) {
          const swing = this.attackSwing(nowMs);
          this.ctx.save();
          this.ctx.translate(Math.sin(nowMs / 26) * 2.4 * swing, Math.sin(nowMs / 19) * 1.2 * swing);
          this.drawDoorPanel(g, level);
          this.drawDoorHealthBar(g, door, false, nowMs);
          this.ctx.restore();
        } else {
          this.drawDoorPanel(g, level);
          this.drawDoorHealthBar(g, door, this.doorRegenerating(state, door), nowMs);
        }
      }
      this.ctx.restore();
    });
  }

  // 这扇门此刻在不在自动回血：与引擎侧 updateDoors 同一条规则 ——
  // 未破损、没满血、且鬼不在啃它（鬼正在走向这扇门的路上也算「在攻击」，不回血）。
  // 用于给血条加一个回血提示，让"打跑一波 = 门在回血"这件事看得见
  private doorRegenerating(state: GameState, door: Door): boolean {
    if (door.health >= door.maxHealth) return false;
    return !(state.ghost.state === 'ATTACKING' && state.ghost.targetDoor === door.id);
  }

  // 正在被幽灵啃的门（没有则返回 undefined）：引擎里幽灵到位后会吸附到门正前方的站位，
  // 这里按"是否站在站位上"判定，免得幽灵还在走向门的路上就播啃门动作
  public gnawingDoor(state: GameState): Door | undefined {
    const ghost = state.ghost;
    if (ghost.state !== 'ATTACKING' || !ghost.targetDoor) return undefined;
    const door = state.doors.find((d) => d.id === ghost.targetDoor && !d.isBroken);
    if (!door) return undefined;
    const onStation = Math.abs(ghost.position.x - door.position.x) < 0.15
      && Math.abs(ghost.position.y - (door.position.y + GHOST_ATTACK_OFFSET_Y)) < 0.15;
    return onStation ? door : undefined;
  }

  // 啃门动作相位：一个周期内先快出、再缓收，返回 0~1 的"出手强度"。
  // 幽灵前扑、门面抓痕、门板抖动共用这一条曲线，动作与效果始终对得上
  public attackSwing(nowMs: number): number {
    const phase = (nowMs % GHOST_ATTACK_CYCLE) / GHOST_ATTACK_CYCLE;
    return Math.max(0, Math.sin(phase * Math.PI * 2));
  }

  // 门洞几何：按门所在格子定位房间，再取该房间轮廓的门洞段（ROOM_DOOR_GAP）两端点 ——
  // 与 GameLogic 的 WALL_SEGMENTS 同源，画出来的门永远卡在墙上的门洞里；
  // 门板底边落在墙带外沿（与墙脚齐平），底边半宽 = 门洞半宽 - 门柱半宽，正好落在两侧门柱内沿之间
  public doorGeometry(door: Door): DoorGeometry {
    const roomIndex = Math.max(0, roomIndexOf(door.position));
    const origin = ROOM_ORIGINS[roomIndex];
    const outline = ROOM_OUTLINES[roomIndex % ROOM_OUTLINES.length];
    const [gapRight, gapLeft] = ROOM_DOOR_GAP;
    const ox = this.gridOffset.x + origin.x * this.cellSize;
    const oy = this.gridOffset.y + origin.y * this.cellSize;
    const leftX = ox + outline[gapLeft].x * this.cellSize;
    const rightX = ox + outline[gapRight].x * this.cellSize;
    const wallY = oy + outline[gapLeft].y * this.cellSize; // 门洞两端同 y，即南墙墙线
    const cx = (leftX + rightX) / 2;
    const baseY = wallY + WALL_BODY_WIDTH / 2; // 墙带外沿：门板底边与墙脚、门柱底边齐平
    const baseHalf = (rightX - leftX) / 2 - DOOR_FRAME_POST_W / 2; // 整块门板正好落在两侧门柱之间
    const faceHalf = baseHalf - DOOR_SLAB_SIDE; // 让出左右板厚
    const topHalf = faceHalf - DOOR_PANEL_TOP_INSET;
    return {
      cx,
      wallY,
      baseY,
      baseHalf,
      faceHalf,
      topHalf,
      // 门面局部坐标 -> 屏幕：纵向自墙脚向上量到门面顶（门板顶面另占最上面 DOOR_SLAB_TOP px），
      // 横向半宽随 v 由 faceHalf 收窄到 topHalf（当前为 0 收拢，两侧平行）
      point: (u, v) => ({
        x: cx + u * (faceHalf + (topHalf - faceHalf) * v),
        y: baseY - DOOR_FACE_HEIGHT * v,
      }),
    };
  }

  // 门面局部坐标矩形 -> 屏幕路径：横向半宽随 v 收窄，矩形在倾斜门面上自动变成梯形，
  // 板缝/加强筋/铭牌底衬等元素都靠它落笔，不必各自换算透视
  private doorRect(g: DoorGeometry, u0: number, u1: number, v0: number, v1: number): Path2D {
    const a = g.point(u0, v0);
    const b = g.point(u1, v0);
    const c = g.point(u1, v1);
    const d = g.point(u0, v1);
    const path = new Path2D();
    path.moveTo(a.x, a.y);
    path.lineTo(b.x, b.y);
    path.lineTo(c.x, c.y);
    path.lineTo(d.x, d.y);
    path.closePath();
    return path;
  }

  // 门框：两侧门柱（柱身 + 受光侧亮面 + 柱头压顶）、门楣横梁、门槛石条；
  // 柱底与墙脚齐平、柱顶与门板顶边及墙顶面齐平，门框因此与墙体同高同面，只在门口形成一圈边框
  public drawDoorFrame(g: DoorGeometry, level: number) {
    const postW = DOOR_FRAME_POST_W;
    const baseY = g.baseY;
    const topY = g.baseY - DOOR_PANEL_HEIGHT; // 柱顶 = 门板顶边 = 墙顶面
    // 柱头压顶颜色随等级抬档（石青 → 铁灰 → 亮钢 → 金）：升级时门框也一起变化
    const trim = DOOR_FRAME_TRIM[Math.min(level, DOOR_FRAME_TRIM.length) - 1];

    [-1, 1].forEach((side) => {
      const xOuter = g.cx + side * (g.baseHalf + postW);
      const xInner = g.cx + side * g.baseHalf;

      // 柱身：与门板平行的一条竖柱，底座与柱顶都与墙齐平
      this.ctx.fillStyle = '#4b4b6b';
      this.ctx.fillRect(xOuter, topY, postW, baseY - topY);

      // 受光侧亮面（柱身左侧，与全场景左上主光源一致）
      const litX = side < 0 ? xOuter : xInner;
      this.ctx.fillStyle = 'rgba(150, 152, 205, 0.35)';
      this.ctx.fillRect(litX, topY, 3.5, baseY - topY);

      // 柱头压顶：比柱身宽出 2px 的石帽，顶面压一条等级相关的高光线
      const capLeft = Math.min(xOuter, xInner) - 2;
      this.ctx.fillStyle = '#5c5c82';
      this.ctx.fillRect(capLeft, topY, postW + 4, 6);
      this.ctx.fillStyle = trim;
      this.ctx.fillRect(capLeft, topY, postW + 4, 2.5);

      // 柱脚与地面的交接暗线
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      this.ctx.fillRect(xOuter, baseY - 1.5, postW, 1.5);
    });

    // 门楣横梁：压在门柱与门板顶边上（顶面与墙顶面齐平），顶面受光、下沿背光
    const lintelHalf = g.baseHalf + postW + 3;
    const lintelTop = topY - 1;
    this.ctx.beginPath();
    this.ctx.moveTo(g.cx - lintelHalf, lintelTop + 7);
    this.ctx.lineTo(g.cx + lintelHalf, lintelTop + 7);
    this.ctx.lineTo(g.cx + lintelHalf - 2, lintelTop);
    this.ctx.lineTo(g.cx - lintelHalf + 2, lintelTop);
    this.ctx.closePath();
    this.ctx.fillStyle = '#565678';
    this.ctx.fill();
    this.ctx.fillStyle = trim;
    this.ctx.fillRect(g.cx - lintelHalf + 2, lintelTop, lintelHalf * 2 - 4, 2.5);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.fillRect(g.cx - lintelHalf, lintelTop + 5.5, lintelHalf * 2, 1.5);

    // 门槛石条：门板前的一道石条（落在墙带外沿之外），门板正立在它后面
    const sillHalf = g.baseHalf + 3;
    this.ctx.beginPath();
    this.ctx.moveTo(g.cx - sillHalf, baseY);
    this.ctx.lineTo(g.cx + sillHalf, baseY);
    this.ctx.lineTo(g.cx + sillHalf - 1.5, baseY + 4.5);
    this.ctx.lineTo(g.cx - sillHalf + 1.5, baseY + 4.5);
    this.ctx.closePath();
    this.ctx.fillStyle = '#5f5f80';
    this.ctx.fill();
    this.ctx.fillStyle = 'rgba(160, 162, 210, 0.35)';
    this.ctx.fillRect(g.cx - sillHalf, baseY, sillHalf * 2, 1.5);
  }

  // 门板主体（一块立在门洞里的板，与墙体同一套立体语言）：
  // 顶部 DOOR_SLAB_TOP 的可见顶面（受光 + 顶棱高光 + 与门面交界的暗缝）、左右板厚侧面（左受光右背光），
  // 正面再叠纵向渐变底色 + 左上受光棱/右下背光棱 + 分等级材质 + 门楣投影 + 落地接触阴影；
  // 金门额外带一圈外发光，升到 6 级时一眼可辨
  // 门板（按等级分档的完整门）：主体 + 分等级材质 + 等级铭牌
  private drawDoorPanel(g: DoorGeometry, level: number) {
    // 门面底色按等级取档：1-2 级木质、3 级铁、4 级重铁、5 级金
    const tier: DoorTier = level >= 5 ? DOOR_TIERS.gold : level >= 4 ? DOOR_TIERS.heavy : level >= 3 ? DOOR_TIERS.iron : DOOR_TIERS.wood;

    this.drawDoorPanelBody(g, tier, level >= 5);

    // 分等级材质（5 档，逐级加件，升级一眼可辨）：木门 → 加固木门 → 铁门 → 重铁门 → 金门
    if (level >= 5) {
      this.drawGoldFace(g, tier);
    } else if (level >= 4) {
      this.drawIronFace(g, tier, true);
    } else if (level >= 3) {
      this.drawIronFace(g, tier, false);
    } else if (level >= 2) {
      this.drawReinforcedWoodFace(g, tier);
    } else {
      this.drawWoodFace(g, tier);
    }

    // 等级铭牌：门面上部一块衬底 + 等级数字，升级时数字与材质同时变化
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
    this.ctx.fill(this.doorRect(g, -0.88, 0.88, 0.62, 0.98));
    const badge = g.point(0, 0.8);
    this.ctx.fillStyle = tier.text;
    this.ctx.font = 'bold 10px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`等级 ${level}`, badge.x, badge.y + 3.5);
  }

  // 门板主体（一块立在门洞里的板，与墙体同一套立体语言）：
  // 顶部 DOOR_SLAB_TOP 的可见顶面（受光 + 顶棱高光 + 与门面交界的暗缝）、左右板厚侧面（左受光右背光），
  // 正面再叠纵向渐变底色 + 左上受光棱/右下背光棱 + 门楣投影 + 落地接触阴影；
  // 材质细节、等级铭牌与金门外发光由调用方接着画（入场门同样复用这块主体，但不分等级也不挂铭牌）
  public drawDoorPanelBody(g: DoorGeometry, tier: DoorTier, glow: boolean) {
    const slabTop = g.baseY - DOOR_PANEL_HEIGHT; // 门板顶：与南墙顶面齐平
    const faceTop = g.baseY - DOOR_FACE_HEIGHT; // 门面顶：门板顶面下沿（顶面占最上面 DOOR_SLAB_TOP px）

    // 门板顶面：与墙顶面同理的一块受光面，顶棱压高光、与门面交界压暗缝
    this.ctx.fillStyle = tier.light;
    this.ctx.fillRect(g.cx - g.baseHalf, slabTop, g.baseHalf * 2, DOOR_SLAB_TOP);
    this.ctx.fillStyle = tier.lit;
    this.ctx.fillRect(g.cx - g.baseHalf, slabTop, g.baseHalf * 2, 1.4);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    this.ctx.fillRect(g.cx - g.baseHalf, faceTop - 1, g.baseHalf * 2, 1.4);

    // 板厚侧面：左侧受光、右侧背光（与全场景左上主光源一致），门板因此有厚度而不只是一块色片
    this.ctx.fillStyle = tier.lit;
    this.ctx.fillRect(g.cx - g.baseHalf, faceTop, DOOR_SLAB_SIDE, g.baseY - faceTop);
    this.ctx.fillStyle = tier.shade;
    this.ctx.fillRect(g.cx + g.baseHalf - DOOR_SLAB_SIDE, faceTop, DOOR_SLAB_SIDE, g.baseY - faceTop);

    const panel = this.doorRect(g, -1, 1, 0, 1);

    // 底色：门面下沿（贴地）最暗、上沿受光更亮
    const face = this.ctx.createLinearGradient(0, g.baseY, 0, faceTop);
    face.addColorStop(0, tier.dark);
    face.addColorStop(0.6, tier.base);
    face.addColorStop(1, tier.light);
    this.ctx.save();
    if (glow) {
      // 金门外发光：衬托最高档材质
      this.ctx.shadowColor = 'rgba(241, 196, 15, 0.55)';
      this.ctx.shadowBlur = 16;
    }
    this.ctx.fillStyle = face;
    this.ctx.fill(panel);
    this.ctx.restore();

    // 受光棱（左边 + 顶边）与背光棱（右边 + 底边），与全场景左上主光源一致
    const bl = g.point(-1, 0);
    const br = g.point(1, 0);
    const tr = g.point(1, 1);
    const tl = g.point(-1, 1);
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = tier.lit;
    this.ctx.beginPath();
    this.ctx.moveTo(bl.x, bl.y);
    this.ctx.lineTo(tl.x, tl.y);
    this.ctx.lineTo(tr.x, tr.y);
    this.ctx.stroke();
    this.ctx.strokeStyle = tier.shade;
    this.ctx.beginPath();
    this.ctx.moveTo(tr.x, tr.y);
    this.ctx.lineTo(br.x, br.y);
    this.ctx.lineTo(bl.x, bl.y);
    this.ctx.stroke();

    // 门楣投在门面上的柔和阴影：门面上沿压暗一段，门板像退进墙里
    const lintelShadow = this.ctx.createLinearGradient(0, faceTop, 0, faceTop + 9);
    lintelShadow.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    lintelShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this.ctx.fillStyle = lintelShadow;
    this.ctx.fill(this.doorRect(g, -1, 1, 1 - 9 / DOOR_FACE_HEIGHT, 1));

    // 落地接触阴影：门面下沿压暗 + 门板在门槛上投下一条接触影，门板立在地面上
    const footShadow = this.ctx.createLinearGradient(0, g.baseY, 0, g.baseY - 7);
    footShadow.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
    footShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this.ctx.fillStyle = footShadow;
    this.ctx.fill(this.doorRect(g, -1, 1, 0, 7 / DOOR_FACE_HEIGHT));
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.fillRect(g.cx - g.baseHalf, g.baseY, g.baseHalf * 2, 2);
  }

  // 木门面（1 级）：四块竖板 + 受光板缝 + 木纹 + 铜门把
  public drawWoodFace(g: DoorGeometry, tier: DoorTier) {
    // 板缝：把门面竖向等分四块，缝左侧残留一线受光凸缘、右侧压深色凹缝
    for (let i = 1; i < 4; i++) {
      const u = -1 + i / 2;
      this.ctx.fillStyle = tier.lit;
      this.ctx.fill(this.doorRect(g, u - 0.06, u - 0.02, 0.03, 0.97));
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      this.ctx.fill(this.doorRect(g, u - 0.02, u + 0.02, 0.03, 0.97));
    }

    // 木纹：逐条按确定性哈希定位（逐帧不闪变），只落在铭牌下方，避免与等级数字打架
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    for (let i = 0; i < 7; i++) {
      const v = 0.1 + hash01(i, 31) * 0.48;
      const u0 = -0.86 + hash01(i, 41) * 0.5;
      const a = g.point(u0, v);
      const b = g.point(u0 + 0.24 + hash01(i, 47) * 0.3, v);
      this.ctx.beginPath();
      this.ctx.moveTo(a.x, a.y);
      this.ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + (hash01(i, 53) - 0.5) * 5, b.x, b.y);
      this.ctx.stroke();
    }

    // 门把：铜制圆把，带右下落影与左上高光
    const knob = g.point(0.62, 0.36);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    this.ctx.beginPath();
    this.ctx.arc(knob.x + 1, knob.y + 1.5, 3.4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = '#c9a227';
    this.ctx.beginPath();
    this.ctx.arc(knob.x, knob.y, 3, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.fillStyle = 'rgba(255, 246, 200, 0.75)';
    this.ctx.beginPath();
    this.ctx.arc(knob.x - 1, knob.y - 1, 1.1, 0, Math.PI * 2);
    this.ctx.fill();
  }

  // 加固木门面（2 级）：木板门面之上再压两道带铆钉的铁箍，比 1 级光板木门多出横向铁件
  private drawReinforcedWoodFace(g: DoorGeometry, tier: DoorTier) {
    this.drawWoodFace(g, tier);

    const iron = DOOR_TIERS.iron;
    // 两道铁箍避开木门面的圆门把（v = 0.36）与上方等级铭牌（v ≥ 0.6）
    [0.16, 0.54].forEach((v) => {
      // 铁箍横带：压过整个门面，上沿受光、下沿背光
      this.ctx.fillStyle = iron.base;
      this.ctx.fill(this.doorRect(g, -1, 1, v - 0.075, v + 0.075));
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      this.ctx.fill(this.doorRect(g, -1, 1, v + 0.02, v + 0.075));
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      this.ctx.fill(this.doorRect(g, -1, 1, v - 0.075, v - 0.02));

      // 铁箍两端各一颗铆钉
      [-0.7, 0.7].forEach((u) => {
        const p = g.point(u, v);
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        this.ctx.beginPath();
        this.ctx.arc(p.x - 0.6, p.y - 0.6, 0.9, 0, Math.PI * 2);
        this.ctx.fill();
      });
    });
  }

  // 铁门面（3 级）/ 重铁门面（4 级）：铁包边 + 竖向分缝 + 铆钉；
  // 重铁门再加两道横向加强筋与更多铆钉，让 4 级与 3 级一眼可辨
  private drawIronFace(g: DoorGeometry, tier: DoorTier, heavy: boolean) {
    // 铁包边：外圈受光棱 + 内圈暗缝，像压出来的一圈边条
    this.ctx.lineWidth = 1.6;
    this.ctx.strokeStyle = tier.lit;
    this.ctx.stroke(this.doorRect(g, -0.9, 0.9, 0.07, 0.93));
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.stroke(this.doorRect(g, -0.84, 0.84, 0.12, 0.88));

    // 竖向分缝：把门面分成两块铁板（受光凸缘在左、凹缝在右）
    this.ctx.fillStyle = tier.lit;
    this.ctx.fill(this.doorRect(g, -0.05, -0.02, 0.1, 0.9));
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.fill(this.doorRect(g, -0.02, 0.02, 0.1, 0.9));

    // 铆钉：沿上下两边等距四列（上门那列压在铭牌下方）；重铁门在加强筋上再加两列
    const rivets: Array<[number, number]> = [];
    [-0.72, -0.24, 0.24, 0.72].forEach((u) => rivets.push([u, 0.16], [u, 0.56]));
    if (heavy) [-0.6, -0.2, 0.2, 0.6].forEach((u) => rivets.push([u, 0.3], [u, 0.5]));
    rivets.forEach(([u, v]) => {
      const p = g.point(u, v);
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      this.ctx.beginPath();
      this.ctx.arc(p.x - 0.6, p.y - 0.6, 0.9, 0, Math.PI * 2);
      this.ctx.fill();
    });

    // 横向加强筋：两道压出来的横带，上沿受光、下沿背光
    if (heavy) {
      [0.3, 0.5].forEach((v) => {
        this.ctx.fillStyle = tier.light;
        this.ctx.fill(this.doorRect(g, -0.92, 0.92, v - 0.07, v + 0.07));
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.fill(this.doorRect(g, -0.92, 0.92, v + 0.02, v + 0.07));
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        this.ctx.fill(this.doorRect(g, -0.92, 0.92, v - 0.07, v - 0.02));
      });
    }
  }

  // 金门面（6 级起）：亮边框 + 中央菱形门徽 + 四角饰纹；底色自带外发光，最高档一眼可辨
  private drawGoldFace(g: DoorGeometry, tier: DoorTier) {
    // 亮边框：外亮内暗双层压边
    this.ctx.lineWidth = 2.2;
    this.ctx.strokeStyle = tier.lit;
    this.ctx.stroke(this.doorRect(g, -0.9, 0.9, 0.06, 0.94));
    this.ctx.lineWidth = 1.6;
    this.ctx.strokeStyle = 'rgba(120, 78, 0, 0.45)';
    this.ctx.stroke(this.doorRect(g, -0.82, 0.82, 0.12, 0.88));

    // 中央门徽：菱形金徽 + 亮芯（落在铭牌下方，不与等级数字重叠）
    const emblem = new Path2D();
    const shape: Array<[number, number]> = [[0, 0.2], [0.34, 0.36], [0, 0.52], [-0.34, 0.36]];
    shape.forEach(([u, v], i) => {
      const p = g.point(u, v);
      if (i === 0) emblem.moveTo(p.x, p.y);
      else emblem.lineTo(p.x, p.y);
    });
    emblem.closePath();
    this.ctx.fillStyle = 'rgba(255, 246, 196, 0.55)';
    this.ctx.fill(emblem);
    this.ctx.lineWidth = 1.4;
    this.ctx.strokeStyle = 'rgba(140, 96, 0, 0.5)';
    this.ctx.stroke(emblem);
    const core = g.point(0, 0.36);
    this.ctx.fillStyle = '#fffbe0';
    this.ctx.beginPath();
    this.ctx.arc(core.x, core.y, 2.6, 0, Math.PI * 2);
    this.ctx.fill();

    // 四角饰纹：小菱形铆饰
    ([[-0.72, 0.16], [0.72, 0.16], [-0.72, 0.56], [0.72, 0.56]] as Array<[number, number]>).forEach(([u, v]) => {
      const p = g.point(u, v);
      this.ctx.fillStyle = 'rgba(255, 250, 210, 0.75)';
      this.ctx.beginPath();
      this.ctx.moveTo(p.x, p.y - 3);
      this.ctx.lineTo(p.x + 3, p.y);
      this.ctx.lineTo(p.x, p.y + 3);
      this.ctx.lineTo(p.x - 3, p.y);
      this.ctx.closePath();
      this.ctx.fill();
    });
  }

  // 血条：悬浮在门板顶边之上（深色底槽 + 三色填充 + 顶部亮线），仍在门格内，压不到门面细节。
  // regenerating 为真时（鬼没在啃这扇门）在条尾补一个脉动的绿色「+」，标明这一截是自动修回来的
  private drawDoorHealthBar(g: DoorGeometry, door: Door, regenerating: boolean, nowMs: number) {
    const barW = g.baseHalf * 2;
    const barX = g.cx - g.baseHalf;
    const barY = g.baseY - DOOR_PANEL_HEIGHT - 12;
    const healthPercent = Math.max(0, Math.min(1, door.health / door.maxHealth));

    this.ctx.fillStyle = '#141420';
    this.ctx.fillRect(barX - 1, barY - 1, barW + 2, 8);
    this.ctx.fillStyle = '#2b2b3d';
    this.ctx.fillRect(barX, barY, barW, 6);
    // 填充色：高于 50% 为绿、20% 以上为黄、否则为红
    this.ctx.fillStyle = healthPercent > 0.5 ? '#2ecc71' : healthPercent > 0.2 ? '#f1c40f' : '#e74c3c';
    this.ctx.fillRect(barX, barY, barW * healthPercent, 6);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    this.ctx.fillRect(barX, barY, barW * healthPercent, 1.5);

    // 自动回血提示：条尾一颗随呼吸闪烁的绿色小十字
    if (regenerating) {
      const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(nowMs / 240));
      const cx = barX + barW + 6;
      const cy = barY + 3;
      this.ctx.save();
      this.ctx.globalAlpha = pulse;
      this.ctx.strokeStyle = '#7dffb0';
      this.ctx.lineWidth = 1.8;
      this.ctx.beginPath();
      this.ctx.moveTo(cx - 3, cy); this.ctx.lineTo(cx + 3, cy);
      this.ctx.moveTo(cx, cy - 3); this.ctx.lineTo(cx, cy + 3);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  // 门被破坏：门框仍在，门洞里压暗，门板只剩锯齿残段，门口散落碎块，并标注「已损坏」
  private drawBrokenDoor(g: DoorGeometry, level: number) {
    const remnantColor = level >= 5 ? '#5c4306' : level >= 3 ? '#3a4143' : '#33200f';

    // 门洞暗面：门破后门洞是通的 —— 按整块门板的占位（从门板顶到墙脚）铺一层暗面，
    // 交代屋外的黑，同时衬托残段
    const holeTop = g.baseY - DOOR_PANEL_HEIGHT;
    const hole = this.ctx.createLinearGradient(0, g.baseY, 0, holeTop);
    hole.addColorStop(0, '#0a0a12');
    hole.addColorStop(1, '#1e1e2e');
    this.ctx.fillStyle = hole;
    this.ctx.fillRect(g.cx - g.baseHalf, holeTop, g.baseHalf * 2, DOOR_PANEL_HEIGHT);

    // 残段：门面只余下部约 1/3，顶边做成锯齿（逐点哈希扰动，逐帧稳定）
    const teeth = 6;
    const remnant = new Path2D();
    const bl = g.point(-1, 0);
    remnant.moveTo(bl.x, bl.y);
    for (let i = 1; i <= teeth; i++) {
      const p = g.point(-1 + (2 * i) / teeth, 0.26 + hash01(i, 7) * 0.22);
      remnant.lineTo(p.x, p.y);
    }
    const br = g.point(1, 0);
    remnant.lineTo(br.x, br.y);
    remnant.closePath();
    this.ctx.fillStyle = remnantColor;
    this.ctx.fill(remnant);
    // 断裂面受光：沿锯齿顶边勾一条亮线，残段不至于糊成一块
    this.ctx.strokeStyle = 'rgba(150, 152, 205, 0.35)';
    this.ctx.lineWidth = 1.2;
    this.ctx.stroke(remnant);

    // 碎块：门口地面上散落三块门板碎片
    const chips: Array<[number, number]> = [[-0.62, 6], [0.12, 8], [0.6, 5]];
    chips.forEach(([u, size], i) => {
      const p = g.point(u, 0);
      const y = g.baseY + 4 + (i % 2) * 3;
      this.ctx.fillStyle = i % 2 ? '#5a5a72' : '#6d6d86';
      this.ctx.beginPath();
      this.ctx.moveTo(p.x - size, y + 3);
      this.ctx.lineTo(p.x - size * 0.2, y - size * 0.5);
      this.ctx.lineTo(p.x + size, y + 3);
      this.ctx.closePath();
      this.ctx.fill();
    });

    // 状态文字：与完好时的血条同一行高
    this.ctx.fillStyle = '#ff9d9d';
    this.ctx.font = 'bold 10px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('已损坏', g.cx, g.baseY - DOOR_PANEL_HEIGHT - 6);
  }

  // 床铺：遍历 beds 数组，各自画在 position 所在格子（两个房间共两张）；外观按等级分 5 档
  public drawBeds(state: GameState) {
    state.beds.forEach((bed) => {
    const bx = this.gridOffset.x + bed.position.x * this.cellSize + this.cellSize / 2;
    const by = this.gridOffset.y + bed.position.y * this.cellSize + this.cellSize / 2;
    // 等级封顶在 BED_MAX_LEVEL（床铺外观 5 档），超出部分统一按最高档绘制
    const level = Math.min(bed.level, BED_MAX_LEVEL);

    this.ctx.save();
    this.drawBedBody(bx, by, level);

    // 床铺等级：床尾下方居中标注（深色衬底保证压在地板纹理上仍可读）
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    roundRect(this.ctx, bx - 25, by + 20, 50, 12, 6);
    this.ctx.fill();
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '10px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`床铺 Lv.${level}`, bx, by + 29);

    this.ctx.restore();
    });
  }

  // 床铺本体（按等级分 5 档，逐级加件）：木板床 → 单人床 → 舒适床 → 软床 → 豪华床。
  // 熟睡时上半部会被枕头/头/被子盖住，所以层次主要压在床架、四角与床尾
  private drawBedBody(bx: number, by: number, level: number) {
    const t = BED_TIERS[level - 1];
    const half = 20; // 床架半宽：40x40 占地，与睡觉时枕头/被子的尺寸对齐
    const inset = 4 - (level - 1) * 0.5; // 床垫内缩：等级越高床垫越厚实

    // 落地阴影：等级越高床越沉，影子更大
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    this.ctx.beginPath();
    this.ctx.ellipse(bx, by + 21, 19 + level, 5 + level * 0.4, 0, 0, Math.PI * 2);
    this.ctx.fill();

    // 床架：5 级带暖光晕，其余档直接铺底色
    this.ctx.save();
    if (level >= 5) {
      this.ctx.shadowColor = t.glow;
      this.ctx.shadowBlur = 14;
    }
    this.ctx.fillStyle = t.frame;
    roundRect(this.ctx, bx - half - 1, by - half - 1, (half + 1) * 2, (half + 1) * 2, 6);
    this.ctx.fill();
    this.ctx.restore();

    // 床架棱线：左上受光、右下背光（与全场景左上主光源一致）
    this.ctx.lineWidth = 1.6;
    this.ctx.strokeStyle = t.frameLit;
    this.ctx.beginPath();
    this.ctx.moveTo(bx - half + 2, by + half - 2);
    this.ctx.lineTo(bx - half + 2, by - half + 2);
    this.ctx.lineTo(bx + half - 2, by - half + 2);
    this.ctx.stroke();
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.beginPath();
    this.ctx.moveTo(bx + half - 2, by - half + 2);
    this.ctx.lineTo(bx + half - 2, by + half - 2);
    this.ctx.lineTo(bx - half + 2, by + half - 2);
    this.ctx.stroke();

    // 床垫：纵向渐变（受光在上），等级越高越厚（内缩越少）
    const mattress = this.ctx.createLinearGradient(0, by - half, 0, by + half);
    mattress.addColorStop(0, t.mattress);
    mattress.addColorStop(1, t.mattressDark);
    this.ctx.fillStyle = mattress;
    roundRect(this.ctx, bx - half + inset, by - half + inset, (half - inset) * 2, (half - inset) * 2, 5);
    this.ctx.fill();
    // 床垫上缘受光带：像被面翻起的一道亮边
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    roundRect(this.ctx, bx - half + inset + 1.5, by - half + inset + 1.5, (half - inset) * 2 - 3, 4, 2);
    this.ctx.fill();
    // 4 级起：床垫拉扣（两个凹点），软床的体量感
    if (level >= 4) {
      [-7, 7].forEach((dx) => {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        this.ctx.beginPath();
        this.ctx.arc(bx + dx, by + half - inset - 4, 1.6, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        this.ctx.beginPath();
        this.ctx.arc(bx + dx - 0.5, by + half - inset - 4.5, 0.9, 0, Math.PI * 2);
        this.ctx.fill();
      });
    }

    // 枕头：等级越高越宽；3 级起叠一道枕沿折线
    const pillowW = 12 + level * 1.5;
    const pillowY = by - half + inset + 2;
    this.ctx.fillStyle = t.pillow;
    roundRect(this.ctx, bx - pillowW, pillowY, pillowW * 2, 9, 3);
    this.ctx.fill();
    if (level >= 3) {
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(bx - pillowW + 3, pillowY + 4.5);
      this.ctx.quadraticCurveTo(bx, pillowY + 6.5, bx + pillowW - 3, pillowY + 4.5);
      this.ctx.stroke();
    }

    // 被子：2 级起在床尾铺一条，等级越高越长、花纹越复杂
    if (level >= 2) {
      const quiltH = 10 + level * 1.6;
      const quiltW = (half - inset - 1) * 2;
      const quiltX = bx - half + inset + 1;
      const quiltY = by + half - inset - quiltH;
      this.ctx.fillStyle = t.quilt;
      roundRect(this.ctx, quiltX, quiltY, quiltW, quiltH, 3);
      this.ctx.fill();
      // 被沿受光翻边
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      roundRect(this.ctx, quiltX + 2, quiltY + 1.5, quiltW - 4, 2.5, 1.2);
      this.ctx.fill();
      // 暗部：被子下沿压深，像鼓起后被床架挡住的阴影
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      roundRect(this.ctx, quiltX, quiltY + quiltH - 3, quiltW, 3, 1.5);
      this.ctx.fill();
      // 折痕
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(quiltX + 3, quiltY + quiltH * 0.5);
      this.ctx.lineTo(quiltX + quiltW - 3, quiltY + quiltH * 0.5);
      this.ctx.stroke();
      // 4 级起：菱形绗缝（两道斜线交叉成菱格）
      if (level >= 4) {
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
        for (let i = 1; i < 4; i++) {
          const x = quiltX + (quiltW * i) / 4;
          this.ctx.beginPath();
          this.ctx.moveTo(x - quiltH * 0.4, quiltY + 2);
          this.ctx.lineTo(x + quiltH * 0.4, quiltY + quiltH - 2);
          this.ctx.stroke();
        }
      }
    }

    // 3 级起：床头横杆（黄铜/钢制，带上缘高光）
    if (level >= 3) {
      const barY = by - half - 2;
      this.ctx.fillStyle = t.frameLit;
      roundRect(this.ctx, bx - half + 1, barY, (half - 1) * 2, 4, 2);
      this.ctx.fill();
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      roundRect(this.ctx, bx - half + 2.5, barY + 0.8, (half - 1) * 2 - 3, 1.2, 0.6);
      this.ctx.fill();
    }

    // 4 级起：床尾挡板（一条压在外沿的木框）
    if (level >= 4) {
      this.ctx.fillStyle = t.frame;
      roundRect(this.ctx, bx - half + 2, by + half - 3, (half - 2) * 2, 4, 2);
      this.ctx.fill();
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      roundRect(this.ctx, bx - half + 3.5, by + half - 2.4, (half - 2) * 2 - 3, 1.2, 0.6);
      this.ctx.fill();
    }

    // 2 级起：四角床柱（等级越高柱头越亮，5 级为描金柱头）
    if (level >= 2) {
      const p = level >= 5 ? 4.5 : 3.5;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        const cx = bx + sx * (half - 1.5);
        const cy = by + sy * (half - 1.5);
        this.ctx.fillStyle = level >= 5 ? '#e8c23c' : t.frameLit;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, p, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        this.ctx.beginPath();
        this.ctx.arc(cx - 1, cy - 1, p * 0.4, 0, Math.PI * 2);
        this.ctx.fill();
      });
    }

    // 5 级：床头金饰（中央一枚菱形徽记），配合床体暖光晕点明最高档
    if (level >= 5) {
      const cy = by - half - 5;
      this.ctx.fillStyle = '#f1c40f';
      this.ctx.beginPath();
      this.ctx.moveTo(bx, cy - 4);
      this.ctx.lineTo(bx + 5, cy);
      this.ctx.lineTo(bx, cy + 4);
      this.ctx.lineTo(bx - 5, cy);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.fillStyle = '#fff8d6';
      this.ctx.beginPath();
      this.ctx.arc(bx, cy, 1.6, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

}

// 圆角矩形路径辅助：只构建路径，不填充不描边，由调用方决定填充/描边；
// Renderer 侧（玩家/幽灵血条等）与床铺/炮塔铭牌共用
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
