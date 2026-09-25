// 幽灵寻路（A*）：门破之后幽灵的目标从房门变成玩家本人，而玩家能缩进房间深处、绕去另一个房间、
// 贴着墙角和门框跑 —— 直线扑过去会被墙挡下，落进 GameLogic.stepGhost 的试探改向里来回蹭。
// 这里把「墙面占位 + 可活动边界」离散成一张静态导航格网，用 A* 规划绕墙路线，由 GameLogic 沿路线推进。
// 坐标约定：入参出参与 Ghost.position / Player.position 同为格索引坐标（世界格坐标 = 位置 + 0.5），
// 只有本模块内部换算成世界格坐标去问 Collision.collidesWithWall —— 与移动结算共用同一套墙面判定，
// 格网里连通的路线实走时一定走得通。
import { Position } from '../types';
import { PLAYER_BOUNDS, collidesWithWall } from './Collision';

// ── 导航格网 ────────────────────────────────────────────────────────────

// 路径点间距（格）：门洞通道被两侧墙面占位挤到只剩约 0.3 格宽（门洞净宽 1.1 格 - 两侧各约 0.4 格余量），
// 格距取 0.25 才能让门洞中线那一列节点完整落在通道里 —— 再大就整列陷进墙里，规划不出穿门的路线；
// 再小则节点数成倍增长，收益有限
const NAV_CELL_SIZE = 0.25;
// 格网原点（世界格坐标）：对齐地图网格的半格相位（自 -0.5 起步），使每个格中心（world 坐标的 x.5）
// 都落在节点上 —— 门洞中线、幽灵的啃门站位、两房间之间的走廊中线都是这样的节点，
// 穿门与走廊里的直行因此都能走成一条笔直的节点列
const NAV_ORIGIN: Position = { x: -0.5, y: -0.5 };
const NAV_COLS = Math.floor((PLAYER_BOUNDS.maxX - NAV_ORIGIN.x) / NAV_CELL_SIZE) + 1;
const NAV_ROWS = Math.floor((PLAYER_BOUNDS.maxY - NAV_ORIGIN.y) / NAV_CELL_SIZE) + 1;
const NAV_COUNT = NAV_COLS * NAV_ROWS;
// 就近吸附的搜索半径（节点数）：幽灵与玩家都不一定正好站在节点上（啃门站位、门洞正中都是半格相位），
// 3 圈（0.75 格）足够把最近的落点找出来；再找不到说明这个位置附近根本没有能站的地方
const NAV_SNAP_RADIUS = 3;
// 视线采样的点距（格）：远小于角色碰撞半径（0.3 格），采样点之间漏掉的遮挡最多也就这么点，
// 不会让幽灵顺着墙角的缝隙"看穿"过去
const LINE_SAMPLE_STEP = 0.12;

// 可达格网（1 = 可站立）：节点不被墙面占位覆盖、且落在可活动边界（PLAYER_BOUNDS）内。
// 墙与边界都是静态的，整张网在第一次用到时构建一次即可 ——
// 懒加载同时把这次构建开销推迟到「门真的破了、幽灵开始追人」的那一刻
let navGrid: Uint8Array | null = null;
function walkableGrid(): Uint8Array {
    if (navGrid) return navGrid;
    const grid = new Uint8Array(NAV_COUNT);
    for (let j = 0; j < NAV_ROWS; j++) {
        for (let i = 0; i < NAV_COLS; i++) {
            const wx = NAV_ORIGIN.x + i * NAV_CELL_SIZE;
            const wy = NAV_ORIGIN.y + j * NAV_CELL_SIZE;
            // 边界判定与移动结算的下限钳制同源：网里走得到的点，实走时不会被边界卡住
            const inside = wx >= PLAYER_BOUNDS.minX && wx <= PLAYER_BOUNDS.maxX
                && wy >= PLAYER_BOUNDS.minY && wy <= PLAYER_BOUNDS.maxY;
            grid[j * NAV_COLS + i] = inside && !collidesWithWall(wx, wy) ? 1 : 0;
        }
    }
    navGrid = grid;
    return grid;
}

// 节点下标 -> 位置（格索引坐标）
function nodePosition(node: number): Position {
    const i = node % NAV_COLS;
    const j = (node - i) / NAV_COLS;
    return {
        x: NAV_ORIGIN.x + i * NAV_CELL_SIZE - 0.5,
        y: NAV_ORIGIN.y + j * NAV_CELL_SIZE - 0.5,
    };
}

// 世界格坐标附近最近的可站立节点（找不到返回 -1）
function nearestWalkableNode(wx: number, wy: number): number {
    const grid = walkableGrid();
    const ci = Math.round((wx - NAV_ORIGIN.x) / NAV_CELL_SIZE);
    const cj = Math.round((wy - NAV_ORIGIN.y) / NAV_CELL_SIZE);
    let best = -1;
    let bestDist = Infinity;
    for (let dj = -NAV_SNAP_RADIUS; dj <= NAV_SNAP_RADIUS; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= NAV_ROWS) continue;
        for (let di = -NAV_SNAP_RADIUS; di <= NAV_SNAP_RADIUS; di++) {
            const i = ci + di;
            if (i < 0 || i >= NAV_COLS) continue;
            const node = j * NAV_COLS + i;
            if (!grid[node]) continue;
            const dist = di * di + dj * dj;
            if (dist < bestDist) {
                bestDist = dist;
                best = node;
            }
        }
    }
    return best;
}

// ── A* ─────────────────────────────────────────────────────────────────

// 二叉小顶堆（存节点下标，键为 fScore）：开表按 f 值取最小。
// 格网约两千节点，线性扫开表在「每隔几百毫秒重规划一次」的频率下会明显拖帧，用堆把单次规划压回常数级别
class NodeHeap {
    private items: number[] = [];

    constructor(private keys: Float64Array) {}

    get size(): number {
        return this.items.length;
    }

    push(node: number) {
        this.items.push(node);
        let i = this.items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.keys[this.items[parent]] <= this.keys[this.items[i]]) break;
            const tmp = this.items[parent];
            this.items[parent] = this.items[i];
            this.items[i] = tmp;
            i = parent;
        }
    }

    pop(): number {
        const top = this.items[0];
        const last = this.items.pop() as number;
        if (this.items.length > 0) {
            this.items[0] = last;
            let i = 0;
            for (;;) {
                const left = i * 2 + 1;
                const right = left + 1;
                let min = i;
                if (left < this.items.length && this.keys[this.items[left]] < this.keys[this.items[min]]) min = left;
                if (right < this.items.length && this.keys[this.items[right]] < this.keys[this.items[min]]) min = right;
                if (min === i) break;
                const tmp = this.items[min];
                this.items[min] = this.items[i];
                this.items[i] = tmp;
                i = min;
            }
        }
        return top;
    }
}

// 一次 A* 搜索（入参为节点下标）：8 邻接，无路可走返回 null。
// 记账数组按节点数一次性建好 —— 单次规划最多几千节点，重建比维护「打戳复用」的几个数组更直白
function searchPath(startNode: number, goalNode: number): number[] | null {
    const grid = walkableGrid();
    const gScore = new Float64Array(NAV_COUNT).fill(Infinity);
    const fScore = new Float64Array(NAV_COUNT).fill(Infinity);
    const cameFrom = new Int32Array(NAV_COUNT).fill(-1);
    const closed = new Uint8Array(NAV_COUNT);
    const heap = new NodeHeap(fScore);
    const goalI = goalNode % NAV_COLS;
    const goalJ = (goalNode - goalI) / NAV_COLS;

    // octile 启发：8 邻接下的理想代价（直线段 + 斜线段），不会高估，保证 A* 找到的是最短路线
    const heuristic = (node: number): number => {
        const i = node % NAV_COLS;
        const j = (node - i) / NAV_COLS;
        const di = Math.abs(i - goalI);
        const dj = Math.abs(j - goalJ);
        return di + dj + (Math.SQRT2 - 2) * Math.min(di, dj);
    };

    gScore[startNode] = 0;
    fScore[startNode] = heuristic(startNode);
    heap.push(startNode);

    while (heap.size > 0) {
        const current = heap.pop();
        if (current === goalNode) {
            // 回溯出节点路径（起点 → 终点）
            const path: number[] = [];
            for (let node = current; node !== -1; node = cameFrom[node]) path.push(node);
            return path.reverse();
        }
        // 同一个节点可能被以旧代价压进堆多次，弹出过期版本直接跳过
        if (closed[current]) continue;
        closed[current] = 1;

        const ci = current % NAV_COLS;
        const cj = (current - ci) / NAV_COLS;
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                if (di === 0 && dj === 0) continue;
                const i = ci + di;
                const j = cj + dj;
                if (i < 0 || i >= NAV_COLS || j < 0 || j >= NAV_ROWS) continue;
                const next = j * NAV_COLS + i;
                if (!grid[next] || closed[next]) continue;
                // 斜向不许贴角：两个正交邻格都得站得住，否则会从墙角、门框上蹭过去
                if (di !== 0 && dj !== 0 && (!grid[cj * NAV_COLS + i] || !grid[j * NAV_COLS + ci])) continue;

                const tentative = gScore[current] + (di !== 0 && dj !== 0 ? Math.SQRT2 : 1);
                if (tentative >= gScore[next]) continue;
                gScore[next] = tentative;
                cameFrom[next] = current;
                fScore[next] = tentative + heuristic(next);
                heap.push(next);
            }
        }
    }
    return null;
}

// ── 对外接口 ────────────────────────────────────────────────────────────

// 规划 from → to 的路线（格索引坐标）：返回路点数组（含起点与终点所在节点），无路可走返回 null。
// 终点节点只是「离目标最近的可站格」（目标本身可能站在半格相位或紧贴墙边），
// 最后一小截由调用方直接朝目标本人推进，不必也不该由格网负责
export function findPath(from: Position, to: Position): Position[] | null {
    const startNode = nearestWalkableNode(from.x + 0.5, from.y + 0.5);
    const goalNode = nearestWalkableNode(to.x + 0.5, to.y + 0.5);
    if (startNode < 0 || goalNode < 0) return null;
    if (startNode === goalNode) return [nodePosition(startNode)];

    const nodes = searchPath(startNode, goalNode);
    return nodes ? nodes.map(nodePosition) : null;
}

// 两点之间是否一条直线无遮挡（格索引坐标入参）：追击时朝「路径上最远的可见路点」推进，
// 把网格折线拉成直线 —— 否则幽灵会贴着格网走出一串锯齿，路点越密越明显
export function hasClearLine(from: Position, to: Position): boolean {
    const ax = from.x + 0.5;
    const ay = from.y + 0.5;
    const bx = to.x + 0.5;
    const by = to.y + 0.5;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / LINE_SAMPLE_STEP));
    // 从第 1 个采样点起扫（起点就是幽灵自己，必不撞墙），终点取到 steps
    for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        if (collidesWithWall(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
}

// ── 追击节奏（GameLogic 沿路线推进时用）────────────────────────────────

// 重规划间隔（ms）：玩家一直在动，路线得跟着更新；A* 单次只扫一小片格网，
// 200ms 一次既跟得上走位，也不至于每帧都算
export const GHOST_CHASE_REPLAN_MS = 200;
// 玩家相对「规划时所在位置」走开这么多（格）就立即重规划，不必等间隔到点
export const GHOST_CHASE_GOAL_TOLERANCE = 0.5;
// 幽灵离当前路点超过这么多（格）说明路线已经对不上它的实际位置（被墙滑开、卡过、被挤到别处），立即重规划
export const GHOST_CHASE_DRIFT = 1.0;
// 路点达成距离（格）：贴到路点这么近就算走过，免得到位前后在路点附近来回弹
export const GHOST_CHASE_WAYPOINT_REACH = 0.25;
// 单帧向前看的路点数上限：路径点密（0.25 格一个），看这么多（约 5 格）已经足够把折线拉直；
// 一路扫到终点会在长路线上做几十次视线采样，白白吃掉每帧预算
export const GHOST_CHASE_AIM_NODES = 20;
