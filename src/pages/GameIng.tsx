import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import { CircleArrowUp, Coins, FastForward, Hammer, LogOut, Pause, Play } from 'lucide-react';
import classNames from 'classnames';
import { Renderer } from '../engine/Renderer';
import { GameLogic } from '../engine/GameLogic';
import { BED_MAX_LEVEL, bedUpgradeCost, DOOR_MAX_LEVEL, doorUpgradeCost, GameState, TURRET_BUILD_COST, TURRET_MAX_LEVEL, turretUpgradeCost } from '../types';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GRID_CELL_SIZE, ROOM_ORIGINS, ROOM_ROWS, roomIndexOf } from '../utils/Coordinate';


const GameIng: React.FC = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const logicRef = useRef<GameLogic | null>(null);
  if (logicRef.current === null) {
    logicRef.current = new GameLogic(); // 只在首次执行
  }
  const gameStateRef = useRef<GameState>(state);
  const requestRef = useRef<number>();   //requestAnimationFrame的id

  // 点击画布弹出的面板：画布坐标决定按钮悬浮位置，建造炮塔附带房间格坐标
  const [upgradePanel, setUpgradePanel] = useState<
    | { type: 'door' | 'bed'; id: string; x: number; y: number }
    | { type: 'turret'; x: number; y: number; turretId: string }
    | { type: 'build'; x: number; y: number; gx: number; gy: number }
    | { type: 'locked'; x: number; y: number }   // locked 面板只在"点了自己睡觉的房间之外"时出现，是一句禁用提示
    | null
  >(null);
  // 暂停：暂停期间冻结帧循环（逻辑更新、渲染、金币 tick 一起停摆）
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  // 2 倍速
  const [isFast, setIsFast] = useState(false);
  const isFastRef = useRef(false);

  const lastTimeRef = useRef<number>(0);
  const tickAccumRef = useRef<number>(0);
  // 把引擎侧状态同步到 Context （房门破损、睡眠、胜负）
  const lastSyncedRef = useRef({
    doorStates: state.doors.map(d => `${d.id}:${d.isBroken}`).join('|'),
    bedStates: state.beds.map(b => `${b.id}:${b.isSleeping}`).join('|'),
    gameStatus: state.gameStatus,
  });

  useEffect(() => {
    const keys = new Set<string>();
    const handleKeyDown = (e: KeyboardEvent) => {
      keys.add(e.key);
      logicRef.current.setInput(keys);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.key);
      logicRef.current.setInput(keys);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  //启动时执行一次
  useEffect(() => {
    if (canvasRef.current && !rendererRef.current) {
      rendererRef.current = new Renderer(canvasRef.current);
    }    //<StrictMode>会把 effect 执行两遍 

    // Frame Loop
    const animate = (time: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = time;
      // 2 倍速：把整段帧间隔乘 2 再交给引擎 
      // 单帧上限 50ms 
      const deltaTime = Math.min(time - lastTimeRef.current, 50) * (isFastRef.current ? 2 : 1);
      lastTimeRef.current = time;

      if (gameStateRef.current.gameStatus === 'playing' && !isPausedRef.current) {
        // Update Logic
        const newState = logicRef.current.update(gameStateRef.current, deltaTime);
        gameStateRef.current = { ...gameStateRef.current, ...newState };
        // 金币tick，累计满整秒才 dispatch
        tickAccumRef.current += deltaTime;
        const ticks = Math.floor(tickAccumRef.current / 1000);
        if (ticks > 0) {
          tickAccumRef.current -= ticks * 1000;
          dispatch({ type: 'TICK', payload: ticks });
        }
        // Render（传入引擎游戏时钟）
        if (rendererRef.current) {
          rendererRef.current.render(gameStateRef.current, logicRef.current.getClockMs());
        }

        // 引擎侧状态（房门破损、入床睡觉、胜负）变化时同步回 Context。
        const engineState = gameStateRef.current;
        const synced = lastSyncedRef.current;
        const doorStates = engineState.doors.map(d => `${d.id}:${d.isBroken}`).join('|');
        const bedStates = engineState.beds.map(b => `${b.id}:${b.isSleeping}`).join('|');
        if (
          doorStates !== synced.doorStates
          || bedStates !== synced.bedStates
          || engineState.gameStatus !== synced.gameStatus
        ) {
          lastSyncedRef.current = {
            doorStates,
            bedStates,
            gameStatus: engineState.gameStatus,
          };
          dispatch({
            type: 'SYNC_STATE',
            payload: {
              doors: engineState.doors.map(d => ({ id: d.id, isBroken: d.isBroken })),
              beds: engineState.beds.map(b => ({ id: b.id, isSleeping: b.isSleeping })),
              gameStatus: engineState.gameStatus,
            },
          });
        }
      }
      requestRef.current = requestAnimationFrame(animate);   //在下一帧绘制之前，请调用一下 animate 这个函数
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  //依赖context
  useEffect(() => {
    gameStateRef.current = {
      ...gameStateRef.current,
      player: {
        ...gameStateRef.current.player,
        gold: state.player.gold, // Sync gold
      },
      // 升级即修门：比较等级识别，直接把引擎侧血量回满，
      doors: state.doors.map(d => {
        const engineDoor = gameStateRef.current.doors.find(e => e.id === d.id);
        const upgraded = d.level > engineDoor.level;
        return {
          ...d,
          health: upgraded ? d.maxHealth : engineDoor.health, //不升级用引擎血
          isBroken: engineDoor.isBroken,
        };
      }),
      // 床以 Context 为权威整体覆盖回引擎
      beds: state.beds.map(b => ({ ...b })),
      // 炮塔合并：等级/伤害/射程以 Context 为权威（建造与升级），lastShot 保留引擎侧值避免冷却被重置
      turrets: state.turrets.map(t => {
        const engineTurret = gameStateRef.current.turrets.find(e => e.id === t.id);
        return engineTurret ? { ...t, lastShot: engineTurret.lastShot } : t;  //新建时
      }),
      gameStatus: state.gameStatus
    };
  }, [state]);

  useEffect(() => {
    if (state.gameStatus === 'won' || state.gameStatus === 'lost') {
      navigate('/game-over');
    }
  }, [state.gameStatus, navigate]);

  // 可建造判定：格子位于房间内、不在房间靠下第一行，且未被床/门/炮塔占用。
  const isBuildableCell = (gx: number, gy: number): boolean => {
    const roomIndex = roomIndexOf({ x: gx, y: gy });
    if (roomIndex < 0) return false;
    if (gy === ROOM_ORIGINS[roomIndex].y + ROOM_ROWS[roomIndex] - 1) return false;
    if (state.beds.some(b => b.position.x === gx && b.position.y === gy)) return false;
    if (state.doors.some(d => d.position.x === gx && d.position.y === gy)) return false;
    if (state.turrets.some(t => t.position.x === gx && t.position.y === gy)) return false;
    return true;
  };

  // 点击了的的炮塔/门/床
  const selectedTurret = upgradePanel?.type === 'turret'
    ? state.turrets.find(t => t.id === upgradePanel.turretId) ?? null
    : null;
  const selectedDoor = upgradePanel?.type === 'door'
    ? state.doors.find(d => d.id === upgradePanel.id) ?? null
    : null;
  const selectedBed = upgradePanel?.type === 'bed'
    ? state.beds.find(b => b.id === upgradePanel.id) ?? null
    : null;
  // 用于升级图标着色判断
  const doorCost = selectedDoor ? doorUpgradeCost(selectedDoor.level) : null;
  const bedCost = selectedBed ? bedUpgradeCost(selectedBed.level) : null;
  const turretCost = selectedTurret ? turretUpgradeCost(selectedTurret.level) : null;

  // 睡眠状态：在睡觉，哪间房）
  const sleepingBed = state.beds.find((b) => b.isSleeping) ?? null;
  const sleepingRoom = sleepingBed ? roomIndexOf(sleepingBed.position) : -1;
  // 起床后立刻收起升级图标
  const sleeping = sleepingBed !== null;
  useEffect(() => {
    if (!sleeping) setUpgradePanel(null);
  }, [sleeping]);

  // 点击画布：命中门/床/炮塔弹出对应升级面板；点击房间内空地弹出建造炮塔面板。
  // 权限：只有躺床睡觉时才允许建造 / 升级，且只能在自己睡的那张床所在房间里操作
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;    //父容器
    if (!canvas || !container) return;

    // 不在睡觉状态：不给面板
    if (!sleepingBed) {
      setUpgradePanel(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    // 视口点击坐标 - canvas坐标 -> 画布逻辑坐标 -> 格子坐标
    const logicalX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const logicalY = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const gridX = logicalX / GRID_CELL_SIZE;
    const gridY = logicalY / GRID_CELL_SIZE;

    // 格子坐标 -> 在canvas的父 div里的坐标，用于绘制定位
    const toPanelPos = (ax: number, ay: number) => ({
      x: rect.left - containerRect.left
        + ((ax * GRID_CELL_SIZE) / canvas.width) * rect.width,
      y: rect.top - containerRect.top
        + ((ay * GRID_CELL_SIZE) / canvas.height) * rect.height,
    });

    // 命中检测
    const hitBed = state.beds.find(b => gridX >= b.position.x - 0.15 && gridX < b.position.x + 1.15
      && gridY >= b.position.y - 0.15 && gridY < b.position.y + 1.15);
    const hitDoor = state.doors.find(d => gridX >= d.position.x && gridX < d.position.x + 1
      && gridY >= d.position.y && gridY < d.position.y + 1);
    // 炮塔命中：以格子中心为圆心，半径为 0.65 格
    const hitTurret = state.turrets.find(t => Math.hypot(gridX - (t.position.x + 0.5), gridY - (t.position.y + 0.5)) < 0.65);

    let target: 'door' | 'bed' | 'turret' | null = null;
    let targetId: string | undefined;
    let targetPos: { x: number; y: number } | null = null;   //用于判断是否落在自己睡觉的房间里
    let anchor = { x: 0, y: 0 };
    if (hitBed) {
      target = 'bed';
      targetId = hitBed.id;
      targetPos = hitBed.position;
      // 床格子上方坐标
      anchor = { x: hitBed.position.x + 0.4, y: hitBed.position.y - 0.15 };
    } else if (hitDoor) {
      target = 'door';
      targetId = hitDoor.id;
      targetPos = hitDoor.position;
      // 门格子上方坐标
      anchor = { x: hitDoor.position.x + 0.4, y: hitDoor.position.y - 0.15 };
    } else if (hitTurret) {
      target = 'turret';
      targetPos = hitTurret.position;
      //炮塔格子上方坐标
      anchor = { x: hitTurret.position.x + 0.4, y: hitTurret.position.y + 0.1};
    }

    // 未命中门/床/炮塔：点击房间内空地格弹出建造炮塔面板，其余位置关闭面板
    if (!target) {
      const gx = Math.floor(gridX);
      const gy = Math.floor(gridY);     //向下取整
      if (!isBuildableCell(gx, gy)) {
        setUpgradePanel(null);
        return;
      }
      const buildPos = toPanelPos(gx + 0.5, gy + 0.5);
      // 不在自己睡觉的房间里：给出禁用提示
      if (roomIndexOf({ x: gx, y: gy }) !== sleepingRoom) {
        setUpgradePanel({ type: 'locked', x: buildPos.x, y: buildPos.y - 10 });
        return;
      }
      setUpgradePanel({ type: 'build', x: buildPos.x, y: buildPos.y - 10, gx, gy });
      return;
    }

    const panelPos = toPanelPos(anchor.x, anchor.y);
    // 目标在另一个房间：同样给禁用提示
    if (targetPos && roomIndexOf(targetPos) !== sleepingRoom) {
      setUpgradePanel({ type: 'locked', x: panelPos.x, y: panelPos.y - 10 });
      return;
    }
    if (target === 'turret') {
      setUpgradePanel({ type: 'turret', x: panelPos.x, y: panelPos.y - 10, turretId: hitTurret.id });
    } else if (target === 'door' || target === 'bed') {
      setUpgradePanel({ type: target, id: targetId, x: panelPos.x, y: panelPos.y - 10 });
    }
  };

  const togglePause = () => {
    isPausedRef.current = !isPausedRef.current;
    setIsPaused(isPausedRef.current);
    if (isPausedRef.current) setUpgradePanel(null);
  };
  const toggleFast = () => {
    isFastRef.current = !isFastRef.current;
    setIsFast(isFastRef.current);
  };
  const handleBackToLobby = () => {
    navigate('/');
  };



  return (
    <div className="flex flex-col h-screen w-full overflow-hidden relative bg-black">

      {/* 血雾漂移：沿用大厅的血色主题，左上、右下各一团超大模糊深血红圆 */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-[30rem] w-[30rem] rounded-full bg-red-800/55 blur-3xl animate-fog-a" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[34rem] w-[34rem] rounded-full bg-red-700/40 blur-3xl animate-fog-b" />

      {/* 左上角金币小框 */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-3 bg-[#161625]/60 backdrop-blur-xl border border-white/5 rounded-2xl px-4 py-3 shadow-lg">
        <Coins className="w-8 h-8 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]" />
        <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 to-yellow-500">{state.player.gold}</span>
      </div>

      {/* 右上角：HUD 控制按钮——返回大厅在上、暂停/继续在下垂直堆叠并右对齐，沿用左上金币框的毛玻璃圆角卡片风格；
          z-30 高于暂停遮罩（z-20），暂停期间仍可点击 */}
      <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-3">
        <button
          onClick={handleBackToLobby}
          className="flex items-center gap-2 bg-[#161625]/60 backdrop-blur-xl border border-white/5 rounded-2xl px-5 py-3 shadow-lg text-base font-bold text-white transition-all hover:bg-[#161625]/80 active:scale-95"
        >
          <LogOut className="w-5 h-5 text-red-400" />
          返回大厅
        </button>
        <button
          onClick={togglePause}
          className="flex items-center gap-2 bg-[#161625]/60 backdrop-blur-xl border border-white/5 rounded-2xl px-5 py-3 shadow-lg text-base font-bold text-white transition-all hover:bg-[#161625]/80 active:scale-95"
        >
          {isPaused ? (
            <Play className="w-5 h-5 text-emerald-400" />
          ) : (
            <Pause className="w-5 h-5 text-yellow-400" />
          )}
          {isPaused ? '继续' : '暂停'}
        </button>
        {/* 2 倍速：排在暂停下方；开启后按钮常亮，一眼能看出当前是两倍速 */}
        <button
          onClick={toggleFast}
          className={classNames(
            'flex items-center gap-2 backdrop-blur-xl border rounded-2xl px-5 py-3 shadow-lg text-base font-bold transition-all active:scale-95',
            {
              'bg-[#161625]/60 border-white/5 text-white hover:bg-[#161625]/80': !isFast,
              'bg-amber-500/25 border-amber-300/40 text-amber-100 hover:bg-amber-500/35 shadow-amber-900/30': isFast,
            }
          )}
        >
          <FastForward className={classNames('w-5 h-5', isFast ? 'text-amber-300' : 'text-sky-400')} />
          {isFast ? '2 倍速中' : '2 倍速'}
        </button>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 relative flex items-center justify-center p-3">
        {/* Game Canvas */}
        <div className="relative p-2 bg-black rounded-3xl shadow-[0_0_80px_rgba(0,0,0,0.6)] border-4 border-[#3d3d5c] outline outline-4 outline-black/20">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-500/5 to-purple-500/5 pointer-events-none z-10"></div>
          {/* 画布外框高度三选一：94vh / 视口高-48px / 宽度上限 97vw 折成的高度（58.2vw = 97vw × 600/1000，
              与位图的 5:3 对应）。外框比例恒等于位图比例 —— 不再需要 object-contain，
              点击坐标可直接按 rect 等比换算 */}
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onClick={handleCanvasClick}
            className="bg-[#252535] rounded-xl h-[min(94vh,calc(100vh_-_48px),58.2vw)] max-w-[97vw] block relative z-0 cursor-crosshair"
          />
          {/* 点击门/床/炮塔/空地弹出的操作面板；统一不设关闭按钮，点击画布其他位置或*/}
          {upgradePanel && (
            <div
              className="absolute z-30 transform -translate-x-1/2 -translate-y-full"
              style={{ left: upgradePanel.x, top: upgradePanel.y }}
            >
              {/* 各面板收缩为单个图标按钮；不设深色外框，仅保留彩色毛玻璃图标按钮 */}
              <div className="relative w-max animate-in fade-in zoom-in-95 duration-150">
                {upgradePanel.type === 'door' && selectedDoor ? (
                  selectedDoor.isBroken ? (
                    /* 门已破损：升级无意义（幽灵不再管它、渲染只认 isBroken），以禁用态提示；reducer 亦有同样校验兜底 */
                    <button
                      disabled
                      className="flex items-center justify-center w-12 h-12 rounded-2xl border bg-white/5 backdrop-blur-md border-white/10 text-gray-500 cursor-not-allowed"
                    >
                      <CircleArrowUp className="w-6 h-6" />
                    </button>
                  ) : selectedDoor.level >= DOOR_MAX_LEVEL ? (
                    /* 门已满级：5 档门面外观（木 → 加固木 → 铁 → 重铁 → 金）已到顶，数值同样封顶；reducer 亦有同样校验兜底 */
                    <button
                      disabled
                      className="flex items-center justify-center w-12 h-12 rounded-2xl border bg-white/5 backdrop-blur-md border-white/10 text-amber-200/70 cursor-not-allowed"
                    >
                      <CircleArrowUp className="w-6 h-6" />
                    </button>
                  ) : (
                    <button
                      onClick={() => dispatch({ type: 'UPGRADE_DOOR', payload: selectedDoor.id })}
                      className={classNames(
                        'flex items-center justify-center w-12 h-12 rounded-2xl border backdrop-blur-md transition-all active:scale-95',
                        {
                          'bg-gradient-to-r from-blue-600/60 to-blue-500/50 border-blue-400/30 text-white hover:from-blue-500/70 hover:to-blue-400/60 shadow-lg shadow-blue-900/30': state.player.gold >= doorCost,
                          'bg-white/5 border-white/10 text-gray-500': state.player.gold < doorCost,
                        }
                      )}
                    >
                      <CircleArrowUp className="w-6 h-6" />
                    </button>
                  )
                ) : upgradePanel.type === 'bed' && selectedBed ? (
                  selectedBed.level >= BED_MAX_LEVEL ? (
                    /* 床已满级：5 档外观（木板床 → 单人床 → 舒适床 → 软床 → 豪华床）已到顶；reducer 亦有同样校验兜底 */
                    <button
                      disabled
                      className="flex items-center justify-center w-12 h-12 rounded-2xl border bg-white/5 backdrop-blur-md border-white/10 text-amber-200/70 cursor-not-allowed"
                    >
                      <CircleArrowUp className="w-6 h-6" />
                    </button>
                  ) : (
                    <button
                      onClick={() => dispatch({ type: 'UPGRADE_BED', payload: selectedBed.id })}
                      className={classNames(
                        'flex items-center justify-center w-12 h-12 rounded-2xl border backdrop-blur-md transition-all active:scale-95',
                        {
                          'bg-gradient-to-r from-yellow-600/60 to-yellow-500/50 border-yellow-400/30 text-white hover:from-yellow-500/70 hover:to-yellow-400/60 shadow-lg shadow-yellow-900/30': state.player.gold >= bedCost,
                          'bg-white/5 border-white/10 text-gray-500': state.player.gold < bedCost,
                        }
                      )}
                    >
                      <CircleArrowUp className="w-6 h-6" />
                    </button>
                  )
                ) : upgradePanel.type === 'build' ? (
                  <button
                    disabled={state.player.gold < TURRET_BUILD_COST}
                    onClick={() => {
                      dispatch({ type: 'BUILD_TURRET', payload: { x: upgradePanel.gx, y: upgradePanel.gy } });
                      setUpgradePanel(null);
                    }}
                    className={classNames(
                      'flex items-center justify-center w-12 h-12 rounded-2xl border backdrop-blur-md transition-all active:scale-95',
                      {
                        'bg-gradient-to-r from-emerald-600/60 to-emerald-500/50 border-emerald-400/30 text-white hover:from-emerald-500/70 hover:to-emerald-400/60 shadow-lg shadow-emerald-900/30': state.player.gold >= TURRET_BUILD_COST,
                        'bg-white/5 border-white/10 text-gray-500 cursor-not-allowed': state.player.gold < TURRET_BUILD_COST,
                      }
                    )}
                  >
                    <Hammer className="w-6 h-6" />
                  </button>
                ) : selectedTurret ? (
                  selectedTurret.level >= TURRET_MAX_LEVEL ? (
                    /* 炮塔已满级：5 档外观（机枪塔 → 双管塔 → 加农炮 → 重炮 → 等离子炮）已到顶；reducer 亦有同样校验兜底 */
                    <button
                      disabled
                      className="flex items-center justify-center w-12 h-12 rounded-2xl border bg-white/5 backdrop-blur-md border-white/10 text-emerald-200/70 cursor-not-allowed"
                    >
                      <CircleArrowUp className="w-6 h-6" />
                    </button>
                  ) : (
                    <button
                      disabled={state.player.gold < turretCost}
                      onClick={() => dispatch({ type: 'UPGRADE_TURRET', payload: selectedTurret.id })}
                      className={classNames(
                        'flex items-center justify-center w-12 h-12 rounded-2xl border backdrop-blur-md transition-all active:scale-95',
                        {
                          'bg-gradient-to-r from-emerald-600/60 to-emerald-500/50 border-emerald-400/30 text-white hover:from-emerald-500/70 hover:to-emerald-400/60 shadow-lg shadow-emerald-900/30': state.player.gold >= turretCost,
                          'bg-white/5 border-white/10 text-gray-500 cursor-not-allowed': state.player.gold < turretCost,
                        }
                      )}
                    >
                      <CircleArrowUp className="w-6 h-6" />
                    </button>
                  )
                ) : upgradePanel.type === 'locked' ? (
                  /* 点到自己睡觉的房间之外：只提示权限，不给任何可点操作（reducer 亦有同样校验兜底） */
                  <button
                    disabled
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold bg-white/5 border-white/10 text-gray-400 cursor-not-allowed whitespace-nowrap"
                  >
                    只能在自己睡觉的房间里建造 / 升级
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {/* 暂停遮罩：暂停期间画面定格最后一帧，遮罩拦截画布交互；
                继续按钮与右上角暂停按钮共用 togglePause */}
          {isPaused && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-10 rounded-3xl bg-black/60 backdrop-blur-sm">
              <span className="text-5xl font-black tracking-[0.4em] text-white/90 drop-shadow-[0_0_25px_rgba(220,38,38,0.4)]">已暂停</span>
              <button
                onClick={togglePause}
                className="rounded-2xl bg-gradient-to-b from-red-500 to-red-800 px-12 py-4 ring-1 ring-red-400/40
                                   shadow-[0_0_40px_rgba(239,68,68,0.35),0_10px_30px_rgba(0,0,0,0.5)]
                                   transition-all duration-300
                                   hover:scale-[1.04] hover:shadow-[0_0_70px_rgba(239,68,68,0.55),0_10px_30px_rgba(0,0,0,0.5)]
                                   active:scale-95"
              >
                <span className="text-xl font-black tracking-[0.3em] text-white">继续游戏</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameIng;
