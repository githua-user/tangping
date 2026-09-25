// 地图几何与边界碰撞检测：渲染层与逻辑层共用同一份数据，画面上看得见的墙和角色能站的地方才不会互相打架。
// 集中两块内容：
// 1. 地图几何：画布 / 网格 / 房间布局 / 门洞 / 墙体抬升 / 幽灵出入口（渲染换像素、逻辑换格坐标都用它）
// 2. 边界碰撞：墙面占位采样（WALL_BANDS）、角色可活动边界（PLAYER_BOUNDS）与移动结算（resolveMovement）
import { Position } from '../types';

// ── 地图几何 ────────────────────────────────────────────────────────────

// 画布逻辑宽高
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 600;
// 房间网格
export const GRID_CELL_SIZE = 60;
// 画布（CANVAS_WIDTH x CANVAS_HEIGHT）：左房间 7 格宽 + 2 格走廊 + 右房间 6 格宽共 15 格，水平居中（左右各留 50px）；
// 纵向最高 7 格（420px），整体偏上，下方留出幽灵入场空间；
// 上方留白加厚到 52px：墙体立面向后抬升后，房间北侧凸窗（轮廓 y=-0.3）的墙顶面仍完整落在画布内
export const GRID_OFFSET: Position = { x: 50, y: 52 };
// 每个房间独立的网格行列数（可建造范围：房间内 0 ~ COLS-1 / ROWS-1，按房间索引对应）
// 左房间更宽（7 列 x 6 行），右房间更长（6 列 x 7 行）
export const ROOM_COLS: number[] = [7, 6];
export const ROOM_ROWS: number[] = [6, 7];
// 两个独立房间的坐标原点，右房间与左房间相隔 2 格走廊（7 + 2 = 9）
export const ROOM_ORIGINS: Position[] = [
  { x: 0, y: 0 },
  { x: 9, y: 0 },
];
// 世界格坐标落在哪个房间（不在任何房间内返回 -1）：
// 床与房门的对应关系、炮塔可建造判定、幽灵的出场位置都由它换算
export function roomIndexOf(pos: Position): number {
  return ROOM_ORIGINS.findIndex((origin, i) =>
    pos.x >= origin.x && pos.x < origin.x + ROOM_COLS[i]
    && pos.y >= origin.y && pos.y < origin.y + ROOM_ROWS[i]);
}
// 左下角幽灵入场门（世界格坐标，门洞中线）：走廊南侧一段残墙上的门洞，门后就是地图之外的黑。
// 渲染层由它换算出整扇门的像素几何（残墙/门柱/门楣/门板/门槛），逻辑层不拿它做碰撞（门后走不通）
export const GHOST_ENTRANCE_DOOR: Position = { x: 1.4, y: 8.8 };
// 幽灵破门出场的位置（格索引，与 Ghost.position 同坐标系）：正对门洞、门内一步 ——
// 门洞中心的世界坐标即 GHOST_ENTRANCE_DOOR，格索引各减 0.5，再向北（-y）收 0.6 格
export const GHOST_SPAWN_POSITION: Position = { x: 0.9, y: 7.7 };
// 回血站位（世界格索引，与 Ghost.position 同坐标系）：入场门洞内一步、横向正对门洞中线 ——
// 门洞中线是世界坐标 GHOST_ENTRANCE_DOOR.x，格索引各减 0.5，再向北收 0.25 格让身体正好卡进门洞里。
// 鬼缩进门洞后免伤：玩家唯一的补刀窗口是它掉头跑回去的那几秒（RETREATING）
export const GHOST_HEAL_POSITION: Position = { x: GHOST_ENTRANCE_DOOR.x - 0.5, y: GHOST_ENTRANCE_DOOR.y - 0.75 };
// 幽灵啃门时的站位（相对门格的格索引偏移 y）：门格是房间南墙内侧的最后一排，门格 y+1 即南墙墙线，
// 再往南 0.95 格（世界坐标 0.45 格）正好落在墙面占位碰撞余量（0.4 格）之外 ——
// 幽灵因此贴在门板正前方的走廊里、且 x 与门格中心对齐（正对门洞中线）
export const GHOST_ATTACK_OFFSET_Y = 0.95;
// 房间轮廓折线（相对房间原点的格坐标，从左上切角处顺时针排列）。
// 渲染层据此绘制房间地板/墙体，碰撞层据此生成墙面占位（WALL_BANDS），两边共用同一份轮廓
export const ROOM_OUTLINES: Position[][] = [
  // 左房间（宽 7 格 x 高 6 格）
  [
    { x: 0.55, y: 0 }, { x: 2.15, y: 0 }, { x: 2.35, y: -0.3 }, { x: 3.65, y: -0.3 }, { x: 3.85, y: 0 },
    { x: 6.45, y: 0 }, { x: 7, y: 0.55 },
    { x: 7, y: 1.75 }, { x: 7.28, y: 1.95 }, { x: 7.28, y: 3.05 }, { x: 7, y: 3.25 },
    { x: 7, y: 5.45 }, { x: 6.45, y: 6 },
    { x: 4.05, y: 6 }, { x: 2.95, y: 6 },
    { x: 0.55, y: 6 }, { x: 0, y: 5.45 },
    { x: 0, y: 3.55 }, { x: -0.28, y: 3.35 }, { x: -0.28, y: 2.25 }, { x: 0, y: 2.05 },
    { x: 0, y: 0.55 },
  ],
  // 右房间（宽 6 格 x 高 7 格）
  [
    { x: 0.55, y: 0 }, { x: 2.85, y: 0 }, { x: 3.05, y: -0.3 }, { x: 4.35, y: -0.3 }, { x: 4.55, y: 0 },
    { x: 5.45, y: 0 }, { x: 6, y: 0.55 },
    { x: 6, y: 2.85 }, { x: 6.28, y: 3.05 }, { x: 6.28, y: 4.25 }, { x: 6, y: 4.45 },
    { x: 6, y: 6.45 }, { x: 5.45, y: 7 },
    { x: 4.05, y: 7 }, { x: 2.95, y: 7 },
    { x: 0.55, y: 7 }, { x: 0, y: 6.45 },
    { x: 0, y: 4.75 }, { x: -0.26, y: 4.55 }, { x: -0.26, y: 3.45 }, { x: 0, y: 3.25 },
    { x: 0, y: 0.55 },
  ],
];
// 门洞缺口两端在轮廓数组中的索引：右端 / 左端
export const ROOM_DOOR_GAP: [number, number] = [13, 14];
// 墙体后倾抬升（px）：轮廓每个顶点沿屏幕「向上」抬起的距离，按顶点 y 在房间前后之间插值——
// 近墙（南，离观众最近）抬得最高、远墙（北）抬得较低、侧墙自南向北收窄，与「近大远小」的透视一致。
// 渲染器用它把墙的立面 + 顶面抬起来，游戏逻辑用它算出「墙面在室内一侧的可见进深」来做碰撞内缩，
// 两边共用同一份数值，画面上看得见的墙面和能站的地方才不会互相打架
export const WALL_LEAN_FRONT = 32;
export const WALL_LEAN_BACK = 24;
// 砖身带宽（px）：既是顶层墙带的厚度，也是立面向上扫掠的厚度与门柱/门板底边的起算位置
export const WALL_BODY_WIDTH = 11.5;
// 单个轮廓顶点的墙顶抬升量（px）：把顶点的 y 在房间前后范围里归一化后插值，
// 越靠南（近处）抬得越高；渲染器画墙与逻辑算碰撞进深都用它
export function wallLift(outline: Position[]): number[] {
  const ys = outline.map((p) => p.y);
  const minY = Math.min(...ys);
  const span = Math.max(1e-6, Math.max(...ys) - minY);
  return outline.map((p) => WALL_LEAN_BACK + (WALL_LEAN_FRONT - WALL_LEAN_BACK) * ((p.y - minY) / span));
}

// ── 幽灵寻路参数（数值由墙面占位与门洞位置推出，与碰撞几何联动，故与地图几何同处） ──

// 幽灵的进攻车道（世界格索引 y）：走廊南侧的空地，横向段在这一高度上走。
// 房间南墙的墙面占位最南到世界 y ≈ 7.4（含抬升扫掠带），车道取 7.7（世界 y ≈ 8.2）留足余量，
// 与出场位置齐平：幽灵钻出门洞后就在这条车道上横穿走廊，不会蹭到任何墙
export const GHOST_LANE_Y = 7.7;
// 纵向段的对准阈值（格）：横向挪到距门洞中线这么近之后，才转为纵向逼近，
// 纵向时幽灵会继续朝门洞中线收拢，最终正对门洞站定
export const GHOST_LANE_ALIGN = 0.35;
// 到位吸附阈值（格）：离啃门站位这么近就直接吸附到站位上（见 GHOST_ATTACK_OFFSET_Y），
// 免得到位前后在站位附近抖出一格内的偏差，也保证每次啃门都啃在门板正中
export const GHOST_ATTACK_SNAP = 0.12;
// 幽灵单帧位移的最大分段长度（格）：位移超过它就切成几小段逐段结算碰撞。
// 幽灵速度随活动时间成长（十几格/秒），后期单帧位移可超过一格，而墙体碰撞只测终点 ——
// 一步跨过整段墙就直接穿过去了（隧道效应）；小段长度取 0.2 格，
// 小于墙体判定距离（砖身带半宽 + 角色半径 ≈ 0.4 格），每小段都能被墙拦住
export const GHOST_MAX_STEP = 0.2;

// ── 边界碰撞检测 ────────────────────────────────────────────────────────

// 角色碰撞半径
const WALL_CLEARANCE = 0.3;
// 砖身带半宽（格）：墙体在屏幕上就是把砖身带从墙线沿「向上」方向扫出来的，
// 所以一段墙的可见占位 = 砖身带本身 + 它的竖直扫掠
const WALL_BAND_HALF = WALL_BODY_WIDTH / 2 / GRID_CELL_SIZE;
// 撞墙判定距离：砖身带半宽 + 角色半径
const WALL_BAND_CLEARANCE = WALL_BAND_HALF + WALL_CLEARANCE;
// 墙面占位（世界格坐标下的一组墙线采样）：把每段墙的墙线沿「向上」方向按该段抬升量采样若干份，
// 每份代表扫掠过程中的一条砖身带中线。渲染器把墙画在「砖身带 + 竖直扫掠」这块区域里，
// 这里用同一条规则近似同一块区域 —— 因此房间内侧和走廊外侧都进不到墙面里。
// （旧版只把碰撞线往房间内侧缩，而北墙与斜墙的立面向屏幕上方扫出、落在房间之外，
//   从走廊一侧仍然能站到墙面上，就是那个没处理干净的问题）
const WALL_BANDS: Array<[Position, Position]> = (() => {
  const [gapRight, gapLeft] = ROOM_DOOR_GAP;
  const bands: Array<[Position, Position]> = [];
  ROOM_ORIGINS.forEach((origin, index) => {
    const outline = ROOM_OUTLINES[index % ROOM_OUTLINES.length];
    const lift = wallLift(outline);
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      if (i === gapRight && next === gapLeft) continue; // 门洞段跳过，可从门口进出
      // 采样间距 ≤ 0.25 格，远小于判定距离（约 0.4 格）：相邻采样的碰撞范围互相重叠，
      // 整条扫掠带上不会漏出可以钻过去的缝
      const steps = Math.max(1, Math.ceil(Math.max(lift[i], lift[next]) / GRID_CELL_SIZE / 0.25));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        bands.push([
          { x: origin.x + outline[i].x, y: origin.y + outline[i].y - (lift[i] * t) / GRID_CELL_SIZE },
          { x: origin.x + outline[next].x, y: origin.y + outline[next].y - (lift[next] * t) / GRID_CELL_SIZE },
        ]);
      }
    }
  });
  return bands;
})();

// 玩家可活动边界,GRID_OFFSET是游戏窗口区相对整个画布
const PLAYER_EDGE_MARGIN = 0.4; // 向内预留一个角色贴边余量
const PLAYER_BOUNDS = {
  minX: -GRID_OFFSET.x / GRID_CELL_SIZE + PLAYER_EDGE_MARGIN,
  maxX: (CANVAS_WIDTH - GRID_OFFSET.x) / GRID_CELL_SIZE - PLAYER_EDGE_MARGIN,
  minY: -GRID_OFFSET.y / GRID_CELL_SIZE + PLAYER_EDGE_MARGIN,
  maxY: (CANVAS_HEIGHT - GRID_OFFSET.y) / GRID_CELL_SIZE - PLAYER_EDGE_MARGIN,
};

// 点到线段的最短距离（世界格坐标）
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
    return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

// 判断世界格坐标点是否落入任一墙面占位的碰撞余量内（门洞段不在列表中，可自由通行）
export function collidesWithWall(wx: number, wy: number): boolean {
    return WALL_BANDS.some(([a, b]) => distToSegment(wx, wy, a.x, a.y, b.x, b.y) < WALL_BAND_CLEARANCE);
}

// 移动结算（玩家与幽灵共用）：世界格坐标下整体移动被墙挡住时，尝试沿单轴贴墙滑动，
// 双轴都挡住才停下；地图边界 = 画布可视范围（PLAYER_BOUNDS），角色可贴到地图四边附近，
// 房间边界由墙体碰撞接管（只有门洞能进出），返回钳制后的新世界格坐标
export function resolveMovement(wx: number, wy: number, dx: number, dy: number): Position {
    let moveX = dx;
    let moveY = dy;
    if (collidesWithWall(wx + dx, wy + dy)) {
        if (!collidesWithWall(wx + dx, wy)) {
            moveY = 0;
        } else if (!collidesWithWall(wx, wy + dy)) {
            moveX = 0;
        } else {
            moveX = 0;
            moveY = 0;
        }
    }

    return {
        x: Math.max(PLAYER_BOUNDS.minX, Math.min(PLAYER_BOUNDS.maxX, wx + moveX)),
        y: Math.max(PLAYER_BOUNDS.minY, Math.min(PLAYER_BOUNDS.maxY, wy + moveY)),
    };
}
