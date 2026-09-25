import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import { RefreshCw, Home } from 'lucide-react';

const GameOver: React.FC = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useGame();

  const isWin = state.gameStatus === 'won';

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 relative overflow-hidden bg-black">
      {/* Background Ambience Removed */}

      <div className="relative bg-[#161625]/60 backdrop-blur-2xl p-12 rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.5)] text-center max-w-xl w-full border border-white/5 z-10 overflow-hidden">
        {/* Glow effect based on result */}
        <div className={`absolute top-0 left-0 w-full h-1 ${isWin ? 'bg-gradient-to-r from-green-400 to-green-600 shadow-[0_0_30px_#22c55e]' : 'bg-gradient-to-r from-red-500 to-red-800 shadow-[0_0_30px_#ef4444]'}`}></div>

        <div className="mb-10">
            <h1 className={`text-7xl font-black mb-4 tracking-widest drop-shadow-2xl ${isWin ? 'text-transparent bg-clip-text bg-gradient-to-b from-green-400 to-green-700' : 'text-transparent bg-clip-text bg-gradient-to-b from-red-500 to-red-900'}`}>
            {isWin ? '胜利' : '失败'}
            </h1>
            <p className={`text-sm uppercase tracking-[0.6em] font-bold ${isWin ? 'text-green-500/60' : 'text-red-500/60'}`}>
                {isWin ? '任务完成 • MISSION ACCOMPLISHED' : '你死了 • YOU DIED'}
            </p>
        </div>
        
        <p className="text-gray-400 text-lg mb-12 font-light leading-relaxed px-4">
          {isWin 
            ? '黎明已至，你活过了这一夜。' 
            : '黑暗吞噬了你。如果你敢的话，再试一次。'}
        </p>

        <div className="bg-black/20 p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-colors mb-12 text-left">
          <span className="text-gray-500 text-[10px] uppercase tracking-widest block mb-2 font-bold">生存时间</span>
          <span className="text-3xl font-mono font-bold text-blue-200 block">
            {Math.floor(state.gameTime / 60)}:{(state.gameTime % 60).toString().padStart(2, '0')}
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <button 
            onClick={() => {
                // Restart game with same room
                dispatch({ type: 'START_GAME' });
                navigate(`/game/ing`);
            }}
            className={`group flex items-center justify-center gap-3 w-full py-4 rounded-xl transition-all font-bold text-lg shadow-lg hover:scale-[1.02] active:scale-[0.98] ${isWin 
                ? 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white shadow-green-900/20' 
                : 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white shadow-red-900/20'}`}
          >
            <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
            再来一局
          </button>
          
          <button 
            onClick={() => navigate('/')}
            className="flex items-center justify-center gap-3 w-full py-4 bg-transparent border border-white/10 hover:border-white/20 text-gray-400 hover:text-white rounded-xl transition-all hover:bg-white/5"
          >
            <Home className="w-5 h-5" />
            返回大厅
          </button>
        </div>
      </div>
    </div>
  );
};

export default GameOver;
