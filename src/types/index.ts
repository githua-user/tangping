export interface Position {
  x: number;
  y: number;
}

export interface Door {
  id: string;
  position: Position; 
  health: number;
  maxHealth: number; 
  level: number;
  isBroken: boolean; 
}
export interface Bed {
  id: string;
  position: Position; 
  level: number;
  isSleeping: boolean;
}
export interface Turret {
  id: string;
  position: Position;
  level: number;
  damage: number;
  range: number;
  fireInterval: number;
  lastShot: number;
}

export interface Ghost {
  health: number;
  maxHealth: number;
  position: Position;
  attackPower: number;
  speed: number;
  
  // 锁定的攻击目标门：出场时锁定为玩家床铺所在房间的那扇门。
  targetDoor: string | null;
  // DORMANT：玩家第一次上床睡觉前的潜伏态，藏在左下角入场门后，不移动、不结算任何伤害；
  // ATTACKING：沿走廊走到锁定房门正前方啃门；CHASING：锁定房门已破，直接追玩家；
  // RETREATING：半血逃跑中，掉头往入场门跑（这一段仍会被炮塔打，是唯一补刀窗口）；
  // HEALING：缩进入场门洞里回血，期间免伤、数值也不再成长，回满后从门里再钻出来
  state: 'DORMANT' | 'ATTACKING' | 'CHASING' | 'RETREATING' | 'HEALING';
  // 破门出场时刻,尚未出场时为 -1
  spawnTime: number;
  // 最近一次从入场门洞里钻出来的时刻：出场时与 spawnTime 相同，每次回满血再出场时刷新
  emergeTime: number;
  // 成长累计时长不在回血时累加，血量/攻击/速度都由它换算
  growthMs: number;
}
export interface Player {
  id: string;
  position: Position;
  gold: number;
  speed: number;
}

// 炮塔子弹：从炮塔飞向目标位置，命中时才结算伤害
export interface Projectile {
  id: string;
  from: Position; 
  to: Position; 
  startTime: number;
  duration: number; // 飞行时长 ms
  damage: number; 
}
// 子弹命中时的扩散特效
export interface HitEffect {
  id: string;
  position: Position;
  startTime: number;
  duration: number;
}

export type GameStatus = 'waiting' | 'playing' | 'won' | 'lost';
export interface GameState {
  player: Player;
  doors: Door[];
  beds: Bed[];
  ghost: Ghost;
  turrets: Turret[];
  projectiles: Projectile[];
  hitEffects: HitEffect[];
  gameStatus: GameStatus;
  gameTime: number;
}

//1~5 级数值表
export const BED_LEVELS: Array<{ income: number; upgradeCost: number | null }> = [
  { income: 2, upgradeCost: 30 },
  { income: 3, upgradeCost: 70 },
  { income: 5, upgradeCost: 140 },
  { income: 7, upgradeCost: 240 },
  { income: 10, upgradeCost: null },
];
export const DOOR_LEVELS: Array<{ maxHealth: number; upgradeCost: number | null }> = [
  { maxHealth: 350, upgradeCost: 50 },
  { maxHealth: 800, upgradeCost: 120 },
  { maxHealth: 1500, upgradeCost: 220 },
  { maxHealth: 2500, upgradeCost: 360 },
  { maxHealth: 4000, upgradeCost: null },
];
// 门的自我修复速度（每秒回复最大血量的比例）：只在鬼没在啃这扇门时生效
export const DOOR_REGEN_RATIO_PER_SEC = 0.005;
export const TURRET_LEVELS: Array<{ damage: number; fireInterval: number; range: number; buildCost: number; upgradeCost: number | null }> = [
  { damage: 8, fireInterval: 1000, range: 3.0, buildCost: 25, upgradeCost: 35 },
  { damage: 14, fireInterval: 900, range: 3.6, buildCost: 25, upgradeCost: 70 },
  { damage: 24, fireInterval: 800, range: 4.4, buildCost: 25, upgradeCost: 130 },
  { damage: 40, fireInterval: 700, range: 5.2, buildCost: 25, upgradeCost: 220 },
  { damage: 64, fireInterval: 600, range: 6.0, buildCost: 25, upgradeCost: null },
];

// 建造价只有 1 级用得上
export const TURRET_BUILD_COST = TURRET_LEVELS[0].buildCost;
// 最高等级
export const BED_MAX_LEVEL = BED_LEVELS.length;
export const DOOR_MAX_LEVEL = DOOR_LEVELS.length;
export const TURRET_MAX_LEVEL = TURRET_LEVELS.length;
// 升级价格查询（level 级 → level+1 级）：满级返回 null，UI 显示与 reducer 校验共用
export const bedUpgradeCost = (level: number): number | null => BED_LEVELS[level - 1]?.upgradeCost ?? null;
export const doorUpgradeCost = (level: number): number | null => DOOR_LEVELS[level - 1]?.upgradeCost ?? null;
export const turretUpgradeCost = (level: number): number | null => TURRET_LEVELS[level - 1]?.upgradeCost ?? null;


export const GHOST_BASE = { health: 240, attackPower: 1, speed: 1 };
// 成长：每秒活动时间增加的量
export const GHOST_GROWTH = { health: 20, attackPower: 0.4, speed: 0.0001 };
export const GHOST_GROWTH_CAP_SECONDS = 480;
// 逃跑阈值：血量掉到最大血量的一半以下就掉头跑路（玩家打掉的血量按「半条命」结算）
export const GHOST_FLEE_HEALTH_RATIO = 0.5;
// 回血速度：每秒回复最大血量的比例（回满半条命约 8.3 秒），期间免伤、炮塔也不索敌
export const GHOST_HEAL_RATE_PER_SEC = 0.06;
// 幽灵破门出场动画时长
export const GHOST_SPAWN_DURATION = 900;
// 入场门被撞开的时长：门板自关闭甩到全开的过程，短于出场动画 —— 先破门，再钻出来
export const GHOST_DOOR_BURST_DURATION = 420;

export type GameAction =
  | { type: 'START_GAME' }
  | { type: 'UPGRADE_DOOR'; payload: string } // 目标房门 id
  | { type: 'UPGRADE_BED'; payload: string } // 目标床铺 id
  | { type: 'BUILD_TURRET'; payload: Position }
  | { type: 'UPGRADE_TURRET'; payload: string }
  | { type: 'TICK'; payload: number } // 经过的整秒数
  | {
        type: 'SYNC_STATE';
        payload: Partial<Omit<GameState, 'player' | 'doors' | 'beds'>> & {
          player?: Partial<Player>;
          doors?: Array<Partial<Door> & { id: string }>;
          beds?: Array<Partial<Bed> & { id: string }>;
        };
      };
