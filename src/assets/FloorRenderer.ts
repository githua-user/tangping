import { Position } from '../types';
import { GRID_CELL_SIZE, GRID_OFFSET, ROOM_ORIGINS, ROOM_COLS, ROOM_ROWS, ROOM_OUTLINES, ROOM_DOOR_GAP, WALL_BODY_WIDTH, wallLift } from '../engine/Collision';

// 左房间木地板的三档暖木色：逐块按确定性哈希分配，避免整片地板色调死板重复
const WOOD_TONES = ['#3c2a1c', '#352417', '#41301f'];

// 确定性伪随机（0 ≤ 返回值 < 1）：以整数对为种子生成稳定的明暗/形态扰动，
// 保证离屏地板缓存每次重建得到一致的纹理，不会闪变；Renderer 的门板/幽灵等细节抖动也共用它
export function hash01(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// 静态场景绘制（地板/墙体/砖缝/污渍/划痕/光斑）：内容只依赖 Collision 常量与画布尺寸、与游戏状态无关，
// 因此整体离屏预渲染一次（drawFloor 内按主画布尺寸失效重建），之后每帧仅贴图复用；
// 构建缓存时新建一个绑定离屏上下文的同类实例作画，主实例始终面向主画布
export class FloorRenderer {
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;
  private cellSize: number = GRID_CELL_SIZE; // 单个网格单元格的像素边长
  private gridOffset: Position = GRID_OFFSET; // 网格原点相对画布左上角的偏移（用于把场地居中）
  // 静态场景离屏缓存：内容只依赖常量与画布尺寸，与游戏状态无关
  private floorCache: HTMLCanvasElement | null = null;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  // 静态地板/墙体：首次渲染时把静态场景整体预渲染到离屏 canvas，之后每帧仅 drawImage；
  // 缓存按主画布尺寸失效（尺寸变化时自动重建）
  public drawFloor(width: number, height: number) {
    if (
      !this.floorCache
      || this.floorCache.width !== width
      || this.floorCache.height !== height
    ) {
      this.floorCache = this.buildCache(width, height);
    }
    this.ctx.drawImage(this.floorCache, 0, 0);
  }

  // 构建离屏缓存：新建同尺寸离屏 canvas，交给绑定该离屏上下文的同类实例一次画完
  private buildCache(width: number, height: number): HTMLCanvasElement {
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const painter = new FloorRenderer(off.getContext('2d')!);
    painter.width = width;
    painter.height = height;
    painter.render();
    return off;
  }

  // 静态场景总编排：先铺走廊，再逐房间绘制地板与墙体（仅构建离屏缓存时执行）
  private render() {
    this.ctx.save();
    // 房间之外是同一楼层的公共走廊：铺室内水磨石地砖（与房间同网格模数）、旧污渍、划痕与顶灯光斑，
    // 房间随后绘制并覆盖中央区域，走廊在本层四周与两房之间露出
    this.drawFloorCorridor();

    // 两个独立房间：各自按尺寸绘制地面与墙体（不规则轮廓多边形），底边门洞处墙体断开留出口
    ROOM_ORIGINS.forEach((origin, index) => {
        const roomCols = ROOM_COLS[index];
        const roomRows = ROOM_ROWS[index];
        const roomWidth = roomCols * this.cellSize;
        const roomHeight = roomRows * this.cellSize;
        const ox = this.gridOffset.x + origin.x * this.cellSize;
        const oy = this.gridOffset.y + origin.y * this.cellSize;
        const outline = ROOM_OUTLINES[index % ROOM_OUTLINES.length];
        const [gapRight, gapLeft] = ROOM_DOOR_GAP;

        // 房间底色：按闭合轮廓填充多边形（含门洞下方），保证门前地面与室内连续
        this.traceOutline(ox, oy, outline, 0, outline.length - 1, true);
        this.ctx.fillStyle = '#252535';
        this.ctx.fill();

        // 房间地板：裁剪到轮廓内按房间风格绘制纹理（两房间风格各异），门前地面与室内连续；
        // 左房间为暖色木地板，右房间为冷色石砖地砖（均为离屏缓存中的一次性静态绘制）
        this.ctx.save();
        this.traceOutline(ox, oy, outline, 0, outline.length - 1, true);
        this.ctx.clip();
        if (index === 0) {
            this.drawWoodFloor(ox, oy, roomWidth, roomHeight);
        } else {
            this.drawStoneTileFloor(ox, oy, roomWidth, roomHeight);
        }
        this.ctx.restore();

        // 墙内侧的地面投影：裁剪到轮廓内沿墙描半透明黑，仅露出内侧一半，增强墙体的立体厚度感
        this.ctx.save();
        this.traceOutline(ox, oy, outline, 0, outline.length - 1, true);
        this.ctx.clip();
        this.ctx.lineJoin = 'round';
        this.traceOutline(ox, oy, outline, gapLeft, gapRight, false);
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)';
        this.ctx.lineWidth = 24;
        this.ctx.stroke();
        this.ctx.restore();

        // 房间墙体：石砖墙（立面向上抬出后倾厚度 + 顶面分层受光 + 落影 + 顶面浮雕砖缝），门洞段跳过
        this.drawWalls(ox, oy, outline, gapRight, gapLeft);

        // 门洞两侧的门柱/门楣/门槛改由 drawDoors 逐帧绘制（与门板共用同一套倾斜几何，
        // 柱身同时盖住墙在门洞处的断面，因此这里不再画旧的俯视小方块）
    });

    this.ctx.restore();
  }

  // 房间之外的公共走廊地面（同一楼层的室内走廊）：按 60px 建筑模数铺方形水磨石地砖，与房间共用同一网格原点
  // （砖缝 + 逐砖倒角/明暗抖动 + 骨料细点，少量砖做破损暗斑与裂纹），再叠旧污渍、拖拽划痕与顶灯光斑；
  // 只在离屏地板缓存构建时执行一次，随机量全部走 hash01，保证缓存重建时纹理稳定不闪变
  private drawFloorCorridor() {
    const w = this.width;
    const h = this.height;
    const cell = this.cellSize;
    const ox = this.gridOffset.x;
    const oy = this.gridOffset.y;

    // 砖缝底色：整块暗色，垫在每块地砖之下形成缝
    this.ctx.fillStyle = '#0d0d13';
    this.ctx.fillRect(0, 0, w, h);

    // 方形水磨石地砖：自网格原点外扩铺满画布（房间区域随后被房间盖住）
    const tileTones = ['#1c1c26', '#20202c', '#181823'];
    const cols = Math.ceil((w - ox) / cell) + 1;
    const rows = Math.ceil((h - oy) / cell) + 1;
    for (let r = -1; r <= rows; r++) {
      for (let c = -1; c <= cols; c++) {
        const x = ox + c * cell;
        const y = oy + r * cell;
        const tile = cell - 3; // 四周留 1.5px 砖缝

        // 逐砖取色调 + 明暗抖动：同色砖也不整片死板
        this.ctx.fillStyle = tileTones[Math.floor(hash01(r * 7 + 1, c * 11 + 2) * tileTones.length)];
        this.ctx.fillRect(x + 1.5, y + 1.5, tile, tile);
        const jitter = hash01(r * 13 + 3, c * 17 + 5) * 0.05 - 0.025;
        this.ctx.fillStyle = jitter > 0 ? `rgba(255, 255, 255, ${jitter})` : `rgba(0, 0, 0, ${-jitter})`;
        this.ctx.fillRect(x + 1.5, y + 1.5, tile, tile);

        // 骨料细点：每砖几粒深浅不一的水磨石斑点
        for (let k = 0; k < 3; k++) {
          const sx = x + 5 + hash01(r * 41 + k, c * 43 + k) * (cell - 10);
          const sy = y + 5 + hash01(r * 47 + k, c * 53 + k) * (cell - 10);
          const spot = 1.2 + hash01(r * 67 + k, c * 71 + k) * 1.8;
          this.ctx.fillStyle = hash01(r * 59 + k, c * 61 + k) > 0.5
            ? 'rgba(180, 190, 215, 0.07)'
            : 'rgba(0, 0, 0, 0.18)';
          this.ctx.fillRect(sx, sy, spot, spot);
        }

        // 倒角：上/左受光，下/右落影
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        this.ctx.fillRect(x + 1.5, y + 1.5, tile, 1.5);
        this.ctx.fillRect(x + 1.5, y + 1.5, 1.5, tile);
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        this.ctx.fillRect(x + 1.5, y + cell - 3, tile, 1.5);
        this.ctx.fillRect(x + cell - 3, y + 1.5, 1.5, tile);

        // 破损砖：整体压暗 + 一道随哈希抖动的折线裂缝
        if (hash01(r * 31 + 7, c * 19 + 4) < 0.09) {
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
          this.ctx.fillRect(x + 1.5, y + 1.5, tile, tile);
          const jx = (n: number) => (hash01(r + n, c - n) - 0.5) * cell * 0.4;
          this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
          this.ctx.lineWidth = 1.4;
          this.ctx.beginPath();
          this.ctx.moveTo(x + cell * 0.2 + jx(1), y + cell * 0.12 + jx(2));
          this.ctx.lineTo(x + cell * 0.52 + jx(3), y + cell * 0.5 + jx(4));
          this.ctx.lineTo(x + cell * 0.34 + jx(5), y + cell * 0.9 + jx(6));
          this.ctx.stroke();
        }
      }
    }

    // 旧污渍：中性暗渍为主、少量暗红渍，像多年没清洗过的楼道地面
    for (let i = 0; i < 6; i++) {
      const x = hash01(i * 53 + 6, 89) * w;
      const y = hash01(i * 59 + 7, 97) * h;
      const r = 26 + hash01(i * 61 + 8, 101) * 40;
      const stain = this.ctx.createRadialGradient(x, y, 0, x, y, r);
      stain.addColorStop(0, i % 3 === 2 ? 'rgba(70, 12, 16, 0.1)' : 'rgba(0, 0, 0, 0.3)');
      stain.addColorStop(1, 'rgba(0, 0, 0, 0)');
      this.ctx.fillStyle = stain;
      this.ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // 拖拽划痕：两个门前与幽灵入场门内外各留几组，像有东西在楼道里刨抓拖行过
    this.drawClawMarks(195, 485, -0.25, 74, 101); // 左房门外
    this.drawClawMarks(300, 508, 0.28, 62, 102);
    this.drawClawMarks(500, 170, 1.3, 64, 103); // 两房之间的走廊
    this.drawClawMarks(545, 330, 1.45, 58, 104);
    this.drawClawMarks(745, 515, -0.3, 76, 105); // 右房门外
    // 左下角入场门外：三组爪痕自门口爬向走廊，交代幽灵是从这扇门里出来的
    this.drawClawMarks(186, 546, -0.32, 66, 107);
    this.drawClawMarks(258, 522, -0.38, 58, 108);

    // 结构裂纹：底边附近几条长裂缝，旧楼地面年久开裂
    this.drawGroundCrack(320, 585, -1.15, 95, 401);
    this.drawGroundCrack(690, 590, -1.35, 80, 402);
    this.drawGroundCrack(512, 420, 1.35, 70, 403);

    // 顶灯冷色光斑：楼道灯的微弱照明，给走廊一点室内照明感（位置固定，对应楼道灯位）
    const pools: Position[] = [
      { x: 530, y: 120 }, { x: 530, y: 300 }, { x: 530, y: 445 },
      { x: 240, y: 520 }, { x: 520, y: 545 }, { x: 780, y: 510 },
      { x: 80, y: 520 }, { x: 920, y: 515 },
    ];
    pools.forEach((p) => {
      const r = 120 + hash01(p.x, p.y) * 60;
      const pool = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      pool.addColorStop(0, 'rgba(148, 168, 200, 0.055)');
      pool.addColorStop(0.6, 'rgba(148, 168, 200, 0.025)');
      pool.addColorStop(1, 'rgba(148, 168, 200, 0)');
      this.ctx.fillStyle = pool;
      this.ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    });

    // 走廊尽头的暗角：画布四边渐入黑暗，像走廊延伸进没有灯的深处
    const edgeV = this.ctx.createLinearGradient(0, 0, 0, h);
    edgeV.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    edgeV.addColorStop(0.16, 'rgba(0, 0, 0, 0)');
    edgeV.addColorStop(0.74, 'rgba(0, 0, 0, 0)');
    edgeV.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    this.ctx.fillStyle = edgeV;
    this.ctx.fillRect(0, 0, w, h);
    const edgeH = this.ctx.createLinearGradient(0, 0, w, 0);
    edgeH.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
    edgeH.addColorStop(0.12, 'rgba(0, 0, 0, 0)');
    edgeH.addColorStop(0.88, 'rgba(0, 0, 0, 0)');
    edgeH.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    this.ctx.fillStyle = edgeH;
    this.ctx.fillRect(0, 0, w, h);
  }

  // 一条地面裂纹：自 (x, y) 沿 angle 方向延伸的折线（每步方向小角度摆动、步长递减），
  // 深色裂口上再细描一道冷色棱边，在暗色砖面上隐约可辨；seed 决定摆动与分叉，保证缓存重建一致
  private drawGroundCrack(x: number, y: number, angle: number, length: number, seed: number) {
    const steps = 5;
    const pts: Position[] = [{ x, y }];
    let dir = angle;
    for (let i = 1; i <= steps; i++) {
      const stepLen = (length / steps) * (1.15 - i * 0.15);
      dir += (hash01(seed, i * 3) - 0.5) * 1.1;
      const last = pts[pts.length - 1];
      pts.push({ x: last.x + Math.cos(dir) * stepLen, y: last.y + Math.sin(dir) * stepLen });
    }

    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) this.ctx.lineTo(pts[i].x, pts[i].y);
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    // 同路径再细描一道冷色棱边，让裂口在黑暗中带一点幽冷反光
    this.ctx.strokeStyle = 'rgba(104, 116, 150, 0.12)';
    this.ctx.lineWidth = 1.2;
    this.ctx.stroke();

    // 分叉：从中段斜向伸出一条短支线，避免裂纹成为单根直线
    const fork = pts[2];
    const forkAngle = dir + (hash01(seed, 97) > 0.5 ? 0.9 : -0.9);
    this.ctx.beginPath();
    this.ctx.moveTo(fork.x, fork.y);
    this.ctx.lineTo(fork.x + Math.cos(forkAngle) * length * 0.32, fork.y + Math.sin(forkAngle) * length * 0.32);
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }

  // 一组三道爪痕：三条平行微弯的抓裂线（深色凹痕上叠细亮刮棱），像有东西在地面刨抓过；
  // 位置/朝向由调用方给出，弯曲量由 seed 决定，属离屏静态缓存内容
  private drawClawMarks(x: number, y: number, angle: number, length: number, seed: number) {
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle);
    this.ctx.lineCap = 'round';
    for (let k = -1; k <= 1; k++) {
      const off = k * 8; // 三道痕的横向间距
      const bow = (hash01(seed, k + 2) - 0.5) * 12; // 每道的弯弧幅度略有差异
      const len = length * (1 - Math.abs(k) * 0.14); // 中间那道最长，两侧渐短
      this.ctx.beginPath();
      this.ctx.moveTo(0, off);
      this.ctx.quadraticCurveTo(len * 0.5, off + bow, len, off + bow * 0.35);
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
      this.ctx.strokeStyle = 'rgba(150, 158, 185, 0.13)';
      this.ctx.lineWidth = 1.2;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  // 左房间地板：暖色木地板 —— 1 格长 x 半格高的窄板按奇偶行错缝铺设（跑砖缝），
  // 逐块哈希分配色调，配板端勾缝/上下倒角/横纹木纹，最后叠暖色环境光，做出室内木地板质感；
  // 行起点从 -1 外扩一格，保证轮廓顶部/两侧凸出的小结构也有纹理，不会露出底色
  private drawWoodFloor(ox: number, oy: number, width: number, height: number) {
    const cell = this.cellSize;
    const plankLen = cell; // 板长 1 格、板高半格：细窄木板，纹理仍与可建造格对齐
    const plankH = cell / 2;

    // 接缝底色（板与板之间的暗色缝隙），外扩一格覆盖轮廓凸出区域
    this.ctx.fillStyle = '#241810';
    this.ctx.fillRect(ox - cell, oy - cell, width + cell * 2, height + cell * 2);

    const rows = Math.ceil(height / plankH) + 1;
    for (let r = -1; r < rows; r++) { // r 从 -1 起：轮廓顶边上方凸出的小结构也要铺上木板
      const y = oy + r * plankH;
      const stagger = (Math.abs(r) % 2) * (plankLen / 2); // 奇偶行错开半块板，形成错缝
      let k = 0;
      for (let x = ox - plankLen + stagger; x <= ox + width; x += plankLen, k++) {
        // 逐块取确定性哈希：三档暖木色轮换 + 木纹相位抖动
        const tone = WOOD_TONES[Math.floor(hash01(r, k) * WOOD_TONES.length)];
        this.ctx.fillStyle = tone;
        this.ctx.fillRect(x, y, plankLen, plankH);

        // 板端勾缝：每块板左缘的深色缝（右侧相邻板会画出自己的缝）
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        this.ctx.fillRect(x, y, 2, plankH);

        // 板面倒角：上缘受光提亮、下缘压暗，形成木板厚度感
        this.ctx.fillStyle = 'rgba(255, 214, 170, 0.06)';
        this.ctx.fillRect(x + 2, y + 1, plankLen - 2, 1);
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
        this.ctx.fillRect(x + 2, y + plankH - 2, plankLen - 2, 2);

        // 木纹：一道横向暗纹 + 一道亮纹，随哈希相位起伏
        const phase = hash01(k + 5, r + 9) * Math.PI * 2;
        this.ctx.lineWidth = 1;
        const gy = y + plankH * 0.34;
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
        this.ctx.beginPath();
        this.ctx.moveTo(x + 3, gy);
        this.ctx.quadraticCurveTo(x + plankLen / 2, gy + Math.sin(phase) * 1.8, x + plankLen - 3, gy);
        this.ctx.stroke();
        const gy2 = y + plankH * 0.68;
        this.ctx.strokeStyle = 'rgba(255, 210, 160, 0.05)';
        this.ctx.beginPath();
        this.ctx.moveTo(x + 4, gy2);
        this.ctx.quadraticCurveTo(x + plankLen / 2, gy2 + Math.cos(phase) * 1.5, x + plankLen - 4, gy2);
        this.ctx.stroke();
      }
    }

    // 暖色环境光：房间中心一抹柔光模拟室内照明，靠近墙面自然收暗
    const glow = this.ctx.createRadialGradient(
      ox + width / 2, oy + height / 2, 20,
      ox + width / 2, oy + height / 2, Math.max(width, height) * 0.62
    );
    glow.addColorStop(0, 'rgba(255, 184, 105, 0.07)');
    glow.addColorStop(1, 'rgba(255, 184, 105, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(ox - cell, oy - cell, width + cell * 2, height + cell * 2);
  }

  // 右房间地板：冷色石砖地砖 —— 半格见方的双色方砖棋盘交错，配勾缝与逐砖倒角，
  // 少量砖按哈希做破损（污渍 + 裂纹），叠冷色反光，与左房间木地板形成冷暖两种房间风格
  private drawStoneTileFloor(ox: number, oy: number, width: number, height: number) {
    const tile = this.cellSize / 2; // 半格一块：棋盘周期恰为一格，可建造格仍可辨
    const gap = 1.5; // 勾缝宽
    const body = tile - gap * 2;

    // 勾缝底色（四周外扩一格：轮廓顶部/两侧凸出的小结构也要盖到）
    this.ctx.fillStyle = '#15151f';
    this.ctx.fillRect(ox - tile, oy - tile, width + tile * 2, height + tile * 2);

    const cols = Math.ceil(width / tile) + 1;
    const rows = Math.ceil(height / tile) + 1;
    for (let r = -1; r < rows; r++) { // r/c 从 -1 起：外扩一行一列覆盖轮廓凸出区域
      for (let c = -1; c < cols; c++) {
        const x = ox + c * tile;
        const y = oy + r * tile;

        // 棋盘双色方砖，同色砖再按哈希微调明暗，避免整片死板
        this.ctx.fillStyle = (r + c) % 2 === 0 ? '#2b2b41' : '#242437';
        this.ctx.fillRect(x + gap, y + gap, body, body);
        const jitter = hash01(r * 7 + 1, c * 13 + 2) * 0.06 - 0.03;
        this.ctx.fillStyle = jitter > 0 ? `rgba(255, 255, 255, ${jitter})` : `rgba(0, 0, 0, ${-jitter})`;
        this.ctx.fillRect(x + gap, y + gap, body, body);

        // 逐砖倒角：上/左受光提亮，下/右落影
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.055)';
        this.ctx.fillRect(x + gap, y + gap, body, 1.5);
        this.ctx.fillRect(x + gap, y + gap, 1.5, body);
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.ctx.fillRect(x + gap, y + tile - gap - 1.5, body, 1.5);
        this.ctx.fillRect(x + tile - gap - 1.5, y + gap, 1.5, body);

        // 破损砖：整体压暗 + 一条随哈希抖动的折线裂纹，给房间添点使用痕迹
        if (hash01(r * 31 + 7, c * 17 + 3) < 0.07) {
          this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
          this.ctx.fillRect(x + gap, y + gap, body, body);
          const jx = (n: number) => (hash01(r + n, c - n) - 0.5) * tile * 0.3;
          this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(x + tile * 0.22 + jx(1), y + tile * 0.16 + jx(2));
          this.ctx.lineTo(x + tile * 0.56 + jx(3), y + tile * 0.5 + jx(4));
          this.ctx.lineTo(x + tile * 0.34 + jx(5), y + tile * 0.86 + jx(6));
          this.ctx.stroke();
        }
      }
    }

    // 冷色反光：中心偏蓝的柔光，与左房间暖光形成冷暖分界
    const glow = this.ctx.createRadialGradient(
      ox + width / 2, oy + height / 2, 20,
      ox + width / 2, oy + height / 2, Math.max(width, height) * 0.62
    );
    glow.addColorStop(0, 'rgba(120, 150, 255, 0.06)');
    glow.addColorStop(1, 'rgba(120, 150, 255, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.fillRect(ox - tile, oy - tile, width + tile * 2, height + tile * 2);
  }

  // 石砖墙（后倾盒子）：轮廓顶点按 wallLift 沿屏幕向上抬起，墙因此从「俯视一条带」变成有立面 + 顶面的墙体。
  // 分三层绘制：1) 立面——把砖身带宽度的路径自墙线逐层抬到墙顶，统一用一条房间级纵向渐变描边
  // （颜色只由位置决定，层与层重叠处不会出现横向接缝），远墙亮、近墙暗；
  // 2) 顶面——原 6 层分层描边整体平移到抬升后的路径，砖身层的落影自然投在立面上，顶缘高光变成盒子顶棱；
  // 3) 顶面砖缝——沿抬升后的路径画浮雕砖缝，砖块出现在盒子顶棱上。门洞段整体跳过，断面由门的门柱盖住
  private drawWalls(ox: number, oy: number, outline: Position[], gapRight: number, gapLeft: number) {
    this.ctx.setLineDash([]);
    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';

    const lift = wallLift(outline);

    // 立面：自墙线（lift = 0）逐层抬到墙顶（lift = 1），每层用同一条纵向渐变描边
    const baseYs = outline.map((p) => oy + p.y * this.cellSize);
    const topYs = outline.map((p, i) => oy + p.y * this.cellSize - lift[i]);
    const face = this.ctx.createLinearGradient(0, Math.max(...baseYs), 0, Math.min(...topYs));
    face.addColorStop(0, '#1e1e2f'); // 近端（画面下方）：背光更暗
    face.addColorStop(0.5, '#32324f');
    face.addColorStop(1, '#4a4a70'); // 远端（画面上方）：受光更亮
    const steps = 18; // 步长 26 / 18 ≈ 1.5px，远小于砖身带宽，扫出的立面连续无缝
    this.ctx.strokeStyle = face;
    this.ctx.lineWidth = WALL_BODY_WIDTH;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      this.traceOutline(ox, oy, outline, gapLeft, gapRight, false, lift.map((l) => l * f));
      this.ctx.stroke();
    }

    // 顶面分层表：[偏移 dx, 偏移 dy, 描边宽, 颜色]，自最深外沿到顶缘高光依次描边；
    // 偏移量作用于屏幕空间，任意走向的墙段都保持「左上受光、右下落影」的一致光照
    const layers: Array<[number, number, number, string]> = [
      [1.6, 2, 16, '#0a0a13'], // 最深外沿：墙脚与地面的交界暗边
      [0.8, 1, 14, '#262640'], // 右下背光面
      [0, 0, WALL_BODY_WIDTH, '#3a3a58'], // 砖身主体（此层带落影）
      [-1.2, -1.5, 8.5, '#4a4a70'], // 左上受光面
      [-2.2, -2.8, 4.5, '#5c5c8a'], // 亮棱
      [-3, -3.8, 1.6, '#7171a4'], // 顶缘高光细线
    ];
    layers.forEach(([dx, dy, width, color], i) => {
      this.ctx.save();
      if (i === 2) {
        // 落影：砖身层向屏幕右下方投出柔和阴影，阴影落在墙的立面上
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        this.ctx.shadowOffsetX = 2.5;
        this.ctx.shadowOffsetY = 3.5;
        this.ctx.shadowBlur = 7;
      }
      this.ctx.translate(dx, dy);
      this.traceOutline(ox, oy, outline, gapLeft, gapRight, false, lift);
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = width;
      this.ctx.stroke();
      this.ctx.restore();
    });

    // 砖缝：画在抬升后的顶面上，沿墙每 15px 一条，带受光凸缘的浮雕凹缝
    this.drawBrickSeams(ox, oy, outline, gapLeft, gapRight, 15, lift);
  }

  // 沿轮廓路径（从 from 环绕走到 to）每隔 spacing 像素画一条垂直于墙走向的浮雕砖缝：
  // 先画一条向屏幕左上偏移的受光凸缘亮线，再以深色凹缝压在其右下侧，亮缘只在缝左上残留一线，
  // 砖块因此像凸起的石块；缝的半长与沿线位置带逐条哈希微扰，像手工砌筑的石块。
  // lift 为逐点抬升量（px）：有值时整条缝沿墙顶路径落笔（砖缝因此长在盒子顶面上）
  private drawBrickSeams(ox: number, oy: number, pts: Position[], from: number, to: number, spacing: number, lift?: number[]) {
    const n = pts.length;
    const pathIdx: number[] = [from];
    for (let i = from; i !== to; ) {
      i = (i + 1) % n;
      pathIdx.push(i);
    }

    let traveled = 0;
    let nextSeam = spacing / 2; // 首条缝从半间距处开始，避免贴着门洞边缘
    let seamIndex = 0;
    for (let k = 0; k < pathIdx.length - 1; k++) {
      const ia = pathIdx[k];
      const ib = pathIdx[k + 1];
      const ax = ox + pts[ia].x * this.cellSize;
      const ay = oy + pts[ia].y * this.cellSize - (lift ? lift[ia] : 0);
      const bx = ox + pts[ib].x * this.cellSize;
      const by = oy + pts[ib].y * this.cellSize - (lift ? lift[ib] : 0);
      const segLen = Math.hypot(bx - ax, by - ay);
      if (segLen < 1) continue;
      const ux = (bx - ax) / segLen;
      const uy = (by - ay) / segLen;
      while (nextSeam < traveled + segLen) {
        const t = (nextSeam - traveled) / segLen;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        // 缝垂直于墙走向、横跨砖面（半长 ≈ 砖身半宽）；半长与沿墙位置逐条微扰
        const half = 4.6 + hash01(seamIndex, 11) * 1.2;
        const slide = (hash01(seamIndex, 23) - 0.5) * 2.4;
        const cx = x + ux * slide;
        const cy = y + uy * slide;
        // 受光凸缘：向屏幕左上偏移 1.3px 的亮线（先画，随后被凹缝压住右下侧）
        this.ctx.strokeStyle = 'rgba(150, 152, 205, 0.3)';
        this.ctx.lineWidth = 1.4;
        this.ctx.beginPath();
        this.ctx.moveTo(cx - uy * half - 1.3, cy + ux * half - 1.3);
        this.ctx.lineTo(cx + uy * half - 1.3, cy - ux * half - 1.3);
        this.ctx.stroke();
        // 凹缝本体：深色压在亮线右下侧，亮缘只在缝左上残留一线
        this.ctx.strokeStyle = '#14141f';
        this.ctx.lineWidth = 2.2;
        this.ctx.beginPath();
        this.ctx.moveTo(cx - uy * half, cy + ux * half);
        this.ctx.lineTo(cx + uy * half, cy - ux * half);
        this.ctx.stroke();
        nextSeam += spacing;
        seamIndex++;
      }
      traveled += segLen;
    }
  }

  // 按轮廓点索引描路径：从 from 沿数组顺序环绕画到 to（可跨越 0 环绕），close 决定是否闭合；
  // lift 为逐点额外 y 偏移（px，墙体后倾抬升用），不传则按原始轮廓落笔
  private traceOutline(ox: number, oy: number, pts: Position[], from: number, to: number, close: boolean, lift?: number[]) {
    const n = pts.length;
    const py = (i: number) => oy + pts[i].y * this.cellSize - (lift ? lift[i] : 0);
    this.ctx.beginPath();
    this.ctx.moveTo(ox + pts[from].x * this.cellSize, py(from));
    for (let i = from; i !== to; ) {
      i = (i + 1) % n;
      this.ctx.lineTo(ox + pts[i].x * this.cellSize, py(i));
    }
    if (close) this.ctx.closePath();
  }
}

