import { DOOR_REGEN_RATIO_PER_SEC, GameState, Ghost, GHOST_BASE, GHOST_FLEE_HEALTH_RATIO, GHOST_GROWTH, GHOST_GROWTH_CAP_SECONDS, GHOST_HEAL_RATE_PER_SEC, GHOST_SPAWN_DURATION, Position, Projectile } from '../types';
import { GHOST_ATTACK_OFFSET_Y, GHOST_ATTACK_SNAP, GHOST_HEAL_POSITION, GHOST_LANE_ALIGN, GHOST_LANE_Y, GHOST_MAX_STEP, GHOST_SPAWN_POSITION, resolveMovement, roomIndexOf } from './Collision';

export class GameLogic {
  private keysPressed: Set<string> = new Set();
  // 游戏时钟（ms）：update 每帧累加 deltaTime，与移动/啃门共用同一时间基准，且仅 playing 时推进。
  // 炮塔冷却、子弹飞行、命中特效等所有定时逻辑共用此时钟：
  // 不受系统时钟跳变影响，暂停时整体一起冻结，引擎与渲染器写读 startTime 也天然同源
  private clockMs = 0;
  
  public setInput(keys: Set<string>) {
    this.keysPressed = keys;
  }

  // 供渲染层使用同一时钟做插值（子弹/特效的 startTime 由本时钟写入）
  public getClockMs(): number {
    return this.clockMs;
  }

  public update(state: GameState, deltaTime: number): Partial<GameState> {
    const newState = { ...state };
    this.clockMs += deltaTime;

    // 睡觉中按下移动键立即醒来
    if (newState.beds.some((b) => b.isSleeping) && this.isMoving()) {
        newState.beds.forEach((b) => { b.isSleeping = false; });
    }

    if (!newState.beds.some((b) => b.isSleeping)) {
        this.updatePlayerMovement(newState, deltaTime);
    }

    // 人移动进床：站立在床上且没有移动输入时，自动躺下睡觉
    this.updateBedInteraction(newState);

    this.updateGhost(newState, deltaTime);
    this.updateDoors(newState, deltaTime);
    this.updateTurrets(newState);

    this.updateProjectiles(newState);
    this.updateHitEffects(newState);

    // 胜利：幽灵血量耗尽
    if (newState.ghost.health <= 0) {
        newState.gameStatus = 'won';
    }

    return newState;
  }

  private updatePlayerMovement(state: GameState, deltaTime: number) {
      let dx = 0;
      let dy = 0;
      const speed = state.player.speed;
      const moveStep = (speed * deltaTime) / 1000;

      if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('w')) dy -= moveStep;
      if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('s')) dy += moveStep;
      if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('a')) dx -= moveStep;
      if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('d')) dx += moveStep;

      if (dx !== 0 || dy !== 0) {
          if (dx !== 0 && dy !== 0) {
              const factor = 1 / Math.sqrt(2);
              dx *= factor;
              dy *= factor;
          }
          
          // 与幽灵共用同一套墙壁碰撞滑动与地图边界钳制（见 resolveMovement）
          const pos = resolveMovement(state.player.position.x + 0.5, state.player.position.y + 0.5, dx, dy);

          // 世界格坐标换算回玩家位置（格索引，格中心 = 索引 + 0.5）
          state.player.position.x = pos.x - 0.5;
          state.player.position.y = pos.y - 0.5;
      }
  }

  // 幽灵移动：与玩家共用同一套墙碰撞滑动（幽灵位置与玩家同为格索引，世界格坐标需取格中心 +0.5 格）。
  // 位移按 GHOST_MAX_STEP 切成小段逐段结算：幽灵速度随活动时间成长，后期单帧位移可能超过一格，
  // 只测终点会直接穿过墙体（隧道效应），切成 0.2 格以内的小段后每段都能被墙挡住。
  // 某一段完全走不动（撞墙，见 stepGhost）就停止推进后续分段，避免沿着墙一路滑到别处
  private moveGhost(ghost: Ghost, dx: number, dy: number) {
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / GHOST_MAX_STEP));
      for (let i = 0; i < steps; i++) {
          if (!this.stepGhost(ghost, dx / steps, dy / steps)) break;
      }
  }

  // 单段位移：整体移动被墙挡住时沿单轴贴墙滑动，两个单轴分量都被挡死时绕原方向左右逐档试探改向
  // （幽灵的路线多是斜穿走廊与绕房间，浅角度蹭墙很容易把两个分量一起挡死，卡住就会永远停在原地）。
  // 返回这一段是否真的挪动了 —— 挪不动就说明撞墙了，调用方据此决定要不要继续推进剩下的分段
  private stepGhost(ghost: Ghost, dx: number, dy: number): boolean {
      const wx = ghost.position.x + 0.5;
      const wy = ghost.position.y + 0.5;
      const moved = (p: Position) => Math.hypot(p.x - wx, p.y - wy) > 1e-4;

      let pos = resolveMovement(wx, wy, dx, dy);
      if (!moved(pos)) {
          const base = Math.atan2(dy, dx);
          const len = Math.hypot(dx, dy);
          for (const deg of [30, -30, 60, -60, 90, -90]) {
              const a = base + (deg * Math.PI) / 180;
              const candidate = resolveMovement(wx, wy, Math.cos(a) * len, Math.sin(a) * len);
              if (moved(candidate)) {
                  pos = candidate;
                  break;
              }
          }
      }

      const stepped = moved(pos);
      ghost.position.x = pos.x - 0.5;
      ghost.position.y = pos.y - 0.5;
      return stepped;
  }

  // 朝目标点迈一步：每帧位移不超过「到目标的剩余距离」——
  // 幽灵速度成长到十几格/秒后，单帧位移会远大于到位判定阈值（GHOST_ATTACK_SNAP），
  // 不夹住就会一步跨过目标点、下一帧再跨回来，在目标两侧每帧弹一次（画面上就是一个鬼闪成两个），
  // 而且永远判不到"已到位"。夹住后最后一步正好落在目标点上，下一帧的到位判定必然成立
  private stepToward(ghost: Ghost, dx: number, dy: number, moveStep: number) {
      const dist = Math.hypot(dx, dy);
      if (dist <= 1e-6) return;
      const step = Math.min(moveStep, dist);
      this.moveGhost(ghost, (dx / dist) * step, (dy / dist) * step);
  }

  // 人在床范围内且没有移动输入时，吸附到床中心并开始睡觉（同一时间只睡一张床）
  private updateBedInteraction(state: GameState) {
      const p = state.player.position;
      for (const bed of state.beds) {
          const onBed = Math.hypot(p.x - bed.position.x, p.y - bed.position.y) < 0.45;
          if (onBed && !this.isMoving()) {
              p.x = bed.position.x;
              p.y = bed.position.y;
              state.beds.forEach((b) => { b.isSleeping = b.id === bed.id; });
              break;
          }
      }
  }

  private isMoving(): boolean {
      return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']
          .some((k) => this.keysPressed.has(k));
  }

 
  private updateGhost(state: GameState, deltaTime: number) {
    const ghost = state.ghost;
    const player = state.player;
    const touchDist = 0.4; // 幽灵碰到玩家的判定距离，碰到即结算失败

    // 潜伏：玩家还没上过床，幽灵还压在左下角的入场门后，不移动也不结算任何伤害
    if (ghost.state === 'DORMANT') {
        this.trySpawnGhost(state);
        return;
    }

    // 出场之后（含啃门、追击、逃跑、回血与出场动画期间）：玩家碰到幽灵一律结算失败 ——
    // 它缩在门洞里回血时同样碰不得，别站进门口那块地里
    if (Math.hypot(player.position.x - ghost.position.x, player.position.y - ghost.position.y) < touchDist) {
        state.gameStatus = 'lost';
        return;
    }

    // 成长结算：夜里随时间变强，回血期间暂停（按进入本帧前的状态判断，故写在回血分支之前）
    this.updateGhostStats(ghost, deltaTime);

    // 出场 / 回血后再出场：门洞里钻出来的过渡动画，位置钉在门洞里，动画放完才开始行动
    if (this.clockMs - ghost.emergeTime < GHOST_SPAWN_DURATION) return;

    const moveStep = (ghost.speed * deltaTime) / 1000;

    // 半血逃跑：血量掉到最大血量的一半以下就掉头跑回入场门。
    // 逃跑这段路仍会被炮塔打 —— 这是唯一的补刀窗口；缩进门洞之后回血免伤就打不着了
    if ((ghost.state === 'ATTACKING' || ghost.state === 'CHASING')
        && ghost.health <= ghost.maxHealth * GHOST_FLEE_HEALTH_RATIO) {
        ghost.state = 'RETREATING';
    }

    // 逃跑返程：分两段 —— 还在房间里（含正对房门的啃门站位）先借本房间门洞退到走廊，
    // 再沿走廊走回入场门、缩进门洞里回血
    if (ghost.state === 'RETREATING') {
        const roomIndex = roomIndexOf(ghost.position);
        if (roomIndex >= 0) {
            // 门洞是房间唯一出口，而门洞通道只有约 0.3 格宽（余量见 WALL_BANDS）：
            // 先在室内横向精确对准门洞中线，再纵向直着穿出去，斜着蹭门框会被两个分量一起挡死
            const exitDoor = state.doors.find((d) => roomIndexOf(d.position) === roomIndex);
            const gapX = exitDoor ? exitDoor.position.x : ghost.position.x;
            const alignDx = gapX - ghost.position.x;
            if (Math.abs(alignDx) > GHOST_ATTACK_SNAP) {
                // 横向位移同样夹住剩余距离：后期速度高时一步跨过门洞中线，
                // 就会在门口左右每帧弹一次（画面上闪成两个鬼），且永远对不准门洞
                this.moveGhost(ghost, Math.sign(alignDx) * Math.min(moveStep, Math.abs(alignDx)), 0);
            } else {
                ghost.position.x = gapX;
                this.moveGhost(ghost, 0, moveStep);
            }
            return;
        }

        if (this.walkToStation(ghost, GHOST_HEAL_POSITION, moveStep)) {
            ghost.position.x = GHOST_HEAL_POSITION.x;
            ghost.position.y = GHOST_HEAL_POSITION.y;
            ghost.state = 'HEALING';
        }
        return;
    }

    // 回血：缩在入场门洞里，每秒回复最大血量的 GHOST_HEAL_RATE_PER_SEC，期间免伤、数值也不成长；
    // 回满后从门洞里再钻出来（重播一次钻出动画，当作"它又要来了"的预警），继续啃门或接着追人
    if (ghost.state === 'HEALING') {
        ghost.health = Math.min(ghost.maxHealth, ghost.health + ghost.maxHealth * GHOST_HEAL_RATE_PER_SEC * deltaTime / 1000);
        if (ghost.health >= ghost.maxHealth) {
            ghost.health = ghost.maxHealth;
            ghost.state = this.targetDoorOf(state, ghost) ? 'ATTACKING' : 'CHASING';
            ghost.emergeTime = this.clockMs;
        }
        return;
    }

    // 目标门：出场时就已锁定为玩家床铺对应的那扇门（见 trySpawnGhost）。
    // 门破后不再转攻其他房门，直接转为追击玩家本人（门 id 仍留着，回血结束后据此决定去向）
    const targetDoor = this.targetDoorOf(state, ghost);

    if (!targetDoor) {
        // 追击玩家：直奔玩家当前位置（碰到已在上面统一结算）
        ghost.state = 'CHASING';

        const dx = player.position.x - ghost.position.x;
        const dy = player.position.y - ghost.position.y;
        // 位移夹住剩余距离：后期速度高时一帧就跨过玩家，会绕着玩家来回弹却永远碰不到（判定距离 0.4 格）
        this.stepToward(ghost, dx, dy, moveStep);
        return;
    }

    // 啃门：先在走廊车道上横向走到门洞正下方，对准后再纵向逼近门正前方的站位。
    // 分两段走见 walkToStation 的说明，站位见 GHOST_ATTACK_OFFSET_Y
    ghost.state = 'ATTACKING';
    const station = { x: targetDoor.position.x, y: targetDoor.position.y + GHOST_ATTACK_OFFSET_Y };

    if (this.walkToStation(ghost, station, moveStep)) {
        // 到位：吸附到站位（正对门洞中线的固定位置）后再结算啃门伤害，每一下都啃在同一个位置上
        ghost.position.x = station.x;
        ghost.position.y = station.y;

        targetDoor.health -= (ghost.attackPower * deltaTime) / 1000;
        if (targetDoor.health <= 0) {
            targetDoor.health = 0;
            targetDoor.isBroken = true; // 门破后转追击：下一帧起 targetDoorOf 找不到可用门，走 CHASING 分支
        }
    }
  }

  // 门的自我修复：鬼没在啃这扇门时缓慢回血（啃门中、以及正在走向这扇门的路上都算「在攻击」）。
  // 鬼半血跑路 + 缩门洞回血那十几秒正是门的回复窗口，玩家把一波打跑就能看见门血条涨回去；
  // 回血按最大血量的比例算（各级手感一致），上限不超过最大血量，
  // 已破损的门不再修复（破门后也升不了级，那道门就永久放弃了）
  private updateDoors(state: GameState, deltaTime: number) {
      const attackingDoorId = state.ghost.state === 'ATTACKING' ? state.ghost.targetDoor : null;

      state.doors.forEach((door) => {
          if (door.isBroken || door.id === attackingDoorId) return;
          if (door.health < door.maxHealth) {
              const regen = (door.maxHealth * DOOR_REGEN_RATIO_PER_SEC * deltaTime) / 1000;
              door.health = Math.min(door.maxHealth, door.health + regen);
          }
      });
  }

  // 幽灵锁定的那扇门（未破损才算数）：门破了返回 undefined —— 回血结束后它就直接转为追人
  private targetDoorOf(state: GameState, ghost: Ghost) {
      return state.doors.find((d) => d.id === ghost.targetDoor && !d.isBroken);
  }

  // 幽灵此刻能不能被打：潜伏期还没有实体；回血时缩进门洞免伤（炮塔也不索敌）；
  // 出场与回血后再出场的那段钻出动画期间同样打不到（人还在门洞里）
  private isGhostHittable(ghost: Ghost): boolean {
      if (ghost.spawnTime < 0 || ghost.state === 'DORMANT' || ghost.state === 'HEALING') return false;
      return this.clockMs - ghost.emergeTime >= GHOST_SPAWN_DURATION;
  }

  // 幽灵成长：血上限 / 啃门伤害 / 移动速度按「活动时间」线性增长，活动时间只在夜里累积，
  // 回血那几秒不涨 —— 把它打跑本身就是在给自己买时间。8 分钟封顶（GHOST_GROWTH_CAP_SECONDS）。
  // 血上限增长时把增量等量补给当前血量：亏损的血量保持不变，半血逃跑线不会被成长稀释
  private updateGhostStats(ghost: Ghost, deltaTime: number) {
      if (ghost.spawnTime < 0) return; // 潜伏期：夜还没开始
      if (ghost.state !== 'HEALING') ghost.growthMs += deltaTime;
      const t = Math.min(ghost.growthMs / 1000, GHOST_GROWTH_CAP_SECONDS);

      const maxHealth = GHOST_BASE.health + GHOST_GROWTH.health * t;
      ghost.health += maxHealth - ghost.maxHealth;
      ghost.maxHealth = maxHealth;
      ghost.attackPower = GHOST_BASE.attackPower + GHOST_GROWTH.attackPower * t;
      ghost.speed = GHOST_BASE.speed + GHOST_GROWTH.speed * t;
  }

  // 沿走廊车道走到目标站位：横向没对准时先横着走到目标 x（走廊车道 GHOST_LANE_Y 全程无遮挡），
  // 对准后再纵向收进站位。直接斜线直奔会以很浅的角度蹭上房间南墙与墙角切面，两个单轴分量同时判定撞墙而卡死；
  // 分两段后横向段全程走在无遮挡的走廊里，纵向段正对门洞中线。返回是否已到位（判定距离 GHOST_ATTACK_SNAP）
  private walkToStation(ghost: Ghost, target: Position, moveStep: number): boolean {
      if (Math.hypot(target.x - ghost.position.x, target.y - ghost.position.y) <= GHOST_ATTACK_SNAP) return true;

      const aligned = Math.abs(target.x - ghost.position.x) < GHOST_LANE_ALIGN;
      const goal = aligned ? target : { x: target.x, y: GHOST_LANE_Y };
      this.stepToward(ghost, goal.x - ghost.position.x, goal.y - ghost.position.y, moveStep);
      return false;
  }

  // 幽灵出场：玩家第一次上床睡觉（任一床铺首次 isSleeping）时，从左下角入场门破门而出；
  // 攻击目标同时锁定 —— 取该床铺所在房间里那扇门（床与门按房间对应），此后不再变更。
  // 幽灵的出场位置、出场时刻都记在引擎侧，渲染层据此播破门与钻出的过渡
  private trySpawnGhost(state: GameState) {
      const sleepingBed = state.beds.find((b) => b.isSleeping);
      if (!sleepingBed) return;

      const roomIndex = roomIndexOf(sleepingBed.position);
      const door = state.doors.find((d) => roomIndexOf(d.position) === roomIndex && !d.isBroken);

      state.ghost.position.x = GHOST_SPAWN_POSITION.x;
      state.ghost.position.y = GHOST_SPAWN_POSITION.y;
      state.ghost.targetDoor = door ? door.id : null; // 兜底：没有可用门时直接转为追击玩家
      state.ghost.state = door ? 'ATTACKING' : 'CHASING';
      state.ghost.spawnTime = this.clockMs;
      state.ghost.emergeTime = this.clockMs; // 破门与钻出门洞共用这一刻起算
  }

  private updateTurrets(state: GameState) {
      const now = this.clockMs;
      // 潜伏期还没出场 / 缩进门洞回血中：炮塔不索敌、不开火（回血免伤，打了也白打，
      // 免得子弹攒着等它出门；真正的补刀窗口是它掉头逃跑的那几秒）
      if (!this.isGhostHittable(state.ghost)) return;

      // Check range and cooldown
      state.turrets.forEach(turret => {
          const dx = state.ghost.position.x - turret.position.x;
          const dy = state.ghost.position.y - turret.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // 冷却按等级缩短（TURRET_LEVELS.fireInterval：1000 → 600ms）；
          // lastShot === 0（刚建造）特判为立即开火，保留原 Date.now 版本行为
          if (dist <= turret.range && (turret.lastShot === 0 || now - turret.lastShot > turret.fireInterval)) {
              turret.lastShot = now;
              // 开火：生成子弹飞向幽灵，伤害在子弹命中时才结算
              state.projectiles.push({
                  id: `proj-${turret.id}-${now}`,
                  from: { x: turret.position.x, y: turret.position.y },
                  to: { ...state.ghost.position },
                  startTime: now,
                  duration: 220,
                  damage: turret.damage,
              });
          }
      });
  }

  // 推进子弹飞行：飞抵目标时结算伤害并生成命中特效
  private updateProjectiles(state: GameState) {
      const now = this.clockMs;
      const flying: Projectile[] = [];

      state.projectiles.forEach(proj => {
          if (now - proj.startTime >= proj.duration) {
              // 命中结算：鬼已死、或恰好在这一瞬缩进门洞（回血免伤）时不结算伤害，只留命中特效
              if (state.ghost.health > 0 && this.isGhostHittable(state.ghost)) {
                  state.ghost.health -= proj.damage;
              }
              state.hitEffects.push({
                  id: `hit-${proj.id}`,
                  position: { ...proj.to },
                  startTime: now,
                  duration: 260,
              });
          } else {
              flying.push(proj);
          }
      });

      state.projectiles = flying;
  }

  // 清理已播放完的命中特效
  private updateHitEffects(state: GameState) {
      const now = this.clockMs;
      state.hitEffects = state.hitEffects.filter(eff => now - eff.startTime < eff.duration);
  }
}
