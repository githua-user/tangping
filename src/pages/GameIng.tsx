import React, { useEffect, useRef, useState } from 'react';
import {useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import { Coins, FastForward, LogOut, Pause, Play } from 'lucide-react';
import classNames from 'classnames';
import { Renderer } from '../engine/Renderer';
import { GameLogic } from '../engine/GameLogic';
import { BED_LEVELS, BED_MAX_LEVEL, bedUpgradeCost, DOOR_LEVELS, DOOR_MAX_LEVEL, doorUpgradeCost, GameState, TURRET_BUILD_COST, TURRET_LEVELS, TURRET_MAX_LEVEL, turretUpgradeCost } from '../types';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GRID_CELL_SIZE, GRID_OFFSET, ROOM_ORIGINS, ROOM_ROWS, roomIndexOf } from '../engine/Collision';

const GameIng: React.FC = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 点击画布弹出的面板：类型 + 相对画布外框容器的锚点坐标
  // 门/床/炮塔面板附带目标实例 id；建造炮塔面板附带目标格坐标；
  // locked 面板只在"点了自己睡觉的房间之外"时出现，是一句禁用提示
  const [upgradePanel, setUpgradePanel] = useState<
    | { type: 'door' | 'bed'; id: string; x: number; y: number }
    | { type: 'turret'; x: number; y: number; turretId: string }
    | { type: 'build'; x: number; y: number; gx: number; gy: number }
    | { type: 'locked'; x: number; y: number }
    | null
  >(null);
  // 暂停：暂停期间冻结帧循环（逻辑更新、渲染、金币 tick 一起停摆），仅 UI 层状态，不改变 gameStatus；
  // isPausedRef 供 animate 闭包读取（RAF 回调只持有首次渲染的闭包，state 值不会刷新）
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  // 2 倍速：同暂停一样只是 UI 层开关（不写进 gameStatus），isFastRef 同样供 animate 闭包读取
  const [isFast, setIsFast] = useState(false);
  const isFastRef = useRef(false);

  const rendererRef = useRef<Renderer | null>(null);
  const logicRef = useRef<GameLogic | null>(null);
  if (logicRef.current === null) 
     {
   logicRef.current = new GameLogic(); // 只在首次执行
    }
  const gameStateRef = useRef<GameState>(state);
  const requestRef = useRef<number>();

  const lastTimeRef = useRef<number>(0);
  // 金币/计时 tick 累加器（ms）：帧循环中累计 deltaTime，满 1000ms 派发一次 TICK
  const tickAccumRef = useRef<number>(0);
  // 记录已同步到 Context 的引擎侧状态（房门破损、睡眠、胜负），避免重复回写；
  // 门血量逐帧变化且只有 canvas 血条（Renderer 直读引擎状态）消费，不参与比较
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

          if (e.key === 'Escape') {
              setUpgradePanel(null);
          }
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

  useEffect(() => {
    gameStateRef.current = {
        ...gameStateRef.current,
        player: {
            ...gameStateRef.current.player,
            gold: state.player.gold, // Sync gold
        },
        // 门：等级/最大血量以 Context 为权威（升级经由 reducer）；当前血量与破损以引擎为权威
        // （啃门伤害与「鬼不啃门时的自动回血」都逐帧结算、不回传 Context）。
        // 升级即修门：比较等级即可识别出刚升级的那一帧 —— 直接把引擎侧血量回满，
        // 与 reducer 的「升级回满血」保持同一条规则（不能再按最大血量增量补，那样只会补出一截新血）
        doors: state.doors.map(d => {
            const engineDoor = gameStateRef.current.doors.find(e => e.id === d.id);
            if (!engineDoor) return { ...d };
            const upgraded = d.level > engineDoor.level;
            return {
                ...d,
                health: upgraded ? d.maxHealth : engineDoor.health,
                isBroken: engineDoor.isBroken,
            };
        }),
        // 床以 Context 为权威（睡觉操作经由 reducer），复制后整体覆盖回引擎
        beds: state.beds.map(b => ({ ...b })),
        // 炮塔合并：等级/伤害/射程以 Context 为权威（建造与升级），lastShot 保留引擎侧值避免冷却被重置
        turrets: state.turrets.map(t => {
            const engineTurret = gameStateRef.current.turrets.find(e => e.id === t.id);
            return engineTurret ? { ...t, lastShot: engineTurret.lastShot } : t;
        }),
        gameStatus: state.gameStatus
    };
  }, [state]);

  // Game Loop
  const animate = (time: number) => {
    if (lastTimeRef.current === 0) lastTimeRef.current = time;
    // 2 倍速：把整段帧间隔乘 2 再交给引擎 —— 引擎时钟、移动、啃门、炮塔冷却、子弹飞行、金币 tick
    // 全部共用这一个 deltaTime，所以加速是「整局跑两倍速」，不会有哪一项掉队。
    // 单帧上限 50ms 放大到 100ms：最大单步位移（玩家 0.3 格）仍远小于墙体碰撞余量（约 0.79 格），不会穿墙
    const deltaTime = Math.min(time - lastTimeRef.current, 50) * (isFastRef.current ? 2 : 1);
    lastTimeRef.current = time;

    if (gameStateRef.current.gameStatus === 'playing' && !isPausedRef.current) {
        // Update Logic
        const newState = logicRef.current.update(gameStateRef.current, deltaTime);
        gameStateRef.current = { ...gameStateRef.current, ...newState };

        // 金币/计时 tick：与帧循环共用同一时钟，累计满整秒才 dispatch（替代原 setInterval，
        // 消除其计时漂移与后台节流）；deltaTime 有 50ms 上限，离屏时金币与冷却一起暂停
        tickAccumRef.current += deltaTime;
        const ticks = Math.floor(tickAccumRef.current / 1000);
        if (ticks > 0) {
            tickAccumRef.current -= ticks * 1000;
            dispatch({ type: 'TICK', payload: ticks });
        }

        // Render（传入引擎游戏时钟，子弹/特效插值与引擎写入的 startTime 同源）
        if (rendererRef.current) {
            rendererRef.current.render(gameStateRef.current, logicRef.current.getClockMs());
        }

        // 引擎侧状态（房门破损、入床睡觉、胜负）变化时同步回 Context。
        // 注意：门血量逐帧变化但 UI 不消费（血条由 Renderer 从引擎状态直绘），
        // 因此比较与回传均不含 health，避免幽灵啃门期间每帧 dispatch 触发 React 重渲染；
        // 等级、最大血量等以 Context 为权威，不回传避免旧值覆盖
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

    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    if (canvasRef.current && !rendererRef.current) {
        rendererRef.current = new Renderer(canvasRef.current);
    }
    requestRef.current = requestAnimationFrame(animate);
    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // 可建造判定：格子位于房间内、不在被南墙立面盖住的最后一行，且未被床/门/炮塔占用。
  // 墙体立面向室内扫出后，最后一行按可见进深内缩已放不下炮塔（贴画会被墙面压住），整行因此不可建造
  const isBuildableCell = (gx: number, gy: number): boolean => {
    const roomIndex = roomIndexOf({ x: gx, y: gy });
    if (roomIndex < 0) return false;
    if (gy === ROOM_ORIGINS[roomIndex].y + ROOM_ROWS[roomIndex] - 1) return false; // 最后一行 = 南墙立面覆盖区
    if (state.beds.some(b => b.position.x === gx && b.position.y === gy)) return false;
    if (state.doors.some(d => d.position.x === gx && d.position.y === gy)) return false;
    if (state.turrets.some(t => t.position.x === gx && t.position.y === gy)) return false;
    return true;
  };

  // 点击画布：命中门/床/炮塔弹出对应升级面板；点击房间内空地弹出建造炮塔面板。
  // 权限：只有躺床睡觉时才允许建造 / 升级，且只能在自己睡的那张床所在房间里操作
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    // 不在睡觉状态：任何位置都不给面板（HUD 上另有提示文字说明原因）
    if (!sleepingBed) {
      setUpgradePanel(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // object-contain 下画布内容的实际显示区域（可能存在留白）
    const contentAspect = canvas.width / canvas.height;
    let renderW = rect.width;
    let renderH = rect.height;
    let contentLeft = rect.left;
    let contentTop = rect.top;
    if (rect.width / rect.height > contentAspect) {
      renderW = rect.height * contentAspect;
      contentLeft += (rect.width - renderW) / 2;
    } else {
      renderH = rect.width / contentAspect;
      contentTop += (rect.height - renderH) / 2;
    }

    // 屏幕坐标 -> 画布逻辑坐标 -> 网格坐标
    const logicalX = ((e.clientX - contentLeft) / renderW) * canvas.width;
    const logicalY = ((e.clientY - contentTop) / renderH) * canvas.height;
    const gridX = (logicalX - GRID_OFFSET.x) / GRID_CELL_SIZE;
    const gridY = (logicalY - GRID_OFFSET.y) / GRID_CELL_SIZE;

    // 世界格锚点 -> 面板坐标（相对画布外框容器）
    const toPanelPos = (ax: number, ay: number) => ({
      x: contentLeft - containerRect.left
        + ((GRID_OFFSET.x + ax * GRID_CELL_SIZE) / canvas.width) * renderW,
      y: contentTop - containerRect.top
        + ((GRID_OFFSET.y + ay * GRID_CELL_SIZE) / canvas.height) * renderH,
    });

    // 命中检测：床（两房间各一张）> 门（两房间各一扇）> 炮塔，锚点取目标的网格位置
    // 床铺按整格矩形判定并向外扩 0.15 格：床贴画占满格子且下方还有等级文字，圆形判定会漏掉床的下半部分
    const hitBed = state.beds.find(b => gridX >= b.position.x - 0.15 && gridX < b.position.x + 1.15
      && gridY >= b.position.y - 0.15 && gridY < b.position.y + 1.15);
    const hitDoor = state.doors.find(d => gridX >= d.position.x && gridX < d.position.x + 1
      && gridY >= d.position.y && gridY < d.position.y + 1);

    // 命中优先级：床 > 门 > 炮塔；targetPos 为目标所在格，用于判断是否落在自己睡觉的房间里
    let target: 'door' | 'bed' | 'turret' | null = null;
    let targetId: string | undefined;
    let hitTurret: GameState['turrets'][number] | undefined;
    let targetPos: { x: number; y: number } | null = null;
    let anchor = { x: 0, y: 0 };
    if (hitBed) {
      target = 'bed';
      targetId = hitBed.id;
      targetPos = hitBed.position;
      // 床贴画居中占满格子（顶边约在格上沿 +10px），锚点贴近格上沿即可让面板浮在床正上方
      anchor = { x: hitBed.position.x + 0.5, y: hitBed.position.y + 0.1 };
    } else if (hitDoor) {
      target = 'door';
      targetId = hitDoor.id;
      targetPos = hitDoor.position;
      // 门贴画位于格子底部（门板自墙脚向上抬起，顶边与南墙顶面齐平），锚点取在门板顶边稍上方
      anchor = { x: hitDoor.position.x + 0.5, y: hitDoor.position.y + 0.4 };
    } else {
      // 炮塔命中：以格子中心为圆心（与渲染的炮塔中心一致），半径为 0.65 格
      hitTurret = state.turrets.find(t => Math.hypot(gridX - (t.position.x + 0.5), gridY - (t.position.y + 0.5)) < 0.65);
      if (hitTurret) {
        target = 'turret';
        targetPos = hitTurret.position;
        // 炮塔贴画居格中心（顶边约在格上沿 +15px），锚点略低于格上沿即可让面板浮在炮塔正上方
        anchor = { x: hitTurret.position.x + 0.5, y: hitTurret.position.y + 0.2 };
      }
    }

    // 未命中门/床/炮塔：点击房间内空地格弹出建造炮塔面板，其余位置关闭面板
    if (!target) {
      const gx = Math.floor(gridX);
      const gy = Math.floor(gridY);
      if (!isBuildableCell(gx, gy)) {
        setUpgradePanel(null);
        return;
      }
      const buildPos = toPanelPos(gx + 0.5, gy + 0.5);
      // 可建造但不在自己睡觉的房间里：给出禁用提示，而不是默默没反应
      if (roomIndexOf({ x: gx, y: gy }) !== sleepingRoom) {
        setUpgradePanel({ type: 'locked', x: buildPos.x, y: buildPos.y - 10 });
        return;
      }
      setUpgradePanel({ type: 'build', x: buildPos.x, y: buildPos.y - 10, gx, gy });
      return;
    }

    // 面板锚定在目标中心上方
    const panelPos = toPanelPos(anchor.x, anchor.y);
    // 目标在另一个房间：同样只给禁用提示（reducer 里也有同一条校验兜底）
    if (targetPos && roomIndexOf(targetPos) !== sleepingRoom) {
      setUpgradePanel({ type: 'locked', x: panelPos.x, y: panelPos.y - 10 });
      return;
    }
    if (hitTurret) {
      setUpgradePanel({ type: 'turret', x: panelPos.x, y: panelPos.y - 10, turretId: hitTurret.id });
    } else if ((target === 'door' || target === 'bed') && targetId) {
      setUpgradePanel({ type: target, id: targetId, x: panelPos.x, y: panelPos.y - 10 });
    }
  };

  // 暂停/继续：暂停时顺带收起操作面板；恢复后帧循环从冻结处继续——
  // 引擎时钟仅在 update 内累加、lastTimeRef 每帧照常刷新，二者均无跳变
  const togglePause = () => {
    isPausedRef.current = !isPausedRef.current;
    setIsPaused(isPausedRef.current);
    if (isPausedRef.current) setUpgradePanel(null);
  };

  // 2 倍速开关：随时可切（暂停期间也能切，恢复后按新倍速继续）；
  // 引擎时钟只在 update 内累加、lastTimeRef 每帧照常刷新，切换时不会有时间跳变
  const toggleFast = () => {
    isFastRef.current = !isFastRef.current;
    setIsFast(isFastRef.current);
  };

  // 返回大厅：直接导航回 Lobby；下次点击「进入游戏」时 START_GAME 会重置整局，无需在此预重置
  const handleBackToLobby = () => {
    navigate('/');
  };

  // Game Over Redirect
  useEffect(() => {
    if (state.gameStatus === 'won' || state.gameStatus === 'lost') {
      navigate('/game-over');
    }
  }, [state.gameStatus, navigate]);

  // 面板选中的炮塔/门/床（实时读取，升级后数值立即刷新）
  const selectedTurret = upgradePanel?.type === 'turret'
    ? state.turrets.find(t => t.id === upgradePanel.turretId) ?? null
    : null;
  const selectedDoor = upgradePanel?.type === 'door'
    ? state.doors.find(d => d.id === upgradePanel.id) ?? null
    : null;
  const selectedBed = upgradePanel?.type === 'bed'
    ? state.beds.find(b => b.id === upgradePanel.id) ?? null
    : null;

  // 睡眠状态：建造 / 升级权限（只有睡觉时、且只能在自己睡的那间房）与 HUD 提示共用
  const sleepingBed = state.beds.find((b) => b.isSleeping) ?? null;
  const sleepingRoom = sleepingBed ? roomIndexOf(sleepingBed.position) : -1;

  // 面板上的升级价格与「升级后数值」预览：价格与数值全部取自数值表（types/index.ts），
  // 满级时 upgradeCost 为 null（面板也在这一档显示「已满级」），UI 不再自己算数
  const doorCost = selectedDoor ? doorUpgradeCost(selectedDoor.level) : null;
  const bedCost = selectedBed ? bedUpgradeCost(selectedBed.level) : null;
  const turretCost = selectedTurret ? turretUpgradeCost(selectedTurret.level) : null;
  const nextDoorSpec = selectedDoor ? DOOR_LEVELS[selectedDoor.level] ?? null : null;
  const nextBedSpec = selectedBed ? BED_LEVELS[selectedBed.level] ?? null : null;
  const nextTurretSpec = selectedTurret ? TURRET_LEVELS[selectedTurret.level] ?? null : null;
  // 每秒伤害：炮塔表只存伤害与射击间隔，面板预览要的是 DPS，在这里换算
  const turretDps = (spec: { damage: number; fireInterval: number }) => Math.round(spec.damage / (spec.fireInterval / 1000));
  const previewCls = 'text-[11px] font-normal text-white/60 whitespace-nowrap';

  // 起床后立刻收起面板：权限随睡眠状态变化，留着旧面板会误导（reducer 里也有拦截兜底）
  const sleeping = sleepingBed !== null;
  useEffect(() => {
    if (!sleeping) setUpgradePanel(null);
  }, [sleeping]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden relative bg-black">
      
      {/* 血雾漂移：沿用大厅的血色主题，左上、右下各一团超大模糊深血红圆（blur-3xl），按 fog-a/fog-b 动画来回漂浮；作为背景层排在游戏画面与 UI 之前，被画布覆盖，只在页面边缘露出 */}
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
            <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onClick={handleCanvasClick}
            className="bg-[#252535] rounded-xl h-[94vh] max-h-[calc(100vh-48px)] max-w-[97vw] object-contain block relative z-0 cursor-crosshair"
            />
            {/* 点击门/床/炮塔/空地弹出的操作面板；统一不设关闭按钮，点击画布其他位置或按 Esc 关闭 */}
            {upgradePanel && (
                <div
                    className="absolute z-30 transform -translate-x-1/2 -translate-y-full"
                    style={{ left: upgradePanel.x, top: upgradePanel.y }}
                >
                    {/* 各面板宽度均收缩到与按钮文字同宽；不设深色外框，仅保留彩色按钮 */}
                    <div className="relative w-max animate-in fade-in zoom-in-95 duration-150">
                        {upgradePanel.type === 'door' && selectedDoor ? (
                            selectedDoor.isBroken ? (
                                /* 门已破损：升级无意义（幽灵不再管它、渲染只认 isBroken），以禁用态提示；reducer 亦有同样校验兜底 */
                                <button
                                    disabled
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold bg-white/5 border-white/10 text-gray-500 cursor-not-allowed"
                                >
                                    门已损坏
                                </button>
                            ) : selectedDoor.level >= DOOR_MAX_LEVEL ? (
                                /* 门已满级：5 档门面外观（木 → 加固木 → 铁 → 重铁 → 金）已到顶，数值同样封顶；reducer 亦有同样校验兜底 */
                                <button
                                    disabled
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold bg-white/5 border-white/10 text-amber-200/70 cursor-not-allowed"
                                >
                                    门已满级 Lv.{DOOR_MAX_LEVEL}
                                </button>
                            ) : (
                                <button
                                    onClick={() => dispatch({ type: 'UPGRADE_DOOR', payload: selectedDoor.id })}
                                    className={classNames(
                                        'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all active:scale-95',
                                        {
                                            'bg-gradient-to-r from-blue-600 to-blue-500 border-blue-400/30 text-white hover:from-blue-500 hover:to-blue-400 shadow-lg shadow-blue-900/30': state.player.gold >= doorCost,
                                            'bg-white/5 border-white/10 text-gray-500': state.player.gold < doorCost,
                                        }
                                    )}
                                >
                                    升级门
                                    <span className="font-mono text-yellow-300">{doorCost}G</span>
                                    {nextDoorSpec && (
                                        <span className={previewCls}>
                                            血量 {selectedDoor.maxHealth} → <span className="text-cyan-200">{nextDoorSpec.maxHealth}</span>
                                            {' '}· 升级即修满
                                        </span>
                                    )}
                                </button>
                            )
                        ) : upgradePanel.type === 'bed' && selectedBed ? (
                            selectedBed.level >= BED_MAX_LEVEL ? (
                                /* 床已满级：5 档外观（木板床 → 单人床 → 舒适床 → 软床 → 豪华床）已到顶；reducer 亦有同样校验兜底 */
                                <button
                                    disabled
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold bg-white/5 border-white/10 text-amber-200/70 cursor-not-allowed"
                                >
                                    床已满级 Lv.{BED_MAX_LEVEL}
                                </button>
                            ) : (
                                <button
                                    onClick={() => dispatch({ type: 'UPGRADE_BED', payload: selectedBed.id })}
                                    className={classNames(
                                        'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all active:scale-95',
                                        {
                                            'bg-gradient-to-r from-yellow-600 to-yellow-500 border-yellow-400/30 text-white hover:from-yellow-500 hover:to-yellow-400 shadow-lg shadow-yellow-900/30': state.player.gold >= bedCost,
                                            'bg-white/5 border-white/10 text-gray-500': state.player.gold < bedCost,
                                        }
                                    )}
                                >
                                    升级床
                                    <span className="font-mono text-yellow-200">{bedCost}G</span>
                                    {nextBedSpec && (
                                        <span className={previewCls}>
                                            产出 {BED_LEVELS[selectedBed.level - 1].income} → <span className="text-cyan-200">{nextBedSpec.income}</span> 金/秒
                                        </span>
                                    )}
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
                                    'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all active:scale-95',
                                    {
                                        'bg-gradient-to-r from-emerald-600 to-emerald-500 border-emerald-400/30 text-white hover:from-emerald-500 hover:to-emerald-400 shadow-lg shadow-emerald-900/30': state.player.gold >= TURRET_BUILD_COST,
                                        'bg-white/5 border-white/10 text-gray-500 cursor-not-allowed': state.player.gold < TURRET_BUILD_COST,
                                    }
                                )}
                            >
                                建造炮塔
                                <span className="font-mono text-yellow-300">{TURRET_BUILD_COST}G</span>
                                <span className={previewCls}>
                                    秒伤 <span className="text-cyan-200">{turretDps(TURRET_LEVELS[0])}</span> · 射程 {TURRET_LEVELS[0].range.toFixed(1)}
                                </span>
                            </button>
                        ) : selectedTurret ? (
                            selectedTurret.level >= TURRET_MAX_LEVEL ? (
                                /* 炮塔已满级：5 档外观（机枪塔 → 双管塔 → 加农炮 → 重炮 → 等离子炮）已到顶；reducer 亦有同样校验兜底 */
                                <button
                                    disabled
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold bg-white/5 border-white/10 text-emerald-200/70 cursor-not-allowed"
                                >
                                    炮塔已满级 Lv.{TURRET_MAX_LEVEL}
                                </button>
                            ) : (
                                <button
                                    disabled={state.player.gold < turretCost}
                                    onClick={() => dispatch({ type: 'UPGRADE_TURRET', payload: selectedTurret.id })}
                                    className={classNames(
                                        'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-bold transition-all active:scale-95',
                                        {
                                            'bg-gradient-to-r from-emerald-600 to-emerald-500 border-emerald-400/30 text-white hover:from-emerald-500 hover:to-emerald-400 shadow-lg shadow-emerald-900/30': state.player.gold >= turretCost,
                                            'bg-white/5 border-white/10 text-gray-500 cursor-not-allowed': state.player.gold < turretCost,
                                        }
                                    )}
                                >
                                    升级炮塔
                                    <span className="font-mono text-yellow-300">{turretCost}G</span>
                                    {nextTurretSpec && (
                                        <span className={previewCls}>
                                            秒伤 {turretDps(selectedTurret)} → <span className="text-cyan-200">{turretDps(nextTurretSpec)}</span>
                                            {' '}· 射程 {selectedTurret.range.toFixed(1)} → <span className="text-cyan-200">{nextTurretSpec.range.toFixed(1)}</span>
                                        </span>
                                    )}
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
