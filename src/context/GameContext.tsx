import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { GameState, GameAction, Position, BED_LEVELS, DOOR_LEVELS, TURRET_LEVELS, TURRET_BUILD_COST, bedUpgradeCost, doorUpgradeCost, turretUpgradeCost, GHOST_BASE } from '../types';
import { GHOST_SPAWN_POSITION, roomIndexOf } from '../engine/Collision';

const getInitialState = (): GameState => ({
  player: {
    id: 'player-1',
    position: { x: 7.5, y: 3 }, // 出生在两房间之间的走廊正中
    gold: 100, 
    speed: 3, 
  },
  // 两个独立房间：左房间（宽 7x6）门 (3,5) / 床 (1,0)；右房间（长 6x7）门 (12,6) / 床 (12,3)。
  // 同房间的门与床互为对应关系：幽灵出场时按玩家所用的床锁定同房间的那扇门（见 GameLogic.trySpawnGhost）
  doors: [
    { id: 'door-1', position: { x: 3, y: 5 }, health: DOOR_LEVELS[0].maxHealth, maxHealth: DOOR_LEVELS[0].maxHealth, level: 1, isBroken: false },
    { id: 'door-2', position: { x: 12, y: 6 }, health: DOOR_LEVELS[0].maxHealth, maxHealth: DOOR_LEVELS[0].maxHealth, level: 1, isBroken: false },
  ],
  beds: [
    // 左房床铺靠房间左上角（床头贴北墙）：门口到房内深处的动线整条让开，进门一带留作建造空地
    { id: 'bed-1', position: { x: 1, y: 0 }, level: 1, isSleeping: false },
    { id: 'bed-2', position: { x: 12, y: 3 }, level: 1, isSleeping: false },
  ],
  // 幽灵：基础数值取自 GHOST_BASE（血量/啃门伤害/速度），此后随「活动时间」缓慢成长（见 GameLogic.updateGhostStats）
  ghost: {
    health: GHOST_BASE.health,
    maxHealth: GHOST_BASE.health,
    // 潜伏在左下角入场门后（GHOST_SPAWN_POSITION）：玩家第一次上床睡觉时才破门而出
    position: { ...GHOST_SPAWN_POSITION },
    attackPower: GHOST_BASE.attackPower, 
    speed: GHOST_BASE.speed, 
    targetDoor: null,
    state: 'DORMANT',
    spawnTime: -1,
    emergeTime: -1,
    growthMs: 0,
  },
  turrets: [],
  projectiles: [],
  hitEffects: [],
  gameStatus: 'waiting',
  gameTime: 0,
});

// 玩家的建造/升级权限：必须正躺在床上睡觉，且只能在自己睡的那张床所在的房间里动手 ——
// 位置按房间归属比较（world 格坐标落在哪个房间），因此本房间的门、床、炮塔与空格都可操作，
// 另一个房间的一切都拦掉。UI 侧同样按这条规则收面板，这里再兜一层防止绕过界面派发
const canOperateAt = (state: GameState, pos: Position): boolean => {
  const sleepingBed = state.beds.find((b) => b.isSleeping);
  return !!sleepingBed && roomIndexOf(sleepingBed.position) === roomIndexOf(pos);
};

const gameReducer = (state: GameState, action: GameAction): GameState => {
  switch (action.type) {
    case 'START_GAME':
      return {
        ...getInitialState(),
        gameStatus: 'playing',
      };
    case 'UPGRADE_DOOR': {
      // 校验：门存在、未满级（doorUpgradeCost 返回 null 即满级）、未破损、玩家正睡在该门所在房间里且金币足够时才升级；
      // 破门/满级升级都无意义（破门渲染只认 isBroken、满级已无更高一档外观），直接拦截避免金币白花
      const targetDoor = state.doors.find((d) => d.id === action.payload);
      const doorCost = targetDoor ? doorUpgradeCost(targetDoor.level) : null;
      if (!targetDoor || doorCost === null || !canOperateAt(state, targetDoor.position) || targetDoor.isBroken || state.player.gold < doorCost) return state;
      // 升级即修门：血量直接回满（升级既是加耐久也是修门，破门前的最后一笔钱能救命）
      const nextDoor = DOOR_LEVELS[targetDoor.level];
      return {
        ...state,
        player: {
          ...state.player,
          gold: state.player.gold - doorCost,
        },
        doors: state.doors.map((d) =>
          d.id === action.payload
            ? { ...d, level: d.level + 1, maxHealth: nextDoor.maxHealth, health: nextDoor.maxHealth }
            : d
        ),
      };
    }
    case 'UPGRADE_BED': {
      // 校验：床铺存在、未满级、玩家正睡在该床所在房间里且金币足够时才升级
      // （床只影响产出速度，数值全在 BED_LEVELS 的 income 上）
      const targetBed = state.beds.find((b) => b.id === action.payload);
      const bedCost = targetBed ? bedUpgradeCost(targetBed.level) : null;
      if (!targetBed || bedCost === null || !canOperateAt(state, targetBed.position) || state.player.gold < bedCost) return state;
      return {
        ...state,
        player: {
          ...state.player,
          gold: state.player.gold - bedCost,
        },
        beds: state.beds.map((b) =>
          b.id === action.payload ? { ...b, level: b.level + 1 } : b
        ),
      };
    }
    case 'BUILD_TURRET': {
      // 校验：金币不足 / 目标格不在玩家睡觉的房间里 / 目标位置被占（床、门、已有炮塔）时不建造
      const { x, y } = action.payload;
      if (state.player.gold < TURRET_BUILD_COST) return state;
      if (!canOperateAt(state, action.payload)) return state;
      if (state.beds.some((b) => b.position.x === x && b.position.y === y)) return state;
      if (state.doors.some((d) => d.position.x === x && d.position.y === y)) return state;
      if (state.turrets.some((t) => t.position.x === x && t.position.y === y)) return state;
      // 新塔一律 1 级：伤害/射程/射速全部取自 TURRET_LEVELS 的第一档
      const lv1 = TURRET_LEVELS[0];
      return {
        ...state,
        player: {
          ...state.player,
          gold: state.player.gold - TURRET_BUILD_COST,
        },
        turrets: [
          ...state.turrets,
          {
            id: `turret-${Date.now()}`,
            position: action.payload,
            level: 1,
            damage: lv1.damage,
            range: lv1.range,
            fireInterval: lv1.fireInterval,
            lastShot: 0,
          },
        ],
      };
    }
    case 'UPGRADE_TURRET': {
      // 校验：炮塔存在、未满级、在玩家睡觉的房间里且金币足够时才升级
      const target = state.turrets.find((t) => t.id === action.payload);
      const turretCost = target ? turretUpgradeCost(target.level) : null;
      if (!target || turretCost === null || !canOperateAt(state, target.position) || state.player.gold < turretCost) return state;
      // 升一级整档替换数值（伤害/射程/射速三者一起涨，DPS 才会拉开档差）
      const nextTurret = TURRET_LEVELS[target.level];
      return {
        ...state,
        player: {
          ...state.player,
          gold: state.player.gold - turretCost,
        },
        turrets: state.turrets.map((t) =>
          t.id === action.payload
            ? { ...t, level: t.level + 1, damage: nextTurret.damage, range: nextTurret.range, fireInterval: nextTurret.fireInterval }
            : t
        ),
      };
    }
    case 'TICK': {
        // 只有躺床睡觉时才产出金币，产出速度由床铺等级决定（见 BED_LEVELS.income）；
        // payload 为本次经过的整秒数（由帧循环累加器满 1000ms 派发）
        const sleepingBed = state.beds.find((b) => b.isSleeping);
        const income = sleepingBed ? BED_LEVELS[sleepingBed.level - 1].income : 0;
        const seconds = action.payload;
        return {
            ...state,
            gameTime: state.gameTime + seconds,
            player: {
                ...state.player,
                gold: state.player.gold + income * seconds,
            },
        };
    }
    case 'SYNC_STATE': {
        // 引擎侧状态回传：doors / beds 按 id 逐项浅合并，
        // 等级、最大血量等 Context 权威字段不会被引擎旧值覆盖
        const { player, doors, beds, ...rest } = action.payload;
        return {
            ...state,
            ...rest,
            player: player ? { ...state.player, ...player } : state.player,
            doors: doors
                ? state.doors.map((d) => {
                      const update = doors.find((u) => u.id === d.id);
                      return update ? { ...d, ...update } : d;
                  })
                : state.doors,
            beds: beds
                ? state.beds.map((b) => {
                      const update = beds.find((u) => u.id === b.id);
                      return update ? { ...b, ...update } : b;
                  })
                : state.beds,
        };
    }
    default:
      return state;
  }
};

const GameContext = createContext<{
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
} | undefined>(undefined);

export const GameProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(gameReducer, undefined, getInitialState);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};
