import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import { Play } from 'lucide-react';

const Lobby: React.FC = () => {
  const navigate = useNavigate();
  const { dispatch } = useGame();

  const handleStartGame = () => {
    dispatch({ type: 'START_GAME' });
    navigate(`/game/ing`);
  };

  return (
    /* 根容器：全屏黑底，flex 居中排布，overflow-hidden 裁掉越界特效 */
    <div className="flex flex-col items-center justify-center min-h-screen p-4 relative overflow-hidden bg-black">

      {/* 游戏标题：居中大标题「躺平发育」，红金渐变字 + 红色外发光 */}
      <div className="z-10 text-center mb-16 -translate-y-32">
        <h1 className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-red-500 to-red-900 mb-6 tracking-widest drop-shadow-[0_0_25px_rgba(220,38,38,0.4)] font-mono">
          躺平发育
        </h1>
      </div>

      {/* 中心径向光晕：以屏幕 50%/58% 为圆心的血色柔光（中心浓红 → 外围暗红 → 透明）*/}
      <div className="pointer-events-none absolute left-1/2 top-[58%] h-[min(100vw,50rem)] w-[min(100vw,50rem)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(220,38,38,0.4),rgba(127,29,29,0.18)_45%,transparent_72%)]" />

      {/* 血雾漂移：左上、右下各一团超大模糊深血红圆（blur-3xl），按 fog-a/fog-b 动画来回漂浮 */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-[30rem] w-[30rem] rounded-full bg-red-800/55 blur-3xl animate-fog-a" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[34rem] w-[34rem] rounded-full bg-red-700/40 blur-3xl animate-fog-b" />

      {/* 前景层：按钮与提示文字，z-10 盖在背景光效之上 */}
      <div className="relative z-10 flex flex-col items-center">
        {/* 按钮定位层：为按钮背后的呼吸光晕提供相对定位基准 */}
        <div className="relative">
          {/* 呼吸光：按钮外扩一圈红色雾光，随 animate-pulse 缓慢明暗 */}
          <div className="absolute -inset-3 rounded-3xl bg-red-600/25 blur-2xl animate-pulse pointer-events-none" />

          {/* 开始按钮：红渐变圆角矩形，悬停放大增亮，按下回缩 */}
          <button
            onClick={handleStartGame}
            className="group relative overflow-hidden rounded-2xl bg-gradient-to-b from-red-500 to-red-800 px-16 py-5 ring-1 ring-red-400/40
                       shadow-[0_0_40px_rgba(239,68,68,0.35),0_10px_30px_rgba(0,0,0,0.5)]
                       transition-all duration-300
                       hover:scale-[1.04] hover:shadow-[0_0_70px_rgba(239,68,68,0.55),0_10px_30px_rgba(0,0,0,0.5)]
                       active:scale-95"
          >
            {/* 按钮内容：播放图标（悬停时右移）+「进入游戏」文字 */}
            <span className="relative z-10 flex items-center gap-3 text-2xl font-black tracking-[0.3em] text-white">
              <Play className="w-6 h-6 transition-transform duration-300 group-hover:translate-x-1" />
              进入游戏
            </span>
            {/* 悬停扫光：一条白色高光从左到右扫过按钮表面 */}
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </button>
        </div>

        {/* 提示文字：「点击进入 · 活过今夜」，宽字距小字，随 animate-pulse 缓慢闪烁 */}
        <p className="mt-8 text-xs tracking-[0.5em] text-gray-300 font-medium
              animate-pulse">
          点击进入 · 活过今夜
        </p>
      </div>
    </div>
  );
};

export default Lobby;
